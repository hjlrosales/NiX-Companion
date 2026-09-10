import { z } from 'zod';
import type { AgentMessage, ToolSpec } from '../shared/agent';
export type ModelMessage = { role: 'user' | 'assistant' | 'system'; content: string };
export interface ModelAdapter { models(): Promise<string[]>; chat(model: string, messages: ModelMessage[], signal: AbortSignal, onChunk: (text: string) => void): Promise<void> }
const chunkSchema = z.object({ error: z.string().optional(), done: z.boolean().optional(), message: z.object({ content: z.string().optional() }).optional() });
export class Ollama implements ModelAdapter {
  constructor(private base = 'http://127.0.0.1:11434') {
    const url = new URL(base);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Ollama must use a local HTTP address.');
  }
  private async request(path: string, init: RequestInit) {
    let response: Response;
    try { response = await fetch(this.base + path, { ...init, redirect: 'error' }); }
    catch (error) { if (init.signal?.aborted) throw error; throw new Error('Cannot reach Ollama. Start Ollama on this PC, then refresh models.'); }
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}. Check that the selected model is installed and Ollama is running.`);
    return response;
  }
  async models() {
    const response = await this.request('/api/tags', { signal: AbortSignal.timeout(5000) });
    const data = z.object({ models: z.array(z.object({ name: z.string(), remote_host: z.string().optional() })) }).parse(await response.json());
    return data.models.filter(m => !m.remote_host && !/(?:-cloud|:cloud)$/.test(m.name)).map(m => m.name).sort();
  }
  async pull(model: string, signal: AbortSignal) {
    z.enum(['qwen3:8b','qwen3:14b','qwen3-coder:30b']).parse(model);
    const response = await this.request('/api/pull', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: model, stream: false }) });
    const data = z.object({ error: z.string().optional() }).passthrough().parse(await response.json());
    if (data.error) throw new Error(data.error);
    return this.models();
  }
  async turn(model: string, messages: AgentMessage[], tools: ToolSpec[], signal: AbortSignal) {
    const response = await this.request('/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, tools, stream: false, think: false, options: { num_ctx: 4096, num_predict: 1500 } }) });
    const data = z.object({ message: z.object({ content: z.string().max(30000), tool_calls: z.array(z.object({ function: z.object({ name: z.string().max(100), arguments: z.unknown() }) })).max(8).optional() }), error: z.string().optional() }).parse(await response.json());
    if (data.error) throw new Error(data.error);
    return data.message;
  }
  async chat(model: string, messages: ModelMessage[], signal: AbortSignal, onChunk: (text: string) => void) {
    const response = await this.request('/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true, think: false, options: { num_ctx: 4096, num_predict: 1024 } }) });
    if (!response.body) throw new Error('Ollama returned an empty response.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', done = false;
    const line = (raw: string) => {
      if (!raw.trim()) return;
      const item = chunkSchema.parse(JSON.parse(raw));
      if (item.error) throw new Error(item.error.slice(0, 1000));
      if (item.message?.content) onChunk(item.message.content);
      if (item.done) done = true;
    };
    try {
      while (!done) {
        const part = await reader.read();
        buffer += decoder.decode(part.value, { stream: !part.done });
        if (buffer.length > 1024 * 1024) throw new Error('Ollama response chunk exceeded the safety limit.');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); if (done) break; }
        if (part.done) { if (!done) line(buffer); break; }
      }
      if (!done) throw new Error('Ollama disconnected before completing the reply.');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
