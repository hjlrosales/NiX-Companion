import { z } from 'zod';
import { mergeTaskSkills, type TaskSkill } from './task-skills';
import type { IntegrationConfig } from './integrations';

export const permissionSchema = z.enum([
  'filesystem.read',
  'filesystem.write',
  'process.execute',
  'network.access',
  'browser.access',
  'media.access',
  'external.service',
  'workspace.manage',
  'skill.manage'
]);
export type CapabilityPermission = z.infer<typeof permissionSchema>;
export type CapabilityType = 'skill' | 'plugin' | 'app';
export type CapabilityStatus = 'installing' | 'loading' | 'ready' | 'disabled' | 'permission_required' | 'authentication_required' | 'unavailable' | 'error' | 'executing';

export type ToolManifest = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissions: CapabilityPermission[];
  requiresApproval: boolean;
};

export type CapabilityManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon: string;
  type: CapabilityType;
  status: CapabilityStatus;
  enabled: boolean;
  permissions: CapabilityPermission[];
  tools: ToolManifest[];
  configuration: Record<string, unknown>;
  capabilities: string[];
  instructions?: string;
  triggerConditions?: string[];
  allowedTools?: string[];
  dependencies?: string[];
  lastUsed?: number | null;
};

const schema = { type: 'object', additionalProperties: true };
const output = { type: 'object', properties: { output: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }, artifacts: { type: 'array', items: { type: 'string' } } } };
const tool = (name: string, description: string, permissions: CapabilityPermission[], requiresApproval = permissions.length > 0): ToolManifest => ({ name, description, inputSchema: schema, outputSchema: output, permissions, requiresApproval });

