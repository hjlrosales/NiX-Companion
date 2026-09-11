import { z } from 'zod';
import { Registry } from '../tools/registry';
import type { DeviceDescriptor, DeviceToolName } from '../shared/devices';
import type { DeviceDriver } from './registry';
export const homeAssistantSchema=z.object({url:z.string().url().max(500).refine(value=>{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&(/^(localhost|[\w-]+\.local|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname));},'Use a local Home Assistant origin without a path or credentials'),token:z.string().min(1).max(5000),entities:z.array(z.string().regex(/^(light|switch)\.[a-z0-9_]+$/)).min(1).max(30)}).strict();
export type HomeAssistantConfig=z.infer<typeof homeAssistantSchema>;
export class HomeAssistant implements DeviceDriver {
  readonly id='home-assistant';
  readonly label='Home Assistant';
  constructor(private config:HomeAssistantConfig){}
  private async request(path:string,signal:AbortSignal,body?:unknown){const response=await fetch(this.config.url.replace(/\/$/,'')+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.config.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});if(!response.ok)throw new Error(`Home Assistant returned HTTP ${response.status}. Check pairing and token permissions.`);return response.json();}
  async verify(signal:AbortSignal){await this.request('/api/',signal);for(const entity of this.config.entities){const state=await this.request(`/api/states/${encodeURIComponent(entity)}`,signal);if(state.entity_id!==entity)throw new Error('Home Assistant returned a different entity.');}return this.config.entities;}
  async state(entity:string,signal:AbortSignal){if(!this.config.entities.includes(entity))throw new Error('Unpaired device rejected. Pair this entity in Settings first.');return this.request(`/api/states/${encodeURIComponent(entity)}`,signal);}
  async set(entity:string,state:'on'|'off',signal:AbortSignal){if(!this.config.entities.includes(entity))throw new Error('Unpaired device rejected.');const domain=entity.split('.')[0];await this.request(`/api/services/${domain}/turn_${state}`,signal,{entity_id:entity});const observed=await this.state(entity,signal);if(observed.state!==state)throw new Error(`Command sent, but device reports ${observed.state}; expected ${state}.`);return observed;}
  async discover(signal:AbortSignal):Promise<DeviceDescriptor[]>{
    const devices:DeviceDescriptor[]=[];
    for(const entity of this.config.entities){
      try{
        const state=await this.state(entity,signal);
        const domain=entity.split('.')[0] as 'light'|'switch';
        const name=typeof state.attributes?.friendly_name==='string'?state.attributes.friendly_name:entity;
        const tools=[toolDef('power_on','Turn this paired Home Assistant entity on.'),toolDef('power_off','Turn this paired Home Assistant entity off.'),toolDef('get_state','Read this paired Home Assistant entity state.',false)];
        devices.push({id:`ha:${entity}`,name,type:domain,manufacturer:'Home Assistant',model:domain,driverId:this.id,connectionState:'connected',capabilities:tools.map(tool=>tool.name),tools,authentication:{required:true,configured:true,method:'Long-lived access token'},configuration:{entity},permissions:['network.access','external.service'],discoveredState:{apps:[],raw:{entity_id:entity,state:state.state,attributes:state.attributes??{}},lastSeen:Date.now()}});
      }catch(error){
        devices.push({id:`ha:${entity}`,name:entity,type:entity.startsWith('light.')?'light':'switch',manufacturer:'Home Assistant',model:'Unknown',driverId:this.id,connectionState:'error',capabilities:[],tools:[],authentication:{required:true,configured:true,method:'Long-lived access token'},configuration:{entity,error:error instanceof Error?error.message:String(error)},permissions:['network.access','external.service'],discoveredState:{apps:[],raw:{},lastSeen:Date.now()}});
      }
    }
    return devices;
  }
  async invoke(deviceId:string,tool:DeviceToolName,args:Record<string,unknown>,signal:AbortSignal){
    const entity=deviceId.startsWith('ha:')?deviceId.slice(3):String(args.entity??'');
    if(tool==='get_state')return {output:JSON.stringify(await this.state(entity,signal))};
    if(tool==='power_on'||tool==='power_off'){const state=tool==='power_on'?'on':'off';const observed=await this.set(entity,state,signal);return {output:JSON.stringify(observed),state:{state:observed.state},evidence:[`${entity} reported ${observed.state}`]};}
    throw new Error(`Home Assistant entity ${entity} does not support ${tool}.`);
  }
  addTools(registry:Registry){const entities=this.config.entities.join(', ');registry.add({name:'device_state',description:`Read one explicitly paired Home Assistant light/switch. Paired entities: ${entities}`,schema:z.object({entity:z.string().max(100)}).strict(),policy:'ask',execute:async(a,c)=>({output:JSON.stringify(await this.state(a.entity,c.signal))})});registry.add({name:'device_set',description:`Turn a paired light/switch on or off and verify its reported state. Paired entities: ${entities}`,schema:z.object({entity:z.string().max(100),state:z.enum(['on','off'])}).strict(),policy:'ask',execute:async(a,c)=>({output:JSON.stringify(await this.set(a.entity,a.state,c.signal)),evidence:[`${a.entity} reported ${a.state}`]})});return registry;}
}

function toolDef(name:DeviceToolName,description:string,requiresApproval=true){return {name,description,inputSchema:{type:'object'},requiresApproval,sensitive:false};}
