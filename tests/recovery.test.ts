import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/database';
import { AgentRuntime } from '../src/runtime/agent';
import { Registry } from '../src/tools/registry';
import { z } from 'zod';
test('run checkpoints survive restart with valid bounded audit JSON',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nix-recovery-'));let store=new Store(join(dir,'runs.db'));
  try{store.putRun({id:'run',taskId:'task',goal:'Goal',model:'test',mode:'host',workspace:dir,network:false,status:'running',summary:'',createdAt:Date.now()});store.event('run','tool.started',{name:'files_write',content:'x'.repeat(50000)});store.close();store=new Store(join(dir,'runs.db'));assert.equal(store.run('run').status,'interrupted');assert.equal(JSON.parse(store.events('run')[0].data).truncated,true);store.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('uncooperative tool timeout stops the loop and clears the active run',async()=>{
  const store=new Store(':memory:');const registry=new Registry().add({name:'hang',description:'Never returns',schema:z.object({}),policy:'allow',execute:()=>new Promise(()=>{})});
  const runtime=new AgentRuntime(store,{turn:async()=>({content:'',tool_calls:[{function:{name:'hang',arguments:{}}}]})},()=>registry,()=>{},{turns:3,failures:3,toolMs:20,runMs:1000});
  const id=runtime.start({goal:'Test',model:'test',mode:'mock',workspace:'.',network:false});await runtime.idle();assert.equal(runtime.state().active,null);assert.match(store.run(id).summary,/Tool timed out/);store.close();
});
