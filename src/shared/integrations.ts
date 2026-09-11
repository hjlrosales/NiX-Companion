import { z } from 'zod';
import { homeAssistantSchema } from '../devices/home-assistant';
import { serviceIntegrationSchema } from './devices';

const serverBase={id:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),label:z.string().min(1).max(100)};
export const mcpConfigSchema=z.discriminatedUnion('transport',[
  z.object({...serverBase,transport:z.literal('stdio'),command:z.string().min(1).max(1000),args:z.array(z.string().max(2000)).max(40).default([]),env:z.record(z.string(),z.string()).default({})}).strict(),
  z.object({...serverBase,transport:z.literal('http'),url:z.string().url().max(2000).refine(v=>['http:','https:'].includes(new URL(v).protocol)&&!new URL(v).username&&!new URL(v).password,'Use HTTP(S) without embedded credentials'),token:z.string().max(4000).optional()}).strict()
]);
export type McpConfig=z.infer<typeof mcpConfigSchema>;
export const aiProviderSchema=z.discriminatedUnion('provider',[
  z.object({provider:z.literal('openai'),label:z.string().min(1).max(80).default('OpenAI'),apiKey:z.string().max(4000).optional(),baseUrl:z.string().url().max(2000).default('https://api.openai.com/v1'),models:z.array(z.string().min(1).max(120)).max(30).default(['gpt-4.1-mini'])}).strict(),
  z.object({provider:z.literal('anthropic'),label:z.string().min(1).max(80).default('Anthropic'),apiKey:z.string().max(4000).optional(),baseUrl:z.string().url().max(2000).default('https://api.anthropic.com'),models:z.array(z.string().min(1).max(120)).max(30).default(['claude-sonnet-4-5'])}).strict()
]);
export type AiProviderConfig=z.infer<typeof aiProviderSchema>;
export const integrationConfigSchema=z.object({mcp:z.array(mcpConfigSchema).max(10).default([]),browser:z.boolean().default(false),windows:z.boolean().default(true),homeAssistant:homeAssistantSchema.optional(),aiProviders:z.array(aiProviderSchema).max(4).default([]),services:z.array(serviceIntegrationSchema).max(20).default([])}).strict().refine(c=>new Set(c.mcp.map(s=>s.id)).size===c.mcp.length,'MCP server IDs must be unique').refine(c=>new Set(c.aiProviders.map(s=>s.provider)).size===c.aiProviders.length,'AI providers must be unique').refine(c=>new Set(c.services.map(s=>s.id)).size===c.services.length,'Service integration IDs must be unique');
export type IntegrationConfig=z.infer<typeof integrationConfigSchema>;

export const defaultMcpServers:McpConfig[]=[
  {id:'blender',label:'Blender MCP',transport:'stdio',command:'C:\\Users\\hjlro\\Documents\\ai\\3D\\blender_mcp\\mcp\\.venv\\Scripts\\blender-mcp.exe',args:[],env:{}},
  {id:'autodesk-mcp',label:'Autodesk Civil 3D MCP',transport:'stdio',command:'node',args:['C:\\Users\\hjlro\\Documents\\ai\\MCP\\Civil3D\\src\\server\\Autodesk.Mcp.Server\\dist\\index.js'],env:{}},
  {id:'nix-hydraulic-analyst',label:'NiX Hydraulic Analyst MCP',transport:'stdio',command:'node',args:['C:\\Users\\hjlro\\Documents\\ai\\MCP\\NixHydraulicAnalyst-MCP\\node_modules\\tsx\\dist\\cli.mjs','C:\\Users\\hjlro\\Documents\\ai\\MCP\\NixHydraulicAnalyst-MCP\\src\\server.ts'],env:{NIX_DATA_DIR:'C:\\Users\\hjlro\\Documents\\ai\\MCP\\NixHydraulicAnalyst-MCP\\data'}}
];
export const defaultIntegrationConfig:IntegrationConfig={mcp:defaultMcpServers,browser:true,windows:true,aiProviders:[],services:[{id:'netflix',name:'Netflix',type:'streaming',enabled:false,authenticated:false,permissions:['external.service','media.playback'],capabilities:['catalog_search','playback_orchestration']}]};

const claudeServerSchema=z.object({command:z.string().min(1).max(1000),args:z.array(z.string().max(2000)).max(40).default([]),env:z.record(z.string(),z.string()).default({})}).passthrough();
const claudeConfigSchema=z.object({mcpServers:z.record(z.string(),claudeServerSchema)}).passthrough();
const labelFromId=(id:string)=>id.split(/[-_]/).filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');
const mergeIntegrationConfig=(base:IntegrationConfig,next:IntegrationConfig):IntegrationConfig=>{
  const mcp=new Map(base.mcp.map(server=>[server.id,server]));
  for(const server of next.mcp)mcp.set(server.id,server);
  return integrationConfigSchema.parse({...base,...next,mcp:[...mcp.values()]});
};
export function normalizeIntegrationConfig(data:unknown,base:IntegrationConfig=defaultIntegrationConfig):IntegrationConfig{
  const direct=integrationConfigSchema.safeParse(data);
  if(direct.success)return mergeIntegrationConfig(base,direct.data);
  const claude=claudeConfigSchema.safeParse(data);
  if(claude.success){
    const imported=Object.entries(claude.data.mcpServers).map(([id,server])=>mcpConfigSchema.parse({id,label:labelFromId(id),transport:'stdio',command:server.command,args:server.args,env:server.env}));
    return mergeIntegrationConfig(base,{...base,mcp:imported});
  }
  return integrationConfigSchema.parse(data);
}
