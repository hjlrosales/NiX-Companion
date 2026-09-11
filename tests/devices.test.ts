import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { HomeAssistant, homeAssistantSchema } from '../src/devices/home-assistant';
import { DeviceRuntime, deviceTools } from '../src/devices/registry';
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
    if (req.url === '/api/services/light/turn_off' && req.method === 'POST') {
      office = 'off';
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
    const runtime = new DeviceRuntime([ha]);
    const devices = await runtime.list(signal);
    assert.equal(devices.devices[0].id, 'ha:light.office');
    assert.equal(devices.devices[0].connectionState, 'connected');
    assert.deepEqual(devices.devices[0].capabilities, ['power_on','power_off','get_state']);
    const toolRegistry = deviceTools(new Registry(), runtime);
    assert.equal(toolRegistry.get('device_invoke').policy, 'ask');
    const agentResult = await toolRegistry.get('device_invoke').execute({ deviceId: 'ha:light.office', tool: 'power_off', args: {} }, { runId: 'run', signal });
    assert.match(agentResult.output, /"state":"off"/);
    const remoteResult = await runtime.invoke('ha:light.office', 'power_on', {}, signal);
    assert.match(remoteResult.output, /"state":"on"/);
    await assert.rejects(runtime.invoke('ha:light.office', 'volume_up', {}, signal), /does not advertise/);
    const appRuntime = new DeviceRuntime([{
      id: 'fixture-tv',
      label: 'Fixture TV',
      discover: async () => [{
        id: 'tv:living-room',
        name: 'Living Room TV',
        type: 'tv',
        manufacturer: 'Fixture',
        model: 'TV',
        driverId: 'fixture-tv',
        connectionState: 'connected',
        capabilities: ['launch_app','get_state'],
        tools: [
          { name: 'launch_app', description: 'Launch an advertised app.', inputSchema: {}, requiresApproval: true, sensitive: false },
          { name: 'get_state', description: 'Read state.', inputSchema: {}, requiresApproval: false, sensitive: false }
        ],
        authentication: { required: true, configured: true, method: 'pairing' },
        configuration: {},
        permissions: ['network.access'],
        discoveredState: { apps: [], raw: {}, lastSeen: Date.now() }
      }],
      invoke: async (_deviceId, tool, args) => ({ output: `${tool}:${String(args.app ?? '')}` })
    }], [{ id: 'netflix', name: 'Netflix', type: 'streaming', enabled: true, authenticated: false, permissions: [], capabilities: [] }]);
    const appDevices = await appRuntime.list(signal);
    assert.deepEqual(appDevices.devices[0].discoveredState.apps, [{ id: 'netflix', name: 'Netflix', source: 'service' }]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
