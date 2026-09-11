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

export function Settings(){
  const [config,setConfig]=useState('');const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  const [status,setStatus]=useState<SetupStatus>(emptyStatus);const [pulling,setPulling]=useState('');
  const [skills,setSkills]=useState<TaskSkill[]>([]);
  const refresh=()=>void window.nix.setupStatus().then(setStatus).catch(e=>setError(String(e)));
  useEffect(()=>{refresh();void window.nix.integrations().then(value=>setConfig(JSON.stringify(value,null,2))).catch(e=>setError(String(e)));void window.nix.taskSkills().then(setSkills).catch(e=>setError(String(e)));},[]);
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
      </div>
      <div className="model-downloads">
        {downloadableModels.map(model=><button key={model} title={modelNotes[model]} disabled={!!pulling||installed.has(model)} onClick={()=>{setError('');setPulling(model);void window.nix.pullModel(model).then(()=>refresh()).catch(e=>setError(String(e))).finally(()=>setPulling(''));}}>{installed.has(model)?`${model} installed`:pulling===model?`Downloading ${model}...`:`Download ${model}`}</button>)}
      </div>
      <p className="scope-note">The Heretic download uses an Ollama-ready GGUF quant. The original <code>p-e-w/gpt-oss-20b-heretic</code> Safetensors model is available through the Heretic conversion skill in Tasks.</p>
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
