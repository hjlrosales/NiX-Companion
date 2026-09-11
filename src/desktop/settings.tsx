import React,{useEffect,useState} from 'react';
import type { SetupStatus } from '../shared/contracts';
import { defaultIntegrationConfig } from '../shared/integrations';
import { downloadableModels } from '../models/ollama';
import type { TaskSkill } from '../shared/task-skills';

const emptyStatus:SetupStatus={ollama:{ok:false,detail:'Checking...',models:[]},python:{ok:false,detail:'Checking...'},office:{ok:false,detail:'Checking...'},docker:{ok:false,detail:'Checking...'},edge:{ok:false,detail:'Checking...'},voice:{ready:false,busy:false}};
const modelNotes:Record<string,string>={
  'qwen3:8b':'default local task model',
  'qwen3:14b':'higher quality if your PC has headroom',
  'qwen3-coder:30b':'slower coding experiments',
  'hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1':'Ollama-ready GGUF quant of p-e-w/gpt-oss-20b-heretic'
};
function StatusRow({label,ok,detail}:{label:string;ok:boolean;detail:string}){return <div className="setup-row"><span className={ok?'setup-dot ok':'setup-dot'} aria-hidden="true"/><strong>{label}</strong><span>{detail}</span></div>;}

function friendlyModelName(model: string) {
  if (model.includes('heretic') || model.includes('HERETIC')) return 'GPT-OSS 20B Heretic (uncensored)';
  if (model === 'qwen3:8b') return 'Qwen3 8B';
  if (model === 'qwen3:14b') return 'Qwen3 14B';
  if (model === 'qwen3-coder:30b') return 'Qwen3 Coder 30B';
  return model;
}

