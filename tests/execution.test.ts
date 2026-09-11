import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/executors/workspace';
import { Processes, dockerArgs } from '../src/executors/processes';
import { Registry } from '../src/tools/registry';
import { hereticTools } from '../src/tools/heretic';
import { windowsTools } from '../src/tools/windows';
import { taskSkillTools, type SkillStore } from '../src/tools/task-skills';
import { buildCapabilityRegistry, capabilityByTool } from '../src/shared/capabilities';
import { defaultIntegrationConfig } from '../src/shared/integrations';
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
test('Heretic conversion tools are host-only and default to 4-bit quantization', () => {
  const processes = new Processes();
  const host = hereticTools(new Registry(), { goal: 'Convert model', model: 'test', mode: 'host', permissionMode: 'plan', workspace: '.', network: false, teach: false, attachments: [] }, processes);
  assert.ok(host.specs().some(spec => spec.function.name === 'heretic_status'));
  const convert = host.get('heretic_convert_start');
  assert.equal(convert.policy, 'ask');
  const parsed = convert.schema.parse({ model: 'Qwen/Qwen3-4B-Instruct-2507' }) as { quantization: string };
  assert.equal(parsed.quantization, 'bnb_4bit');
  const docker = hereticTools(new Registry(), { goal: 'Convert model', model: 'test', mode: 'docker', permissionMode: 'plan', workspace: '.', network: false, teach: false, attachments: [] }, processes);
  assert.equal(docker.specs().length, 0);
});
test('Windows tools expose trusted desktop settings behind approval without streaming-service buttons', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nix-windows-'));
  try {
    const registry = windowsTools(new Registry(), root, process.cwd());
    const open = registry.get('windows_open');
    assert.equal(open.policy, 'ask');
    assert.doesNotThrow(() => open.schema.parse({ target: 'wireless_display' }));
    assert.doesNotThrow(() => open.schema.parse({ target: 'project_display' }));
    assert.throws(() => open.schema.parse({ target: 'netflix' }));
    assert.throws(() => open.schema.parse({ target: 'arbitrary_url' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('Task skill tools add, list and delete reusable prompt shortcuts', async () => {
  const skills: SkillStore['userTaskSkills'] extends () => infer T ? T : never = [];
  let changed = 0;
  const store: SkillStore = {
    userTaskSkills: () => skills,
    upsertUserTaskSkill: skill => {
      const index = skills.findIndex(item => item.id === skill.id);
      if (index >= 0) skills[index] = skill;
      else skills.push(skill);
    },
    deleteUserTaskSkill: id => {
      const index = skills.findIndex(item => item.id === id);
      if (index < 0) throw new Error('Task skill not found.');
      skills.splice(index, 1);
    }
  };
  const registry = taskSkillTools(new Registry(), store, () => { changed++; });
  assert.ok(registry.specs().some(spec => spec.function.name === 'task_skill_add'));
  const add = registry.get('task_skill_add');
  assert.equal(add.policy, 'ask');
  await add.execute({ label: 'INP QA', note: 'Check INP files.', prompt: 'Read the INP file and verify it.' }, { runId: 'test', signal: new AbortController().signal });
  assert.equal(skills[0].id, 'inp-qa');
  assert.equal(changed, 1);
  const list = await registry.get('task_skill_list').execute({}, { runId: 'test', signal: new AbortController().signal });
  assert.match(list.output, /INP QA/);
  await registry.get('task_skill_delete').execute({ id: 'inp-qa' }, { runId: 'test', signal: new AbortController().signal });
  assert.deepEqual(skills, []);
  assert.equal(changed, 2);
});
test('capability registry exposes skills, plugins, tools and permission metadata', () => {
  const capabilities = buildCapabilityRegistry({ integrations: defaultIntegrationConfig, userSkills: [], platform: 'win32' });
  const heretic = capabilities.find(item => item.id === 'heretic');
  assert.equal(heretic?.type, 'plugin');
  assert.ok(heretic?.tools.some(tool => tool.name === 'heretic_convert_start' && tool.permissions.includes('process.execute') && tool.requiresApproval));
  const docx = capabilities.find(item => item.id === 'docx-processing');
  assert.equal(docx?.type, 'skill');
  assert.ok(docx?.allowedTools?.includes('document_create'));
  assert.equal(capabilityByTool(capabilities, 'windows_open')?.id, 'windows-desktop');
  assert.equal(capabilityByTool(capabilities, 'device_invoke')?.id, 'device-registry');
  assert.equal(capabilities.find(item=>item.id==='home-theater')?.type,'skill');
});
