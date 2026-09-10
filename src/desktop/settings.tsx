import React,{useEffect,useState} from 'react';
import type { SetupStatus } from '../shared/contracts';
import { defaultIntegrationConfig } from '../shared/integrations';

const emptyStatus:SetupStatus={ollama:{ok:false,detail:'Checking...',models:[]},python:{ok:false,detail:'Checking...'},office:{ok:false,detail:'Checking...'},docker:{ok:false,detail:'Checking...'},edge:{ok:false,detail:'Checking...'},voice:{ready:false,busy:false}};
const modelChoices=['qwen3:8b','qwen3:14b','qwen3-coder:30b'];
function StatusRow({label,ok,detail}:{label:string;ok:boolean;detail:string}){return <div className="setup-row"><span className={ok?'setup-dot ok':'setup-dot'} aria-hidden="true"/><strong>{label}</strong><span>{detail}</span></div>;}

export function Settings(){
  const [config,setConfig]=useState('');const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  const [status,setStatus]=useState<SetupStatus>(emptyStatus);const [pulling,setPulling]=useState('');
  const refresh=()=>void window.nix.setupStatus().then(setStatus).catch(e=>setError(String(e)));
  useEffect(()=>{refresh();void window.nix.integrations().then(value=>setConfig(JSON.stringify(value,null,2))).catch(e=>setError(String(e)));},[]);
  const installed=new Set(status.ollama.models);
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
        {modelChoices.map(model=><button key={model} disabled={!!pulling||installed.has(model)} onClick={()=>{setError('');setPulling(model);void window.nix.pullModel(model).then(()=>refresh()).catch(e=>setError(String(e))).finally(()=>setPulling(''));}}>{installed.has(model)?`${model} installed`:pulling===model?`Downloading ${model}...`:`Download ${model}`}</button>)}
      </div>
    </div>
    <div className="panel settings-panel">
      <div className="section-label">INTEGRATIONS</div>
      <h2>Trusted Configuration</h2>
      <label htmlFor="integration-json">Integration configuration</label>
      <textarea id="integration-json" aria-label="Integration configuration" spellCheck={false} rows={14} value={config} onChange={e=>{setConfig(e.target.value);setSaved(false);}}/>
      <div className="settings-actions">
        <button className="primary" onClick={()=>{setError('');void Promise.resolve().then(()=>window.nix.saveIntegrations(JSON.parse(config))).then(()=>{setSaved(true);return window.nix.integrations();}).then(value=>setConfig(JSON.stringify(value,null,2))).catch(e=>setError(String(e)));}}>Save integrations</button>
        {saved&&<span role="status">Configuration saved</span>}
      </div>
      {error&&<p className="message-error" role="alert">{error}</p>}
      <details><summary>Configuration example</summary><p>You can paste Claude Desktop style <code>{'{ "mcpServers": ... }'}</code> JSON here; NiX converts it on save.</p><pre>{JSON.stringify({...defaultIntegrationConfig,homeAssistant:{url:'http://homeassistant.local:8123',token:'ENTER_TOKEN_HERE',entities:['light.office']},mcp:[...defaultIntegrationConfig.mcp,{id:'remote-tools',label:'HTTP MCP',transport:'http',url:'https://your-server.example/mcp',token:'ENTER_TOKEN_HERE'}]},null,2)}</pre></details>
    </div>
  </section>;
}
