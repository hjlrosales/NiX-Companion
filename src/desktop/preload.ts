import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, ChatEvent } from '../shared/contracts';
const bridge: Bridge = {
  setupStatus:()=>ipcRenderer.invoke('nix:setup-status'),
  pullModel:model=>ipcRenderer.invoke('nix:pull-model',model),
  voiceStatus:()=>ipcRenderer.invoke('nix:voice-status'),
  setupVoice:()=>ipcRenderer.invoke('nix:voice-setup'),
  allowMicrophone:()=>ipcRenderer.invoke('nix:microphone'),
  transcribe:bytes=>ipcRenderer.invoke('nix:transcribe',bytes),
  speak:text=>ipcRenderer.invoke('nix:speak',text),
  cancelVoice:()=>ipcRenderer.invoke('nix:voice-cancel'),
  integrations: () => ipcRenderer.invoke('nix:integrations'),
  saveIntegrations: config => ipcRenderer.invoke('nix:save-integrations',config),
  agentState: () => ipcRenderer.invoke('nix:agent'),
  runEvents: id => ipcRenderer.invoke('nix:events', id),
  startRun: input => ipcRenderer.invoke('nix:run', input),
  resumeRun: id => ipcRenderer.invoke('nix:resume', id),
  cancelRun: id => ipcRenderer.invoke('nix:stop-run', id),
  approve: input => ipcRenderer.invoke('nix:approve', input),
  acceptRun: id => ipcRenderer.invoke('nix:accept', id),
  pickWorkspace: () => ipcRenderer.invoke('nix:pick-workspace'),
  workspace: () => ipcRenderer.invoke('nix:workspace'),
  openArtifact: input => ipcRenderer.invoke('nix:artifact', input),
  previewArtifact: input => ipcRenderer.invoke('nix:preview', input),
  exportLog: id => ipcRenderer.invoke('nix:export', id),
  onAgent: listener => { const handler = () => listener(); ipcRenderer.on('nix:agent-changed', handler); return () => { ipcRenderer.removeListener('nix:agent-changed', handler); }; },
  snapshot: () => ipcRenderer.invoke('nix:snapshot'),
  create: () => ipcRenderer.invoke('nix:create'),
  messages: id => ipcRenderer.invoke('nix:messages', id),
  models: () => ipcRenderer.invoke('nix:models'),
  selectModel: model => ipcRenderer.invoke('nix:model', model),
  send: input => ipcRenderer.invoke('nix:send', input),
  cancel: id => ipcRenderer.invoke('nix:cancel', id),
  onMessage: listener => {
    const handler = (_event: Electron.IpcRendererEvent, event: ChatEvent) => listener(event);
    ipcRenderer.on('nix:message', handler);
    return () => { ipcRenderer.removeListener('nix:message', handler); };
  }
};
contextBridge.exposeInMainWorld('nix', bridge);
