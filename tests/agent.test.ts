import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage/database';
import { AgentRuntime } from '../src/runtime/agent';
import { mockRegistry, Registry } from '../src/tools/registry';
import { PermissionGate } from '../src/permissions/gate';
import { z } from 'zod';
const input = { goal: 'Test task', model: 'test', mode: 'mock' as const, workspace: '.' , network: false };
test('denied tools never execute; feedback reaches model and failures stop loop', async () => {
  const store = new Store(':memory:'); let executed = 0, calls = 0;
  const registry = new Registry().add({ name: 'denied', description: 'Denied', schema: z.object({}), policy: 'deny', execute: async () => { executed++; return { output: '' }; } });
  const runtime = new AgentRuntime(store, { turn: async (_m, messages) => { if (calls++) assert.ok(messages.some(m => m.content.includes('Permission denied'))); return { content: '', tool_calls: [{ function: { name: 'denied', arguments: {} } }] }; } }, () => registry, () => {});
  const id = runtime.start(input); await runtime.idle(); assert.equal(executed, 0); assert.equal(calls, 3); assert.equal(store.run(id).status, 'failed'); store.close();
});
test('malformed arguments fail before permission or execution; turn limit is enforced', async () => {
  const store = new Store(':memory:'); const runtime = new AgentRuntime(store, { turn: async () => ({ content: '', tool_calls: [{ function: { name: 'mock_echo', arguments: { text: 123 } } }] }) }, mockRegistry, () => {}, { turns: 2, failures: 9, toolMs: 100, runMs: 1000 });
  const id = runtime.start(input); await runtime.idle(); assert.match(store.run(id).summary, /2-turn/); assert.equal(store.events(id).filter(e => e.type === 'tool.started').length, 0); store.close();
});
test('approvals apply only to exact arguments in the same run and cancellation clears pending requests', async () => {
  const gate = new PermissionGate(() => {}, () => {}); const signal = new AbortController();
  const first = gate.check('a', 'write', { path: 'a' }, 'ask', 'Write', signal.signal);
  gate.decide(gate.list()[0].id, true, true); assert.equal(await first, true);
  assert.equal(await gate.check('a', 'write', { path: 'a' }, 'ask', 'Write', signal.signal), true);
  const next = gate.check('b', 'write', { path: 'a' }, 'ask', 'Write', signal.signal); assert.equal(gate.list().length, 1); signal.abort(); assert.equal(await next, false); assert.equal(gate.list().length, 0);
});
test('successful tools yield evidence but model claims require user review', async () => {
  const store = new Store(':memory:'); let turn = 0;
  const runtime = new AgentRuntime(store, { turn: async () => turn++ ? { content: 'Done' } : { content: '', tool_calls: [{ function: { name: 'mock_echo', arguments: { text: 'hello' } } }] } }, mockRegistry, () => {});
  const id = runtime.start(input); await runtime.idle(); assert.equal(store.run(id).status, 'review'); assert.ok(store.events(id).some(e => e.type === 'tool.result' && e.data.includes('Mock echo executed'))); store.close();
});