export function Settings(){
  const [config,setConfig]=useState('');const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  const [status,setStatus]=useState<SetupStatus>(emptyStatus);const [pulling,setPulling]=useState('');
  const [skills,setSkills]=useState<TaskSkill[]>([]);
  const [justDownloaded,setJustDownloaded]=useState<string | null>(null);
  const [mp3Export,setMp3Export]=useState(true);
  const [voices,setVoices]=useState<Array<{id:string;name:string;path?:string;type?:string;hasRef?:boolean}>>([]);
  const [selectedVoice,setSelectedVoice]=useState('default');
  const [voicePreset,setVoicePreset]=useState('default');
  const [voiceBusy,setVoiceBusy]=useState('');
  const [voiceName,setVoiceName]=useState('');
  const [xttsReady,setXttsReady]=useState(false);
  const refresh=()=>void window.nix.setupStatus().then(setStatus).catch(e=>setError(String(e)));
  useEffect(()=>{refresh();void window.nix.integrations().then(value=>setConfig(JSON.stringify(value,null,2))).catch(e=>setError(String(e)));void window.nix.taskSkills().then(setSkills).catch(e=>setError(String(e)));void window.nix.mp3Export().then(setMp3Export).catch(()=>{});void window.nix.listVoices().then(r=>setVoices(r.voices)).catch(()=>{});void window.nix.voiceProfile().then(setSelectedVoice).catch(()=>{});void window.nix.voicePreset().then(setVoicePreset).catch(()=>{});},[]);
  useEffect(()=>{if(justDownloaded){const timer=setTimeout(()=>setJustDownloaded(null),8000);return()=>clearTimeout(timer);}},[justDownloaded]);
  const installed=new Set(status.ollama.models);
  const addProvider=(provider:'openai'|'anthropic')=>{
    setError('');setSaved(false);
    try{
      const value=JSON.parse(config||'{}');
      const aiProviders=Array.isArray(value.aiProviders)?value.aiProviders.filter((item:any)=>item?.provider!==provider):[];
      aiProviders.push(provider==='openai'?{provider:'openai',label:'ChatGPT / OpenAI',apiKey:'PASTE_OPENAI_API_KEY_HERE',baseUrl:'https://api.openai.com/v1',models:['gpt-4.1-mini','gpt-4.1']}:{provider:'anthropic',label:'Claude / Anthropic',apiKey:'PASTE_ANTHROPIC_API_KEY_HERE',baseUrl:'https://api.anthropic.com',models:['claude-sonnet-4-5']});
      setConfig(JSON.stringify({...value,aiProviders},null,2));
    }catch(e){setError('Configuration JSON is not valid yet. Fix the JSON, then use the provider buttons.');}
  };
  return <section className="settings-view">
    <div className="panel settings-panel">
      <div className="section-label">SETUP</div>
      <h2>Environment</h2>
      <div className="setup-grid">
        <StatusRow label="Ollama" ok={status.ollama.ok} detail={status.ollama.detail}/>
        <StatusRow label="Office" ok={status.office.ok} detail={status.office.detail}/>
        <StatusRow label="Python" ok={status.python.ok} detail={status.python.detail}/>
        <StatusRow label="Docker" ok={status.docker.ok} detail={status.docker.detail}/>
        <StatusRow label="Edge" ok={status.edge.ok} detail={status.edge.detail}/>
        <StatusRow label="Voice" ok={status.voice.ready} detail={status.voice.busy?'Busy':status.voice.ready?'Models ready':'Setup required'}/>
      </div>
      <div className="settings-actions">
        <button onClick={refresh}>Refresh</button>
        <button disabled={status.voice.busy} onClick={()=>{setError('');setStatus(s=>({...s,voice:{...s.voice,busy:true}}));void window.nix.setupVoice().then(voice=>{setStatus(s=>({...s,voice}));refresh();}).catch(e=>{setError(String(e));setStatus(s=>({...s,voice:{...s.voice,busy:false}}));});}}>{status.voice.busy?'Downloading voice models...':status.voice.ready?'Verify voice models':'Download voice models'}</button>
        <button onClick={()=>void window.nix.cancelVoice().then(refresh)}>Cancel voice</button>
        <label className="check-label" style={{marginLeft:'12px'}}><input type="checkbox" checked={mp3Export} onChange={e=>{const v=e.target.checked;setMp3Export(v);void window.nix.setMp3Export(v).catch(()=>setMp3Export(!v));}} /> Save chat replies as MP3</label>
      </div>
      <div className="model-downloads">
        {downloadableModels.map(model=>{
          const isInstalled=installed.has(model);
          const isDownloading=pulling===model;
          const justFinished=justDownloaded===model;
          return <button key={model} title={modelNotes[model]} disabled={!!pulling&&!isDownloading||isInstalled} onClick={()=>{if(isInstalled||isDownloading)return;setError('');setPulling(model);void window.nix.pullModel(model).then(()=>{setJustDownloaded(model);refresh();}).catch(e=>setError(String(e))).finally(()=>setPulling(''));}}>
            {isInstalled?<>{friendlyModelName(model)} <span className="model-installed-badge">installed</span></>:isDownloading?<span className="model-downloading"><span className="download-spinner" /> Downloading {friendlyModelName(model)}...</span>:friendlyModelName(model)}
          </button>;
        })}
      </div>
      {justDownloaded&&<div className="model-success-notice" role="status">
        <strong>{friendlyModelName(justDownloaded)} is ready to use.</strong>
        <span>It is saved in your local Ollama storage ({'{'}Ollama models folder{'}'}). Select it in the Model dropdown above to use it in Chat or Tasks.</span>
        {justDownloaded.includes('heretic')&&<span className="heretic-note">Tip: Use Tasks mode with the Heretic skill to convert additional Safetensors models locally. The Heretic CLI can optimize and quantize models for your hardware.</span>}
      </div>}
      <p className="scope-note">
        Models are stored in Ollama's local model directory. Once installed, select a model from the Model dropdown at the top of the app to use it in Chat or Tasks.
        {" The Heretic download is an Ollama-ready GGUF quant of "}<code>p-e-w/gpt-oss-20b-heretic</code>{". For original Safetensors conversion, use the Heretic skill in Tasks."}
      </p>
    </div>
    <div className="panel settings-panel">
      <div className="section-label">VOICE</div>
      <h2>Voice Selection</h2>
      <p className="scope-note">Choose a voice for text-to-speech and MP3 exports. Neural voices use Microsoft Edge TTS for studio-quality synthesis. Custom cloned voices use XTTS v2 (requires Python 3.11).</p>
      <label style={{fontSize:'11px',color:'var(--muted)'}}>Voice preset</label>
      <select value={voicePreset} onChange={e=>{const v=e.target.value;setVoicePreset(v);void window.nix.setVoicePreset(v).catch(()=>{});}} style={{width:'100%',marginTop:'4px',padding:'6px 8px',border:'1px solid var(--line)',borderRadius:'var(--radius)',background:'var(--surface)',color:'var(--text)',fontSize:'12px'}}>
        {voices.filter(v=>v.type==='preset').map(v=><option key={v.id} value={v.id}>{v.name} ({v.id})</option>)}
      </select>
      <div className="settings-actions" style={{marginTop:'8px'}}>
        <button disabled={voiceBusy==='setup'} onClick={()=>{setVoiceBusy('setup');void window.nix.setupXtts().then((r:any)=>{setXttsReady(!!r.ready);if(!r.ready&&r.error)setError(r.error);}).catch(e=>setError(String(e))).finally(()=>setVoiceBusy(''));}}>{voiceBusy==='setup'?'Setting up voice cloning...':xttsReady?'Voice cloning ready':'Install voice cloning (Python 3.11)'}</button>
      </div>
      {xttsReady&&<div style={{marginTop:'12px'}}>
        <div style={{fontSize:'11px',color:'var(--muted)',marginBottom:'6px'}}>Train custom voice (5-15 sec clear speech clip)</div>
        <div style={{display:'flex',gap:'8px',alignItems:'end'}}>
          <label style={{flex:1}}><span style={{fontSize:'11px',color:'var(--muted)'}}>Voice name</span><input type="text" placeholder="e.g. John" value={voiceName} onChange={e=>setVoiceName(e.target.value)} disabled={!!voiceBusy} style={{width:'100%',marginTop:'4px',padding:'6px 8px',border:'1px solid var(--line)',borderRadius:'var(--radius)',background:'var(--surface)',color:'var(--text)',fontSize:'12px'}} /></label>
          <label style={{cursor:'pointer'}}><span style={{fontSize:'11px',color:'var(--muted)'}}>Reference audio</span><input type="file" accept="audio/*" disabled={!!voiceBusy||!voiceName.trim()} onChange={e=>{
            const file=e.target.files?.[0]; if(!file||!voiceName.trim())return;
            setVoiceBusy('train'); setError('');
            const id='voice-'+Date.now();
            void window.nix.trainVoice({refAudioPath:(file as any).path,voiceId:id,voiceName:voiceName.trim()}).then(()=>{setVoiceName('');return window.nix.listVoices();}).then(r=>setVoices(r.voices)).catch(e=>setError(String(e))).finally(()=>{setVoiceBusy('');e.target.value='';});
          }} style={{display:'block',marginTop:'4px'}} /></label>
        </div>
      </div>}
      {voices.filter(v=>v.type==='cloned').length>0&&<div style={{marginTop:'12px'}}>
        <div style={{fontSize:'11px',color:'var(--muted)',marginBottom:'6px'}}>Cloned voices</div>
        {voices.filter(v=>v.type==='cloned').map(v=><div key={v.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'6px 8px',border:'1px solid var(--line-soft)',borderRadius:'var(--radius)',marginBottom:'4px',background:selectedVoice===v.path?'var(--accent-soft)':'var(--surface)'}}>
          <button style={{flex:1,textAlign:'left',background:'transparent',border:'none',color:'var(--text)',fontSize:'12px',padding:0}} onClick={()=>{setSelectedVoice(v.path!);void window.nix.setVoiceProfile(v.path!).catch(()=>setSelectedVoice('default'));}}>{v.name} {selectedVoice===v.path&&<span style={{color:'var(--accent)'}}>● active</span>}</button>
          <button style={{fontSize:'10px',padding:'2px 6px'}} onClick={()=>{if(confirm(`Delete voice "${v.name}"?`))void window.nix.deleteVoice(v.id).then(()=>window.nix.listVoices()).then(r=>setVoices(r.voices)).catch(e=>setError(String(e)));}}>Delete</button>
        </div>)}
        <button style={{fontSize:'10px',marginTop:'4px'}} onClick={()=>{setSelectedVoice('default');void window.nix.setVoiceProfile('default').catch(()=>{});}}>Use default voice</button>
      </div>}
      {voiceBusy==='train'&&<p style={{fontSize:'11px',color:'var(--warning)',marginTop:'8px'}}>Training voice... This may take 30-60 seconds on first use.</p>}
    </div>
    <div className="panel settings-panel">
      <div className="section-label">TASK SKILLS</div>
      <h2>What NiX Can Use</h2>
      <div className="skill-list">
        {skills.map(skill=><article key={skill.id}><strong>{skill.label}{!skill.builtin&&<button disabled={false} onClick={()=>{if(confirm(`Delete the "${skill.label}" skill shortcut?`))void window.nix.deleteTaskSkill(skill.id).then(()=>window.nix.taskSkills()).then(setSkills).catch(e=>setError(String(e)));}}>Delete</button>}</strong><p>{skill.note}</p></article>)}
      </div>
      <p className="scope-note">These are reusable instruction packages. Ask NiX in a task to add a skill, then inspect it in Capabilities. Tool names appear in task logs because the AI calls them during a run.</p>
    </div>
    <div className="panel settings-panel">
      <div className="section-label">INTEGRATIONS</div>
      <h2>Trusted Configuration</h2>
      <div className="settings-actions">
        <button onClick={()=>addProvider('openai')}>Add ChatGPT / OpenAI</button>
        <button onClick={()=>addProvider('anthropic')}>Add Claude</button>
      </div>
      <p className="scope-note">Paste your API key after using a button, save integrations, then refresh the model list at the top of the app. Online models appear as openai:model-name or anthropic:model-name.</p>
      <label htmlFor="integration-json">Integration configuration</label>
      <textarea id="integration-json" aria-label="Integration configuration" spellCheck={false} rows={14} value={config} onChange={e=>{setConfig(e.target.value);setSaved(false);}}/>
      <div className="settings-actions">
        <button className="primary" onClick={()=>{setError('');void Promise.resolve().then(()=>window.nix.saveIntegrations(JSON.parse(config))).then(()=>{setSaved(true);return window.nix.integrations();}).then(value=>setConfig(JSON.stringify(value,null,2))).catch(e=>setError(String(e)));}}>Save integrations</button>
        {saved&&<span role="status">Configuration saved</span>}
      </div>
      {error&&<p className="message-error" role="alert">{error}</p>}
      <details><summary>Configuration example</summary><p>You can paste Claude Desktop style <code>{'{ "mcpServers": ... }'}</code> JSON here; NiX converts it on save. Add API providers to use online models in Chat or Tasks.</p><pre>{JSON.stringify({...defaultIntegrationConfig,aiProviders:[{provider:'openai',label:'OpenAI',apiKey:'ENTER_OPENAI_KEY',baseUrl:'https://api.openai.com/v1',models:['gpt-4.1-mini','gpt-4.1']},{provider:'anthropic',label:'Anthropic',apiKey:'ENTER_ANTHROPIC_KEY',baseUrl:'https://api.anthropic.com',models:['claude-sonnet-4-5']}],homeAssistant:{url:'http://homeassistant.local:8123',token:'ENTER_TOKEN_HERE',entities:['light.office']},mcp:[...defaultIntegrationConfig.mcp,{id:'remote-tools',label:'HTTP MCP',transport:'http',url:'https://your-server.example/mcp',token:'ENTER_TOKEN_HERE'}]},null,2)}</pre></details>
    </div>
  </section>;
}
