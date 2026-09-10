import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Processes } from '../src/executors/processes';
import { Workspace } from '../src/executors/workspace';
test('real Docker creates, runs, repairs a script and cancels its container', { skip: process.env.NIX_TEST_DOCKER !== '1' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nix-docker-')); const files = new Workspace(root); const processes = new Processes();
  const run = async (text: string) => { let r = await processes.start('docker-test', root, 'docker', false, text, new AbortController().signal); for(let i=0;r.running && i<100;i++) { await new Promise(r => setTimeout(r,100)); r=processes.poll('docker-test',r.sessionId); } return r; };
  try {
    await files.write('repair.py','raise RuntimeError("repair me")'); let result = await run('python repair.py'); assert.equal(result.exitCode,1);
    await files.write('repair.py','print("DOCKER_REPAIRED")'); result=await run('python repair.py'); assert.equal(result.exitCode,0); assert.match(result.output,/DOCKER_REPAIRED/);
    result=await run('test ! -S /var/run/docker.sock && python -c "import os; print(os.listdir(\'/sys/class/net\'))"'); assert.equal(result.exitCode,0); assert.match(result.output,/\['lo'\]/);
    const signal = new AbortController(); const running=await processes.start('docker-test',root,'docker',false,'sleep 60',signal.signal); assert.equal(running.running,true); signal.abort(); await processes.cleanup('docker-test');
  } finally { await processes.cleanup('docker-test'); await rm(root,{recursive:true,force:true}); }
});
