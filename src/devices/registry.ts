import { z } from 'zod';
import { Registry } from '../tools/registry';
import { deviceToolNameSchema, type DeviceCommandResult, type DeviceDescriptor, type DeviceToolName, type ServiceIntegration } from '../shared/devices';
import type { CapabilityPermission } from '../shared/capabilities';

export interface DeviceDriver {
  id: string;
  label: string;
  discover(signal: AbortSignal): Promise<DeviceDescriptor[]>;
  invoke(deviceId: string, tool: DeviceToolName, args: Record<string, unknown>, signal: AbortSignal): Promise<DeviceCommandResult>;
}

export class DeviceRuntime {
  constructor(private drivers: DeviceDriver[] = [], private services: ServiceIntegration[] = []) {}

  add(driver: DeviceDriver) {
    this.drivers.push(driver);
    return this;
  }

  async discover(signal: AbortSignal) {
    const devices: DeviceDescriptor[] = [];
    const errors: string[] = [];
    for (const driver of this.drivers) {
      try {
        devices.push(...this.withServices(await driver.discover(signal)));
      } catch (error) {
        errors.push(`${driver.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { devices, errors };
  }

  async list(signal: AbortSignal) {
    return this.discover(signal);
  }

  async invoke(deviceId: string, tool: DeviceToolName, args: Record<string, unknown>, signal: AbortSignal) {
    const { devices } = await this.discover(signal);
    const device = devices.find(item => item.id === deviceId);
    if (!device) throw new Error(`Device ${deviceId} is not discovered or configured.`);
    if (device.connectionState !== 'connected') throw new Error(`${device.name} is ${device.connectionState}; establish pairing/authentication before sending commands.`);
    if (!device.capabilities.includes(tool)) throw new Error(`${device.name} does not advertise ${tool}.`);
    const driver = this.drivers.find(item => item.id === device.driverId);
    if (!driver) throw new Error(`No runtime driver is available for ${device.name}.`);
    return driver.invoke(deviceId, tool, args, signal);
  }

  private withServices(devices: DeviceDescriptor[]) {
    const apps = this.services.filter(service => service.enabled).map(service => ({ id: service.id, name: service.name, source: 'service' as const }));
    if (!apps.length) return devices;
    return devices.map(device => device.capabilities.includes('launch_app') ? {
      ...device,
      discoveredState: {
        ...device.discoveredState,
        apps: [...device.discoveredState.apps, ...apps.filter(app => !device.discoveredState.apps.some(existing => existing.name.toLowerCase() === app.name.toLowerCase()))]
      }
    } : device);
  }
}

const invokeSchema = z.object({
  deviceId: z.string().min(1).max(140),
  tool: deviceToolNameSchema,
  args: z.record(z.string(), z.unknown()).default({})
}).strict();

export function deviceTools(registry: Registry, runtime: DeviceRuntime) {
  const permissions: CapabilityPermission[] = ['network.access', 'external.service', 'media.access'];
  registry.add({
    name: 'device_list',
    description: 'List configured and discovered real devices with connection state, capabilities, tools, authentication, permissions, and discovered apps. Never implies a device is connected unless the runtime reports connected.',
    schema: z.object({}).strict(),
    policy: 'allow',
    capabilityId: 'device-registry',
    permissions: [],
    execute: async (_args, context) => ({ output: JSON.stringify(await runtime.list(context.signal), null, 2) })
  });
  registry.add({
    name: 'device_discover',
    description: 'Run device discovery through configured drivers. Discovery may use local network integrations and can return pairing/authentication errors.',
    schema: z.object({}).strict(),
    policy: 'ask',
    capabilityId: 'device-registry',
    permissions: ['network.access'],
    execute: async (_args, context) => ({ output: JSON.stringify(await runtime.discover(context.signal), null, 2), evidence: ['Device discovery completed through configured drivers'] })
  });
  registry.add({
    name: 'device_invoke',
    description: 'Invoke one advertised tool on one discovered connected device. The same tool layer is used by the AI agent and graphical remote UI.',
    schema: invokeSchema,
    policy: 'ask',
    capabilityId: 'device-registry',
    permissions,
    execute: async (args, context) => {
      const result = await runtime.invoke(args.deviceId, args.tool, args.args, context.signal);
      return { output: result.output, evidence: result.evidence };
    }
  });
  return registry;
}
