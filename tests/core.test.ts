import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../src/storage/database';
import { ChatRuntime, context } from '../src/runtime/chat';
import { Ollama, type ModelAdapter } from '../src/models/ollama';
import type { ChatEvent } from '../src/shared/contracts';
import { buildExecutionTrace, learnedSkillToTaskSkill, synthesizeSkill, validateSkill } from '../src/shared/learned-skills';

const adapter = (chat: ModelAdapter['chat']): ModelAdapter => ({ models: async () => ['local:8b'], chat });
test('SQLite preserves history, settings and partial replies across restart', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nix-store-'));
  try {
    let store = new Store(join(folder, 'test.db'));
    const conversation = store.create();
    const message = store.begin(conversation.id, 'Remember blue', 'local:8b');
    message.content = 'Partial reply'; store.save(message); store.setModel('local:8b'); store.close();
    store = new Store(join(folder, 'test.db'));
    assert.equal(store.model(), 'local:8b');
    assert.equal(store.list()[0].title, 'Remember blue');
    assert.equal(store.messages(conversation.id)[0].content, 'Remember blue');
    assert.equal(store.messages(conversation.id)[1].status, 'interrupted');
    assert.equal(store.messages(conversation.id)[1].content, 'Partial reply');
    store.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('SQLite deletes one conversation and its messages only', () => {
  const store = new Store(':memory:');
  const first = store.create(); const second = store.create();
  store.begin(first.id, 'Delete me', 'local:8b');
  store.begin(second.id, 'Keep me', 'local:8b');
  store.deleteConversation(first.id);
  assert.throws(() => store.messages(first.id), /Conversation not found/);
  assert.equal(store.messages(second.id)[0].content, 'Keep me');
  assert.deepEqual(store.list().map(c => c.id), [second.id]);
  store.close();
});
test('SQLite deletes one task run and its audit events only', () => {
  const store = new Store(':memory:');
  const first = { id: '11111111-1111-4111-8111-111111111111', taskId: '21111111-1111-4111-8111-111111111111', goal: 'Delete task', model: 'local:8b', mode: 'mock' as const, permissionMode: 'plan' as const, workspace: '.', network: false, teach: false, attachments: [], status: 'review' as const, summary: 'done', createdAt: 1 };
  const second = { ...first, id: '33333333-3333-4333-8333-333333333333', taskId: '43333333-3333-4333-8333-333333333333', goal: 'Keep task' };
  store.putRun(first); store.putRun(second); store.event(first.id, 'run.review', { summary: 'delete' }); store.event(second.id, 'run.review', { summary: 'keep' });
  store.deleteRun(first.id);
  assert.throws(() => store.run(first.id), /Run not found/);
  assert.equal(store.events(second.id).length, 1);
  assert.deepEqual(store.runs().map(run => run.id), [second.id]);
  store.close();
});
test('SQLite stores, updates and deletes custom task skills', () => {
  const store = new Store(':memory:');
  const skill = { id: 'inp-qa', label: 'INP QA', note: 'Check INP files.', prompt: 'Read the INP file and verify it.', builtin: false as const };
  store.upsertUserTaskSkill(skill);
  assert.deepEqual(store.userTaskSkills(), [skill]);
  store.upsertUserTaskSkill({ ...skill, note: 'Updated note.' });
  assert.deepEqual(store.userTaskSkills().map(item => item.note), ['Updated note.']);
  store.deleteUserTaskSkill(skill.id);
  assert.deepEqual(store.userTaskSkills(), []);
  assert.throws(() => store.deleteUserTaskSkill(skill.id), /Task skill not found/);
  store.close();
});
test('learned skills synthesize workflow from accepted execution traces', () => {
  const store = new Store(':memory:');
  const run = { id: '11111111-1111-4111-8111-111111111111', taskId: '21111111-1111-4111-8111-111111111111', goal: 'Create verified report', model: 'local:8b', mode: 'mock' as const, permissionMode: 'plan' as const, workspace: '.', network: false, teach: true, attachments: [], status: 'completed' as const, summary: 'Report created and verified.', createdAt: 1 };
  store.putRun(run);
  store.event(run.id, 'teach.started', { note: 'capture workflow' });
  store.event(run.id, 'tool.started', { name: 'files_read', capability: { id: 'filesystem', name: 'File System', type: 'plugin' }, permissions: ['filesystem.read'], arguments: { path: 'input.txt' } });
  store.event(run.id, 'tool.result', { name: 'files_read', output: 'source text', evidence: ['Read input.txt'] });
  store.event(run.id, 'tool.started', { name: 'files_write', capability: { id: 'filesystem', name: 'File System', type: 'plugin' }, permissions: ['filesystem.write'], arguments: { path: 'report.md' } });
  store.event(run.id, 'tool.result', { name: 'files_write', output: 'Wrote report', artifacts: ['report.md'] });
  store.event(run.id, 'run.review', { summary: 'Report created and verified.' });
  store.event(run.id, 'user.accepted', { note: 'accepted' });
  const trace = buildExecutionTrace(store.run(run.id), store.events(run.id));
  assert.equal(trace.success, true);
  assert.deepEqual(trace.toolsUsed, ['files_read', 'files_write']);
  const skill = synthesizeSkill([trace], 'Verified Report');
  assert.ok(skill.workflow.some(step => step.includes('files_read')));
  assert.equal(validateSkill(skill, ['files_read', 'files_write']).requiredToolsAvailable, true);
  assert.equal(learnedSkillToTaskSkill(skill).builtin, false);
  store.close();
});
test('chat streams, persists completion and sends previous conversation context', async () => {
  const store = new Store(':memory:'); const id = store.create().id;
  const events: ChatEvent[] = [];
  let calls = 0;
  const runtime = new ChatRuntime(store, adapter(async (_model, messages, _signal, chunk) => {
    if (calls++) assert.ok(messages.some(m => m.content === 'Hello NiX'));
    chunk('Hello'); chunk(' there');
  }), e => events.push(e));
  await runtime.send({ conversationId: id, content: 'Hello NiX', model: 'local:8b' }); await runtime.idle();
  assert.equal(store.messages(id)[1].content, 'Hello there');
  assert.equal(events.at(-1)?.message.status, 'complete');
  await runtime.send({ conversationId: id, content: 'Continue', model: 'local:8b' }); await runtime.idle();
  assert.equal(store.messages(id).length, 4); store.close();
});
test('malformed calls and unavailable models never invoke inference or write messages', async () => {
  const store = new Store(':memory:'); const id = store.create().id; let calls = 0;
  const runtime = new ChatRuntime(store, adapter(async () => { calls++; }), () => {});
  for (const input of [{ conversationId: id, content: '', model: 'local:8b' }, { conversationId: '../bad', content: 'Hi', model: 'local:8b' }, { conversationId: id, content: 'Hi', model: 'cloud' }, { conversationId: id, content: 'a'.repeat(6001), model: 'local:8b' }]) await assert.rejects(runtime.send(input));
  assert.equal(calls, 0); assert.equal(store.messages(id).length, 0); store.close();
});
test('cancellation preserves partial output, blocks concurrent sends and releases slot', async () => {
  const store = new Store(':memory:'); const id = store.create().id;
  const runtime = new ChatRuntime(store, adapter(async (_model, _messages, signal, chunk) => {
    chunk('Partial'); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }), () => {});
  await runtime.send({ conversationId: id, content: 'Hi', model: 'local:8b' });
  await assert.rejects(runtime.send({ conversationId: id, content: 'Second', model: 'local:8b' }));
  runtime.cancel(id); await runtime.idle();
  assert.equal(store.messages(id)[1].status, 'cancelled'); assert.equal(store.messages(id)[1].content, 'Partial'); assert.equal(runtime.activeId(), null); store.close();
});
test('timeouts and inference failures are persisted as errors', async () => {
  for (const mode of ['timeout', 'error', 'empty']) {
    const store = new Store(':memory:'); const id = store.create().id;
    const runtime = new ChatRuntime(store, adapter(async (_model, _messages, signal) => {
      if (mode === 'error') throw new Error('Model failure');
      if (mode === 'timeout') await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }), () => {}, 10);
    await runtime.send({ conversationId: id, content: 'Hi', model: 'local:8b' }); await runtime.idle();
    assert.equal(store.messages(id)[1].status, 'error'); assert.ok(store.messages(id)[1].error); assert.equal(runtime.activeId(), null); store.close();
  }
});
test('context retains latest prompt and bounds older content', () => {
  const result = context(Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `${i}:` + 'x'.repeat(1000) })));
  assert.equal(result[0].role, 'system'); assert.ok(result.at(-1)?.content.startsWith('29:')); assert.ok(result.slice(1).reduce((n, m) => n + m.content.length, 0) <= 10000);
});
test('Ollama parser handles split UTF-8, final line without newline, errors and truncated streams', async () => {
  let mode = 'good';
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    if (mode === 'truncated') return res.end('{"message":{"content":"partial"}}\n');
    if (mode === 'malformed') return res.end('invalid\n');
    if (mode === 'error') return res.end('{"error":"out of memory"}\n');
    const bytes = Buffer.from('{"message":{"content":"Hi 🌱"},"done":false}\n{"done":true}');
    for (const byte of bytes) res.write(Buffer.from([byte]));
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try {
    const model = new Ollama(`http://127.0.0.1:${address.port}`); let result = '';
    await model.chat('local', [], new AbortController().signal, text => { result += text; }); assert.equal(result, 'Hi 🌱');
    for (mode of ['truncated', 'malformed', 'error']) await assert.rejects(model.chat('local', [], new AbortController().signal, () => {}));
    assert.throws(() => new Ollama('https://example.com')); assert.throws(() => new Ollama('http://localhost@evil.example'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
