import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/executors/workspace';
import { Processes, dockerArgs } from '../src/executors/processes';
test('workspace writes/reads and rejects traversal, streams, reserved names and junctions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nix-files-')); const outside = await mkdtemp(join(tmpdir(), 'nix-outside-'));
  try { const files = new Workspace(root); await files.write('folder/hello.txt', 'hello'); assert.equal(await files.read('folder/hello.txt'), 'hello');
    for (const path of ['../escape', 'C:\\outside', 'hello.txt:stream', 'NUL.txt']) await assert.rejects(files.write(path, 'bad'));
    await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); await assert.rejects(files.write('link/escape.txt', 'bad'));
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('host creates, runs and repairs a script; sessions reject other runs and cancel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nix-host-')); const files = new Workspace(root); const processes = new Processes();
  try {
    const command = process.platform === 'win32' ? "& powershell -NoProfile -File ./test.ps1" : 'sh ./test.sh'; const file = process.platform === 'win32' ? 'test.ps1' : 'test.sh';
    await files.write(file, 'exit 1'); let result = await processes.start('test', root, 'host', false, command, new AbortController().signal);
    for (let i=0; result.running && i<30; i++) { await new Promise(r => setTimeout(r, 100)); result = processes.poll('test', result.sessionId); }
    assert.equal(result.exitCode, 1); await files.write(file, process.platform === 'win32' ? "Write-Output 'REPAIRED'; exit 0" : "echo REPAIRED; exit 0");
    result = await processes.start('test', root, 'host', false, command, new AbortController().signal);
    for (let i=0; result.running && i<30; i++) { await new Promise(r => setTimeout(r, 100)); result = processes.poll('test', result.sessionId); }
    assert.equal(result.exitCode, 0); assert.match(result.output, /REPAIRED/); assert.throws(() => processes.poll('other', result.sessionId));
    const controller = new AbortController(); result = await processes.start('test', root, 'host', false, process.platform === 'win32' ? 'Start-Sleep 60' : 'sleep 60', controller.signal); controller.abort();
    await processes.cleanup('test');
  } finally { await processes.cleanup('test'); await rm(root, { recursive: true, force: true }); }
});
test('Docker command mounts only the workspace with no socket, privileges or default network', () => {
  const args = dockerArgs('C:\\work', 'nix-test', false, 'echo hello'); assert.ok(args.includes('none')); assert.ok(args.includes('--cap-drop=ALL')); assert.ok(args.includes('--pull=never')); assert.equal(args.filter(a => a.startsWith('type=bind')).length, 1); assert.ok(!args.join(' ').includes('docker.sock')); assert.throws(() => dockerArgs('C:\\bad,path', 'nix-test', true, 'echo test'));
});
