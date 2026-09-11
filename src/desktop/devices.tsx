import React,{useEffect,useMemo,useState} from 'react';
import type { DeviceDescriptor, DeviceToolName } from '../shared/devices';

const toolLabels:Record<DeviceToolName,string>={
  power_on:'Power',
  power_off:'Off',
  volume_up:'Vol +',
  volume_down:'Vol -',
  mute:'Mute',
  navigate_up:'Up',
  navigate_down:'Down',
  navigate_left:'Left',
  navigate_right:'Right',
  select:'OK',
  back:'Back',
  home:'Home',
  menu:'Menu',
  launch_app:'App',
  play:'Play',
  pause:'Pause',
  stop:'Stop',
  get_state:'State'
};

function has(device:DeviceDescriptor,tool:DeviceToolName){return device.capabilities.includes(tool);}
function statusTone(state:DeviceDescriptor['connectionState']){return state==='connected'?'success':state==='error'||state==='unavailable'?'danger':'warning';}

export function DevicesView(){
  const [devices,setDevices]=useState<DeviceDescriptor[]>([]);
  const [errors,setErrors]=useState<string[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [failure,setFailure]=useState('');
  const load=(discover=false)=>{setFailure('');setBusy(discover?'discover':'list');void (discover?window.nix.discoverDevices():window.nix.devices()).then(result=>{setDevices(result.devices);setErrors(result.errors);setSelected(current=>current&&result.devices.some(device=>device.id===current)?current:result.devices[0]?.id??'');}).catch(e=>setFailure(String(e))).finally(()=>setBusy(''));};
  useEffect(()=>load(false),[]);
  const device=devices.find(item=>item.id===selected);
  const invoke=(tool:DeviceToolName,args:Record<string,unknown>={})=>{
    if(!device)return;
    const meta=device.tools.find(item=>item.name===tool);
    if(meta?.requiresApproval&&!confirm(`Send ${toolLabels[tool]} to ${device.name}?`))return;
    setBusy(tool);setFailure('');setMessage('');
    void window.nix.invokeDevice({deviceId:device.id,tool,args}).then(result=>{setMessage(result.evidence?.join('\n')||result.output);if(tool==='get_state')load(false);}).catch(e=>setFailure(String(e))).finally(()=>setBusy(''));
  };
  return <section className="devices-view">
    <div className="devices-head">
      <div><div className="section-label">DEVICES</div><h2>Device Integrations</h2></div>
      <div className="settings-actions"><button onClick={()=>load(false)} disabled={!!busy}>Refresh</button><button className="primary" onClick={()=>load(true)} disabled={!!busy}>Discover</button></div>
    </div>
    {failure&&<p className="message-error" role="alert">{failure}</p>}
    {errors.length>0&&<div className="notice">{errors.join('\n')}</div>}
    <div className="devices-layout">
      <div className="device-list">
        {devices.length===0&&<p className="scope-note">No configured devices are connected. Add a real device integration in Settings, then run discovery.</p>}
        {devices.map(item=><button key={item.id} className={item.id===selected?'device-card selected':'device-card'} onClick={()=>setSelected(item.id)}>
          <strong>{item.name}</strong>
          <span>{item.manufacturer} {item.model}</span>
          <small className={`capability-status ${statusTone(item.connectionState)}`}>{item.connectionState.replaceAll('_',' ')}</small>
        </button>)}
      </div>
      {device&&<DeviceDetail device={device} busy={busy} invoke={invoke}/>}
    </div>
    {message&&<div className="device-output" role="status">{message}</div>}
  </section>;
}

function DeviceDetail({device,busy,invoke}:{device:DeviceDescriptor;busy:string;invoke:(tool:DeviceToolName,args?:Record<string,unknown>)=>void}){
  const apps=useMemo(()=>device.discoveredState.apps,[device]);
  const disabled=!!busy||device.connectionState!=='connected';
  return <div className="device-detail">
    <div className="panel device-info">
      <div className="panel-header"><div><div className="section-label">{device.type}</div><h2>{device.name}</h2></div><span className={`capability-status ${statusTone(device.connectionState)}`}>{device.connectionState.replaceAll('_',' ')}</span></div>
      <div className="device-facts">
        <span>Driver <strong>{device.driverId}</strong></span>
        <span>Manufacturer <strong>{device.manufacturer}</strong></span>
        <span>Model <strong>{device.model}</strong></span>
        <span>Auth <strong>{device.authentication.configured?'configured':device.authentication.required?'required':'not required'}</strong></span>
      </div>
      <div className="permission-row">{device.permissions.map(permission=><span key={permission}>{permission}</span>)}</div>
      <div className="permission-row">{device.capabilities.map(capability=><span key={capability}>{capability}</span>)}</div>
    </div>
    <div className="panel remote-panel">
      <div className="panel-header compact"><div><div className="section-label">REMOTE</div><h2>Shared Tool Remote</h2></div><button onClick={()=>invoke('get_state')} disabled={!has(device,'get_state')||disabled}>State</button></div>
      <div className="remote-grid nav">
        <span/>
        <RemoteButton device={device} tool="navigate_up" disabled={disabled} invoke={invoke}>↑</RemoteButton>
        <span/>
        <RemoteButton device={device} tool="navigate_left" disabled={disabled} invoke={invoke}>←</RemoteButton>
        <RemoteButton device={device} tool="select" disabled={disabled} invoke={invoke}>OK</RemoteButton>
        <RemoteButton device={device} tool="navigate_right" disabled={disabled} invoke={invoke}>→</RemoteButton>
        <span/>
        <RemoteButton device={device} tool="navigate_down" disabled={disabled} invoke={invoke}>↓</RemoteButton>
        <span/>
      </div>
      <div className="remote-row">
        <RemoteButton device={device} tool="volume_down" disabled={disabled} invoke={invoke}>Vol -</RemoteButton>
        <RemoteButton device={device} tool="mute" disabled={disabled} invoke={invoke}>Mute</RemoteButton>
        <RemoteButton device={device} tool="volume_up" disabled={disabled} invoke={invoke}>Vol +</RemoteButton>
      </div>
      <div className="remote-row">
        <RemoteButton device={device} tool="home" disabled={disabled} invoke={invoke}>Home</RemoteButton>
        <RemoteButton device={device} tool="back" disabled={disabled} invoke={invoke}>Back</RemoteButton>
        <RemoteButton device={device} tool="menu" disabled={disabled} invoke={invoke}>Menu</RemoteButton>
      </div>
      <div className="remote-row">
        <RemoteButton device={device} tool="power_on" disabled={disabled} invoke={invoke}>Power</RemoteButton>
        <RemoteButton device={device} tool="power_off" disabled={disabled} invoke={invoke}>Off</RemoteButton>
      </div>
      <div className="remote-row">
        <RemoteButton device={device} tool="play" disabled={disabled} invoke={invoke}>Play</RemoteButton>
        <RemoteButton device={device} tool="pause" disabled={disabled} invoke={invoke}>Pause</RemoteButton>
        <RemoteButton device={device} tool="stop" disabled={disabled} invoke={invoke}>Stop</RemoteButton>
      </div>
      {apps.length>0&&<div className="remote-apps"><strong>Apps</strong>{apps.map(app=><button key={app.id} disabled={disabled||!has(device,'launch_app')} onClick={()=>invoke('launch_app',{app:app.name,appId:app.id})}>{app.name}</button>)}</div>}
    </div>
  </div>;
}

function RemoteButton({device,tool,disabled,invoke,children}:{device:DeviceDescriptor;tool:DeviceToolName;disabled:boolean;invoke:(tool:DeviceToolName)=>void;children:React.ReactNode}){
  return <button title={has(device,tool)?toolLabels[tool]:`${toolLabels[tool]} unavailable`} disabled={disabled||!has(device,tool)} onClick={()=>invoke(tool)}>{children}</button>;
}
