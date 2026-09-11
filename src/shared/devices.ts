import { z } from 'zod';

export const deviceToolNameSchema = z.enum([
  'power_on',
  'power_off',
  'volume_up',
  'volume_down',
  'mute',
  'navigate_up',
  'navigate_down',
  'navigate_left',
  'navigate_right',
  'select',
  'back',
  'home',
  'menu',
  'launch_app',
  'play',
  'pause',
  'stop',
  'get_state'
]);
export type DeviceToolName = z.infer<typeof deviceToolNameSchema>;

export const deviceConnectionStateSchema = z.enum(['disconnected', 'connecting', 'connected', 'pairing_required', 'auth_required', 'unavailable', 'error']);
export type DeviceConnectionState = z.infer<typeof deviceConnectionStateSchema>;

export const deviceTypeSchema = z.enum(['tv', 'streaming_box', 'av_receiver', 'speaker', 'projector', 'light', 'switch', 'display', 'unknown']);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const deviceToolSchema = z.object({
  name: deviceToolNameSchema,
  description: z.string().min(1).max(300),
  inputSchema: z.record(z.string(), z.unknown()).default({}),
  requiresApproval: z.boolean().default(true),
  sensitive: z.boolean().default(false)
}).strict();
export type DeviceTool = z.output<typeof deviceToolSchema>;

export const discoveredAppSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  source: z.enum(['device', 'service']).default('device')
}).strict();
export type DiscoveredApp = z.output<typeof discoveredAppSchema>;

export const deviceDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._:-]{1,120}$/),
  name: z.string().min(1).max(120),
  type: deviceTypeSchema,
  manufacturer: z.string().max(120).default('Unknown'),
  model: z.string().max(120).default('Unknown'),
  driverId: z.string().min(1).max(80),
  connectionState: deviceConnectionStateSchema,
  capabilities: z.array(deviceToolNameSchema).max(40),
  tools: z.array(deviceToolSchema).max(40),
  authentication: z.object({
    required: z.boolean(),
    configured: z.boolean(),
    method: z.string().max(120).optional()
  }).strict(),
  configuration: z.record(z.string(), z.unknown()).default({}),
  permissions: z.array(z.string().min(1).max(80)).max(30).default([]),
  discoveredState: z.object({
    apps: z.array(discoveredAppSchema).max(80).default([]),
    raw: z.record(z.string(), z.unknown()).default({}),
    lastSeen: z.number().nullable().default(null)
  }).strict()
}).strict();
export type DeviceDescriptor = z.output<typeof deviceDescriptorSchema>;

export const serviceIntegrationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(120),
  type: z.enum(['streaming', 'music', 'home', 'other']),
  enabled: z.boolean().default(false),
  authenticated: z.boolean().default(false),
  permissions: z.array(z.string().min(1).max(80)).max(30).default([]),
  capabilities: z.array(z.string().min(1).max(80)).max(30).default([])
}).strict();
export type ServiceIntegration = z.output<typeof serviceIntegrationSchema>;

export type DeviceCommandResult = {
  output: string;
  state?: Record<string, unknown>;
  evidence?: string[];
};
