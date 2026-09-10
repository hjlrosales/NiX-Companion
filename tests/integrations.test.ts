import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp,rm } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { McpConnections } from '../src/tools/mcp';
import { BrowserSessions } from '../src/tools/browser';
import { Registry } from '../src/tools/registry';
import { defaultIntegrationConfig, normalizeIntegrationConfig } from '../src/shared/integrations';

test('integration defaults include the user MCP servers and Claude mcpServers imports normalize',()=>{
  assert.deepEqual(defaultIntegrationConfig.mcp.map(server=>server.id),['blender','autodesk-mcp','nix-hydraulic-analyst']);
  assert.equal(defaultIntegrationConfig.browser,true);
  assert.deepEqual(normalizeIntegrationConfig({mcp:[],browser:false,windows:true}).mcp.map(server=>server.id),['blender','autodesk-mcp','nix-hydraulic-analyst']);
  const converted=normalizeIntegrationConfig({mcpServers:{blender:{command:'C:\\Tools\\blender-mcp.exe'},'nix-hydraulic-analyst':{command:'node',args:['tsx','server.ts'],env:{NIX_DATA_DIR:'C:\\data'}}}},defaultIntegrationConfig);
  const blender=converted.mcp.find(server=>server.id==='blender');
  const hydraulic=converted.mcp.find(server=>server.id==='nix-hydraulic-analyst');
  assert.equal(blender?.transport,'stdio');
  assert.equal(hydraulic?.transport,'stdio');
  assert.equal(blender.command,'C:\\Tools\\blender-mcp.exe');
  assert.deepEqual(hydraulic.args,['tsx','server.ts']);
  assert.deepEqual(hydraulic.env,{NIX_DATA_DIR:'C:\\data'});
  assert.equal(converted.browser,true);
});

test('MCP stdio discovers/calls a real server and validates arguments before invoking',async()=>{
  const mcp=new McpConnections([{id:'fixture',label:'Fixture',transport:'stdio',command:process.execPath,args:[join(process.cwd(),'tests/fixtures/mcp-server.mjs')],env:{}}]);const signal=new AbortController().signal;
  try{assert.equal((await mcp.discover('run','fixture',signal))[0].name,'echo');assert.match(await mcp.call('run','fixture','echo',{text:'hello'},signal),/MCP_ECHO:hello/);await assert.rejects(mcp.call('run','fixture','echo',{text:123},signal));await assert.rejects(mcp.call('run','unpaired','echo',{text:'hello'},signal));}finally{await mcp.cleanup('run');}
});
test('MCP Streamable HTTP authenticates, discovers and calls without redirecting credentials',async()=>{
  let count=0;
  const http=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer test-token'){res.writeHead(401).end();return;}
    if(req.method!=='POST'){res.writeHead(405).end();return;}
    let text='';for await(const part of req)text+=part.toString();
    const server=new McpServer({name:'http-fixture',version:'1'});server.registerTool('echo',{inputSchema:{text:z.string()}},async({text})=>{count++;return {content:[{type:'text',text}]};});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);res.on('close',()=>{void server.close();});await transport.handleRequest(req,res,JSON.parse(text));
  });await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
  const mcp=new McpConnections([{id:'http',label:'HTTP fixture',transport:'http',url:`http://127.0.0.1:${(http.address() as {port:number}).port}`,token:'test-token'}]);
  try{assert.match(await mcp.call('run','http','echo',{text:'HTTP_MCP_OK'},new AbortController().signal),/HTTP_MCP_OK/);assert.equal(count,1);}finally{await mcp.cleanup('run');http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));}
});
test('isolated browser completes a form task and captures evidence without a personal profile',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nix-browser-'));const browser=new BrowserSessions();const registry=browser.addTools(new Registry(),root);
  const http=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><label>Name<input id="name"></label><button id="submit" onclick="document.querySelector(\'#result\').textContent=\'Hello \'+document.querySelector(\'#name\').value">Submit</button><p id="result"></p></body></html>');});await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
  const context={runId:'browser-test',signal:new AbortController().signal};
  try{await registry.get('browser_navigate').execute({url:`http://127.0.0.1:${(http.address() as {port:number}).port}`},context);await registry.get('browser_action').execute({action:'fill',selector:'#name',text:'NiX'},context);const result=await registry.get('browser_action').execute({action:'click',selector:'#submit'},context);assert.match(result.output,/Hello NiX/);assert.equal((await registry.get('browser_screenshot').execute({},context)).artifacts?.length,1);assert.ok(registry.specs().length===4);for(const spec of registry.specs())assert.equal(registry.get(spec.function.name).policy,'ask');}finally{await browser.cleanup(context.runId);http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
