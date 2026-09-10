import { app, BrowserWindow, ipcMain, session, dialog, shell, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import { join, relative, isAbsolute } from 'node:path';
import { writeFile, realpath, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Store } from '../storage/database';
import { Ollama } from '../models/ollama';
import { ChatRuntime } from '../runtime/chat';
import { idSchema, sendSchema } from '../shared/contracts';
import { z } from 'zod';
import { AgentRuntime } from '../runtime/agent';
import { mockRegistry } from '../tools/registry';
import { executionRegistry } from '../tools/execution';
import { Processes } from '../executors/processes';
import { runInputSchema } from '../shared/agent';
import { documentTools } from '../tools/documents';
import { McpConnections } from '../tools/mcp';
import { BrowserSessions } from '../tools/browser';
import { windowsTools } from '../tools/windows';
import { defaultIntegrationConfig, normalizeIntegrationConfig, type IntegrationConfig } from '../shared/integrations';
import { HomeAssistant } from '../devices/home-assistant';
import { VoiceService } from '../voice/service';

if (process.env.NIX_USER_DATA) app.setPath('userData', process.env.NIX_USER_DATA);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else void app.whenReady().then(() => {
  const store = new Store(join(app.getPath('userData'), 'nix.db'));
  const adapter = new Ollama(process.env.NIX_OLLAMA_URL);
  let window: BrowserWindow;
  const processes = new Processes();
  const browsers = new BrowserSessions();
  const voice = new VoiceService(app.getAppPath(),app.isPackaged?join(app.getPath('userData'),'voice-models'):join(app.getAppPath(),'.nix-models'),join(app.getPath('userData'),'voice-temp'));
  let microphoneUntil=0;
  const commandCheck=(file:string,args:string[],timeout=5000)=>new Promise<string>((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout,maxBuffer:200000},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve(stdout.trim())));
  const setupStatus=async()=>{
    const modelResult=await adapter.models().then(models=>({ok:true as const,models,detail:models.length?`${models.length} local model(s)`:'Ollama is running; no local models installed.'})).catch((error:Error)=>({ok:false as const,models:[],detail:error.message}));
    const docker=await commandCheck('docker',['info','--format','{{.ServerVersion}}']).then(version=>({ok:true,detail:`Docker ${version}`})).catch(error=>({ok:false,detail:error.message}));
    const officeOk=process.platform!=='win32'||existsSync('C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE')||existsSync('C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE');
    const edgeOk=process.platform!=='win32'||existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')||existsSync('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
    const python=join(app.getAppPath(),'.venv',process.platform==='win32'?'Scripts\\python.exe':'bin/python');
    return {
      ollama:modelResult,
      python:{ok:existsSync(python),detail:existsSync(python)?'Python worker runtime found.':'Python worker runtime is missing.'},
      office:{ok:officeOk,detail:officeOk?'Microsoft Office renderer found.':'Microsoft Word and PowerPoint are needed for DOCX/PPTX preview rendering on Windows.'},
      docker,
      edge:{ok:edgeOk,detail:edgeOk?'Microsoft Edge found for browser automation.':'Microsoft Edge was not found; Playwright Chromium may still work if installed.'},
      voice:voice.status()
    };
  };
  const loadIntegrations = ():IntegrationConfig => {
    const encoded=store.setting('integrations');if(!encoded)return defaultIntegrationConfig;
    if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable.');
    return normalizeIntegrationConfig(JSON.parse(safeStorage.decryptString(Buffer.from(encoded,'base64'))));
  };
  let integrations=loadIntegrations(); let mcp=new McpConnections(integrations.mcp);
  const changed = () => { if (window && !window.isDestroyed()) window.webContents.send('nix:agent-changed'); };
  const agent = new AgentRuntime(store, adapter, input => {
    if(input.mode==='mock')return mockRegistry();
    const registry=executionRegistry(input,processes);if(input.mode==='docker')return registry;
    documentTools(registry,input.workspace,app.getAppPath());mcp.addTools(registry);
    if(integrations.browser)browsers.addTools(registry,input.workspace);
    if(integrations.windows)windowsTools(registry,input.workspace,app.getAppPath());
    if(integrations.homeAssistant)new HomeAssistant(integrations.homeAssistant).addTools(registry);return registry;
  }, changed, undefined, async id => {await Promise.all([processes.cleanup(id),mcp.cleanup(id),browsers.cleanup(id)]);});
  const runtime = new ChatRuntime(store, adapter, event => { if (!window.isDestroyed()) window.webContents.send('nix:message', event); });
  const entry = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
  const handle = (name: string, action: (data: unknown) => unknown) => ipcMain.handle(name, (event, data: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== entry) throw new Error('Untrusted IPC sender.');
    return action(data);
  });
  handle('nix:snapshot', () => ({ conversations: store.list(), selectedModel: store.model(), active: runtime.activeId() }));
  handle('nix:setup-status',()=>setupStatus());
  handle('nix:pull-model',async data=>adapter.pull(z.enum(['qwen3:8b','qwen3:14b','qwen3-coder:30b']).parse(data),AbortSignal.timeout(60*60*1000)));
  handle('nix:create', () => store.create());
  handle('nix:messages', data => store.messages(idSchema.parse(data)));
  handle('nix:models', () => adapter.models());
  handle('nix:model', data => store.setModel(z.string().min(1).max(200).parse(data)));
  handle('nix:send', data => { if (agent.state().active) throw new Error('Finish or stop the active task before chatting.'); return runtime.send(sendSchema.parse(data)); });
  handle('nix:cancel', data => runtime.cancel(idSchema.parse(data)));
  handle('nix:agent', () => agent.state());
  handle('nix:voice-status',()=>voice.status());
  handle('nix:voice-setup',()=>voice.setup());
  handle('nix:voice-cancel',()=>voice.cancel());
  handle('nix:microphone',()=>{microphoneUntil=Date.now()+15000;});
  handle('nix:transcribe',data=>{if(!(data instanceof Uint8Array))throw new Error('Invalid recording.');return voice.transcribe(data);});
  handle('nix:speak',data=>voice.speak(z.string().min(1).max(3000).parse(data)));
  handle('nix:integrations',()=>({...integrations,homeAssistant:integrations.homeAssistant?{...integrations.homeAssistant,token:'__SAVED__'}:undefined,mcp:integrations.mcp.map(config=>config.transport==='http'?{...config,token:config.token?'__SAVED__':undefined}:{...config,env:Object.fromEntries(Object.keys(config.env).map(key=>[key,'__SAVED__']))})}));
  handle('nix:save-integrations',async data=>{
    if(agent.state().active)throw new Error('Finish the active task before changing integrations.');
    if(!safeStorage.isEncryptionAvailable())throw new Error('Cannot securely save credentials on this system.');
    const next=normalizeIntegrationConfig(data,integrations);
    for(const server of next.mcp){const old=integrations.mcp.find(c=>c.id===server.id);
      if(server.transport==='http'&&server.token==='__SAVED__'){if(old?.transport!=='http'||old.url!==server.url)throw new Error('Enter a new token for a changed server.');server.token=old.token;}
      if(server.transport==='stdio')for(const key of Object.keys(server.env))if(server.env[key]==='__SAVED__'){if(old?.transport!=='stdio'||old.command!==server.command||!old.env[key])throw new Error('Enter environment credentials for this server.');server.env[key]=old.env[key];}
    }
    if(next.homeAssistant){if(next.homeAssistant.token==='__SAVED__'){if(integrations.homeAssistant?.url!==next.homeAssistant.url)throw new Error('Enter the token for this Home Assistant.');next.homeAssistant.token=integrations.homeAssistant.token;}await new HomeAssistant(next.homeAssistant).verify(AbortSignal.timeout(30000));}
    store.setSetting('integrations',safeStorage.encryptString(JSON.stringify(next)).toString('base64'));integrations=next;mcp=new McpConnections(next.mcp);
  });
  handle('nix:events', data => store.events(idSchema.parse(data)));
  handle('nix:workspace', () => store.setting('workspace') ?? '');
  handle('nix:pick-workspace', async () => {
    if (agent.state().active) throw new Error('Stop the active task before changing its workspace.');
    const result = await dialog.showOpenDialog(window, { title: 'Select the task workspace', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const root = await realpath(result.filePaths[0]); store.setSetting('workspace', root); return root;
  });
  handle('nix:run', async data => {
    if (runtime.activeId()) throw new Error('Finish the current chat reply first.');
    const input = runInputSchema.parse(data);
    if (input.mode !== 'mock' && input.workspace !== store.setting('workspace')) throw new Error('Select a workspace using the folder picker first.');
    if (!(await adapter.models()).includes(input.model)) throw new Error('Select an installed local model.');
    return agent.start(input);
  });
  handle('nix:resume', async data => {
    if (runtime.activeId()) throw new Error('Finish the current chat reply first.');
    const previous = store.run(idSchema.parse(data));
    if (previous.mode !== 'mock' && previous.workspace !== store.setting('workspace')) throw new Error('Select the original workspace before resuming.');
    if (!(await adapter.models()).includes(previous.model)) throw new Error('The original model must be installed to resume.');
    return agent.start(runInputSchema.parse({ goal: previous.goal, model: previous.model, mode: previous.mode, workspace: previous.workspace, network: previous.network }), previous.id);
  });
  handle('nix:stop-run', data => agent.cancel(idSchema.parse(data)));
  handle('nix:approve', data => { const p = z.object({ id: idSchema, allow: z.boolean(), remember: z.boolean() }).strict().parse(data); agent.gate.decide(p.id, p.allow, p.remember); });
  handle('nix:accept', data => { const run = store.run(idSchema.parse(data)); if (run.status !== 'review') throw new Error('Only finished tasks awaiting review can be accepted.'); run.status = 'completed'; store.putRun(run); store.event(run.id, 'user.accepted', { note: 'User reviewed task evidence and accepted the result.' }); changed(); });
  const artifactPath = async (data: unknown) => {
    const input = z.object({ runId: idSchema, path: z.string().max(2000) }).strict().parse(data); const run = store.run(input.runId);
    const known = store.events(run.id).some(e => { if (e.type !== 'tool.result') return false; try { return JSON.parse(e.data).artifacts?.includes(input.path); } catch { return false; } });
    if (!known) throw new Error('Artifact not registered by this run.');
    const root = await realpath(run.workspace); const path = await realpath(input.path); const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Artifact is outside the workspace.');
    return path;
  };
  handle('nix:artifact', async data => { shell.showItemInFolder(await artifactPath(data)); });
  handle('nix:preview', async data => {
    const path = await artifactPath(data); if (!path.toLowerCase().endsWith('.png') || (await stat(path)).size > 10000000) throw new Error('Preview must be a PNG under 10 MB.');
    const bytes = await readFile(path); if (bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG preview.'); return `data:image/png;base64,${bytes.toString('base64')}`;
  });
  handle('nix:export', async data => {
    const id = idSchema.parse(data); const run = store.run(id); const events = store.events(id);
    const result = await dialog.showSaveDialog(window, { defaultPath: `nix-run-${id}.json`, filters: [{ name: 'JSON log', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null; await writeFile(result.filePath, JSON.stringify({ run, events }, null, 2)); return result.filePath;
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes='mediaTypes' in details&&Array.isArray(details.mediaTypes)?details.mediaTypes:[];
    callback(contents===window.webContents&&permission==='media'&&Date.now()<microphoneUntil&&details.isMainFrame&&details.requestingUrl===entry&&mediaTypes.length>0&&mediaTypes.every(type=>type==='audio'));
  });
  session.defaultSession.setPermissionCheckHandler((contents,permission,_origin,details)=>contents===window.webContents&&permission==='media'&&Date.now()<microphoneUntil&&details.isMainFrame&&details.requestingUrl===entry&&details.mediaType==='audio');
  window = new BrowserWindow({ width: 1180, height: 800, minWidth: 760, minHeight: 580, backgroundColor: '#101319', title: 'NiX Companion', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => { const id = runtime.activeId(); if (id) runtime.cancel(id); });
  window.webContents.on('render-process-gone', () => { const id = agent.state().active; if (id) agent.cancel(id); });
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus(); });
  void window.loadURL(entry);
  let quitting = false;
  app.on('before-quit', event => {
    voice.cancel(); microphoneUntil=0;
    if (quitting) return;
    const id = runtime.activeId();
    const runId = agent.state().active;
    if (id || runId) {
      event.preventDefault(); if (id) runtime.cancel(id); if (runId) agent.cancel(runId);
      void Promise.allSettled([runtime.idle(), agent.idle()]).finally(() => { quitting = true; app.quit(); });
    }
  });
  app.on('will-quit', () => store.close());
});
app.on('window-all-closed', () => app.quit());
