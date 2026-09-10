import { z } from 'zod';
import type { Policy } from '../permissions/gate';
import type { ToolSpec } from '../shared/agent';
export type ToolContext = { runId: string; signal: AbortSignal };
export type ToolResult = { output: string; evidence?: string[]; artifacts?: string[] };
export type Tool = { name: string; description: string; schema: z.ZodType; policy: Policy; execute: (args: any, context: ToolContext) => Promise<ToolResult> };
export class Registry {
  private entries = new Map<string, Tool>();
  add(tool: Tool) { if (this.entries.has(tool.name)) throw new Error('Duplicate tool.'); this.entries.set(tool.name, tool); return this; }
  get(name: string) { const tool = this.entries.get(name); if (!tool) throw new Error(`Unknown tool: ${name}`); return tool; }
  specs(): ToolSpec[] { return [...this.entries.values()].map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.schema) } })); }
}
export function mockRegistry() {
  return new Registry()
    .add({ name: 'mock_echo', description: 'Echo text to verify the tool loop.', schema: z.object({ text: z.string().max(1000) }).strict(), policy: 'allow', execute: async a => ({ output: a.text, evidence: ['Mock echo executed'] }) })
    .add({ name: 'mock_action', description: 'An approval-required mock action, with no real side effect.', schema: z.object({ text: z.string().max(1000) }).strict(), policy: 'ask', execute: async a => ({ output: a.text, evidence: ['Approved mock action executed'] }) })
    .add({ name: 'mock_fail', description: 'Return a controlled failure for testing.', schema: z.object({}).strict(), policy: 'allow', execute: async () => { throw new Error('Intentional mock failure'); } })
    .add({ name: 'mock_denied', description: 'A denied mock action.', schema: z.object({}).strict(), policy: 'deny', execute: async () => { throw new Error('DENIED TOOL MUST NEVER EXECUTE'); } });
}
