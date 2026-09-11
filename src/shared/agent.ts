import { z } from 'zod';
import type { CapabilityPermission } from './capabilities';
export const importedFileSchema = z.object({ path: z.string().min(1).max(500), name: z.string().min(1).max(260), kind: z.string().min(1).max(80) }).strict();
export type ImportedFile = z.infer<typeof importedFileSchema>;
export const runInputSchema = z.object({
  goal: z.string().trim().min(1).max(6000),
  model: z.string().min(1).max(200),
  mode: z.enum(['host', 'docker', 'mock']),
  permissionMode: z.enum(['plan', 'act']).default('plan'),
  workspace: z.string().min(1).max(1000),
  network: z.boolean().default(false),
  teach: z.boolean().default(false),
  attachments: z.array(importedFileSchema).max(20).default([])
}).strict();
export type RunInput = z.input<typeof runInputSchema>;
export type ParsedRunInput = z.output<typeof runInputSchema>;
export type RunStatus = 'running' | 'waiting' | 'completed' | 'review' | 'failed' | 'cancelled' | 'interrupted';
export type Run = ParsedRunInput & { id: string; taskId: string; status: RunStatus; createdAt: number; summary: string };
export type AuditEvent = { id: number; runId: string; type: string; data: string; createdAt: number };
export type Approval = { id: string; runId: string; tool: string; arguments: unknown; description: string; capabilityId?: string; capabilityName?: string; permissions?: CapabilityPermission[] };
export type AgentState = { runs: Run[]; active: string | null; approvals: Approval[] };
export type ToolCall = { function: { name: string; arguments: unknown } };
export type AgentMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: ToolCall[]; tool_name?: string };
export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export interface AgentModel { turn(model: string, messages: AgentMessage[], tools: ToolSpec[], signal: AbortSignal): Promise<{ content: string; tool_calls?: ToolCall[] }> }