export const baseCapabilityManifests: CapabilityManifest[] = [
  {
    id: 'filesystem',
    name: 'File System',
    description: 'Read and manage files inside the selected workspace.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'FS',
    type: 'plugin',
    status: 'ready',
    enabled: true,
    permissions: ['filesystem.read', 'filesystem.write', 'workspace.manage'],
    tools: [
      tool('files_list', 'List entries inside the selected workspace.', ['filesystem.read'], false),
      tool('files_read', 'Read UTF-8 text inside the selected workspace.', ['filesystem.read'], false),
      tool('files_write', 'Create or replace a UTF-8 file in the workspace.', ['filesystem.write']),
      tool('files_move', 'Move a file within the workspace.', ['filesystem.write']),
      tool('files_delete', 'Delete one file from the workspace.', ['filesystem.write'])
    ],
    configuration: { boundary: 'workspace' },
    capabilities: ['workspace_files']
  },
  {
    id: 'terminal',
    name: 'Terminal Runtime',
    description: 'Run bounded host or container processes for task execution.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'PS',
    type: 'plugin',
    status: 'ready',
    enabled: true,
    permissions: ['process.execute', 'network.access'],
    tools: [
      tool('terminal_start', 'Start a shell command for the current run.', ['process.execute']),
      tool('terminal_poll', 'Read process output and exit status.', [], false),
      tool('terminal_input', 'Send text to a process belonging to this run.', ['process.execute']),
      tool('terminal_stop', 'Terminate a process belonging to this run.', ['process.execute'], false)
    ],
    configuration: { host: 'PowerShell', docker: 'Linux container' },
    capabilities: ['process_execution']
  },
  {
    id: 'docx-processing',
    name: 'DOCX Processing',
    description: 'Instructions for inspecting, editing, reporting, and converting Office documents.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'DX',
    type: 'skill',
    status: 'ready',
    enabled: true,
    permissions: ['filesystem.read', 'filesystem.write'],
    tools: [],
    configuration: {},
    capabilities: ['document_processing', 'document_conversion'],
    instructions: 'Use document extraction and creation tools for Office/PDF work. Verify generated files before reporting completion.',
    triggerConditions: ['The user asks to inspect, summarize, edit, render, or convert a document.'],
    allowedTools: ['files_read', 'files_write', 'document_extract', 'document_create', 'process_report_docx', 'heretic_convert_start'],
    dependencies: ['documents']
  },
  {
    id: 'documents',
    name: 'Document Tools',
    description: 'Extract content and create verified document deliverables.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'DO',
    type: 'plugin',
    status: 'ready',
    enabled: true,
    permissions: ['filesystem.read', 'filesystem.write', 'process.execute'],
    tools: [
      tool('document_extract', 'Extract text from PDF, DOCX, PPTX, text, or image sources.', ['filesystem.read'], false),
      tool('document_create', 'Create source-linked reports, summaries, slides, and previews.', ['filesystem.read', 'filesystem.write', 'process.execute']),
      tool('process_report_docx', 'Create a DOCX report from running Windows processes.', ['filesystem.write', 'process.execute'])
    ],
    configuration: { runtime: 'Python worker', renderer: 'Microsoft Office when available' },
    capabilities: ['document_processing', 'report_generation']
  },
  {
    id: 'heretic',
    name: 'Heretic',
    description: 'Local model conversion and inspection through the Heretic CLI.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'HE',
    type: 'plugin',
    status: 'ready',
    enabled: true,
    permissions: ['filesystem.read', 'filesystem.write', 'process.execute', 'network.access'],
    tools: [
      tool('heretic_status', 'Check whether the Heretic CLI is available.', ['process.execute'], false),
      tool('heretic_convert_start', 'Start a local model conversion and write conversion artifacts.', ['filesystem.write', 'process.execute', 'network.access'])
    ],
    configuration: { executable: 'heretic' },
    capabilities: ['document_conversion', 'model_conversion']
  },
  {
    id: 'home-theater',
    name: 'Home Theater',
    description: 'Orchestrates configured device and service integrations without owning device control itself.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'HT',
    type: 'skill',
    status: 'ready',
    enabled: true,
    permissions: ['network.access', 'external.service', 'media.access'],
    tools: [],
    configuration: {},
    capabilities: ['home_theater', 'media_playback'],
    instructions: 'Use device_list first to identify the target device. Invoke only advertised device tools through device_invoke. Use service integrations such as Netflix only as services layered above a connected device; do not assume Netflix is a TV button.',
    triggerConditions: ['The user asks to control a TV, launch a streaming service, open Netflix, play content, or operate a home theater device.'],
    allowedTools: ['device_list', 'device_discover', 'device_invoke'],
    dependencies: ['device-registry']
  },
  {
    id: 'device-registry',
    name: 'Device Registry',
    description: 'Discovers configured devices and exposes their advertised tools through one permission-gated runtime layer.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'TV',
    type: 'plugin',
    status: 'ready',
    enabled: true,
    permissions: ['network.access', 'external.service', 'media.access'],
    tools: [
      tool('device_list', 'List configured and discovered devices with connection state and capabilities.', [], false),
      tool('device_discover', 'Discover devices through configured drivers where technically possible.', ['network.access']),
      tool('device_invoke', 'Invoke one advertised tool on one connected device.', ['network.access', 'external.service', 'media.access'])
    ],
    configuration: { drivers: [] },
    capabilities: ['device_control', 'device_discovery', 'remote_control']
  },
  {
    id: 'device-manager',
    name: 'Device Manager',
    description: 'Discover, connect, and troubleshoot Bluetooth and WiFi devices including TVs, headphones, speakers, air conditioners, and other smart devices.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'DM',
    type: 'skill',
    status: 'ready',
    enabled: true,
    permissions: ['network.access', 'media.access'],
    tools: [],
    configuration: {},
    capabilities: ['bluetooth_discovery', 'wifi_discovery', 'device_troubleshoot', 'device_pairing'],
    instructions: 'Use device_discover to scan for nearby Bluetooth and WiFi devices. For each discovered device, check its connection state. If a device shows as disconnected, help the user troubleshoot: check if it is in pairing mode, verify Bluetooth/WiFi is enabled, and attempt reconnection. For connected devices, use device_list to identify available tools and device_invoke to control them. When a user attaches or mentions a device, list what can be done with it based on its advertised capabilities.',
    triggerConditions: [
      'The user mentions Bluetooth, WiFi, headphones, TV, aircon, speaker, or any physical device.',
      'The user asks to find, connect, pair, or troubleshoot a device.',
      'The user attaches a file or mentions connecting hardware.'
    ],
    allowedTools: ['device_list', 'device_discover', 'device_invoke'],
    dependencies: ['device-registry']
  },
  {
    id: 'windows-desktop',
    name: 'Windows Desktop',
    description: 'Open trusted Windows settings, inspect accessibility controls, and capture desktop verification screenshots.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'WD',
    type: 'plugin',
    status: 'ready',
    enabled: true,
    permissions: ['process.execute', 'browser.access', 'media.access', 'filesystem.write'],
    tools: [
      tool('windows_open', 'Open trusted Windows settings targets.', ['process.execute', 'browser.access']),
      tool('windows_accessibility', 'Inspect or invoke Windows accessibility controls.', ['process.execute']),
      tool('windows_screenshot', 'Capture the desktop for visual verification.', ['filesystem.write', 'media.access'])
    ],
    configuration: { targets: ['wireless_display', 'project_display'] },
    capabilities: ['desktop_automation']
  },
  {
    id: 'browser',
    name: 'Browser',
    description: 'Use an isolated browser session for web navigation and verification.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'BR',
    type: 'plugin',
    status: 'disabled',
    enabled: false,
    permissions: ['network.access', 'browser.access', 'filesystem.write'],
    tools: [
      tool('browser_navigate', 'Navigate to an HTTP(S) URL.', ['network.access', 'browser.access']),
      tool('browser_inspect', 'Inspect visible page text and controls.', ['browser.access']),
      tool('browser_action', 'Click or fill one selected page element.', ['browser.access']),
      tool('browser_screenshot', 'Save a browser screenshot artifact.', ['browser.access', 'filesystem.write'])
    ],
    configuration: { profile: 'isolated' },
    capabilities: ['web_browsing']
  },
  {
    id: 'mcp',
    name: 'MCP Servers',
    description: 'Discover schemas and call configured Model Context Protocol tools.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'MC',
    type: 'plugin',
    status: 'disabled',
    enabled: false,
    permissions: ['external.service', 'process.execute', 'network.access'],
    tools: [
      tool('mcp_discover', 'Discover tools on a configured MCP server.', ['external.service'], false),
      tool('mcp_schema', 'Inspect the schema for one discovered MCP tool.', ['external.service'], false),
      tool('mcp_call', 'Call a discovered MCP tool after schema inspection.', ['external.service'])
    ],
    configuration: { servers: 0 },
    capabilities: ['external_tools', 'domain_tools']
  },
  {
    id: 'task-skill-manager',
    name: 'Skill Manager',
    description: 'Create, list, and remove reusable task skills.',
    version: '1.0.0',
    author: 'NiX',
    icon: 'SK',
    type: 'plugin',
    status: 'ready',
    enabled: true,
    permissions: ['skill.manage'],
    tools: [
      tool('task_skill_list', 'List user-added reusable task skills.', [], false),
      tool('task_skill_add', 'Create or update a reusable task skill.', ['skill.manage']),
      tool('task_skill_delete', 'Delete one user-added reusable task skill.', ['skill.manage'])
    ],
    configuration: {},
    capabilities: ['skill_management']
  }
];

