import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { HomeAssistant, homeAssistantSchema } from '../src/devices/home-assistant';
import { Registry } from '../src/tools/registry';

test('Home Assistant config only accepts local origins and paired lights/switches', () => {
  assert.ok(homeAssistantSchema.safeParse({ url: 'http://homeassistant.local:8123/', token: 'token', entities: ['light.office'] }).success);
  assert.ok(homeAssistantSchema.safeParse({ url: 'http://192.168.1.20:8123/', token: 'token', entities: ['switch.desk'] }).success);
  assert.ok(!homeAssistantSchema.safeParse({ url: 'https://example.com/', token: 'token', entities: ['light.office'] }).success);
  assert.ok(!homeAssistantSchema.safeParse({ url: 'http://user:pass@192.168.1.20:8123/', token: 'token', entities: ['light.office'] }).success);
  assert.ok(!homeAssistantSchema.safeParse({ url: 'http://192.168.1.20:8123/api', token: 'token', entities: ['light.office'] }).success);
  assert.ok(!homeAssistantSchema.safeParse({ url: 'http://192.168.1.20:8123/', token: 'token', entities: ['sensor.temperature'] }).success);
});

test('Home Assistant verifies tokens, gates unpaired entities and confirms state changes', async () => {
  let office = 'off';
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer test-token') {
      res.writeHead(401).end();
      return;
    }
    seen.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/') {
      res.end(JSON.stringify({ message: 'API running.' }));
      return;
    }
    if (req.url === '/api/states/light.office') {
      res.end(JSON.stringify({ entity_id: 'light.office', state: office }));
      return;
    }
    if (req.url === '/api/services/light/turn_on' && req.method === 'POST') {
      office = 'on';
      res.end(JSON.stringify([]));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const ha = new HomeAssistant({ url: `http://127.0.0.1:${port}/`, token: 'test-token', entities: ['light.office'] });
  const signal = new AbortController().signal;
  try {
    assert.deepEqual(await ha.verify(signal), ['light.office']);
    await assert.rejects(ha.state('switch.unpaired', signal), /Unpaired/);
    const registry = ha.addTools(new Registry());
    assert.equal(registry.get('device_state').policy, 'ask');
    assert.equal(registry.get('device_set').policy, 'ask');
    const result = await registry.get('device_set').execute({ entity: 'light.office', state: 'on' }, { runId: 'run', signal });
    assert.match(result.output, /"state":"on"/);
    assert.deepEqual(result.evidence, ['light.office reported on']);
    assert.ok(seen.includes('POST /api/services/light/turn_on'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