export function buildCapabilityRegistry(options: { integrations: IntegrationConfig; userSkills: TaskSkill[]; platform?: NodeJS.Platform; lastUsed?: Record<string, number> }) {
  const platform = options.platform ?? process.platform;
  const list = baseCapabilityManifests.map(capability => ({ ...capability, tools: capability.tools.map(item => ({ ...item })), permissions: [...capability.permissions], capabilities: [...capability.capabilities], lastUsed: options.lastUsed?.[capability.id] ?? null }));
  const byId = new Map(list.map(item => [item.id, item]));
  const browser = byId.get('browser');
  if (browser) { browser.enabled = options.integrations.browser; browser.status = browser.enabled ? 'ready' : 'disabled'; }
  const mcp = byId.get('mcp');
  if (mcp) { mcp.enabled = options.integrations.mcp.length > 0; mcp.status = mcp.enabled ? 'ready' : 'disabled'; mcp.configuration = { servers: options.integrations.mcp.length, labels: options.integrations.mcp.map(server => server.label) }; }
  const windows = byId.get('windows-desktop');
  if (windows) { windows.enabled = options.integrations.windows && platform === 'win32'; windows.status = windows.enabled ? 'ready' : 'unavailable'; }
  const devices = byId.get('device-registry');
  if (devices) {
    const drivers = ['Bluetooth / WiFi', ...options.integrations.homeAssistant ? ['Home Assistant'] : []];
    devices.enabled = true;
    devices.status = 'ready';
    devices.configuration = { drivers, services: options.integrations.services.map(service => ({ id: service.id, name: service.name, enabled: service.enabled, authenticated: service.authenticated })) };
  }
  for (const skill of mergeTaskSkills(options.userSkills.filter((item): item is TaskSkill & { builtin: false } => !item.builtin))) {
    if (skill.builtin) continue;
    list.push({
      id: `user-skill-${skill.id}`,
      name: skill.label,
      description: skill.note,
      version: '1.0.0',
      author: 'User',
      icon: 'US',
      type: 'skill',
      status: 'ready',
      enabled: true,
      permissions: [],
      tools: [],
      configuration: { prompt: skill.prompt },
      capabilities: ['custom_workflow'],
      instructions: skill.prompt,
      triggerConditions: [skill.note],
      allowedTools: [],
      dependencies: [],
      lastUsed: options.lastUsed?.[`user-skill-${skill.id}`] ?? null
    });
  }
  return list;
}

export function capabilityByTool(capabilities: CapabilityManifest[], toolName: string) {
  return capabilities.find(capability => capability.tools.some(tool => tool.name === toolName));
}

export function resolveSkillsForGoal(goal: string, capabilities: CapabilityManifest[]) {
  const text = goal.toLowerCase();
  return capabilities.filter(capability => capability.type === 'skill' && capability.enabled && (
    capability.capabilities.some(value => text.includes(value.replaceAll('_', ' '))) ||
    capability.triggerConditions?.some(value => value.toLowerCase().split(/\W+/).filter(part => part.length > 3).some(part => text.includes(part))) ||
    capability.name.toLowerCase().split(/\W+/).some(part => part.length > 3 && text.includes(part))
  )).slice(0, 5);
}
