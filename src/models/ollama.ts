import { z } from 'zod';
import type { AgentMessage, ToolSpec } from '../shared/agent';
import type { AiProviderConfig } from '../shared/integrations';
export type ModelMessage = { role: 'user' | 'assistant' | 'system'; content: string };
export interface ModelAdapter { models(): Promise<string[]>; chat(model: string, messages: ModelMessage[], signal: AbortSignal, onChunk: (text: string) => void): Promise<void> }
export const downloadableModels = ['qwen3:8b','qwen3:14b','qwen3-coder:30b','hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1'] as const;
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
    z.enum(downloadableModels).parse(model);
    const response = await this.request('/api/pull', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: model, stream: false }) });
    const data = z.object({ error: z.string().optional() }).passthrough().parse(await response.json());
    if (data.error) throw new Error(data.error);
    return this.models();
  }
  async turn(model: string, messages: AgentMessage[], tools: ToolSpec[], signal: AbortSignal) {
    const response = await this.request('/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, tools, stream: false, think: false, options: { num_ctx: 8192, num_predict: 1500 } }) });
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

const jsonHeaders = { 'Content-Type': 'application/json' };
const compactMessages = (messages: AgentMessage[] | ModelMessage[], limit: number) => {
  const retained = [];
  let size = 0;
  for (const message of [...messages].reverse()) {
    const content = message.role === 'tool' ? `Tool result from ${message.tool_name ?? 'tool'}: ${message.content}` : message.content;
    if (size + content.length > limit) break;
    retained.unshift({ role: message.role === 'tool' ? 'user' as const : message.role, content }); size += content.length;
  }
  return retained;
};
const parseModel = (model: string) => {
  const index = model.indexOf(':');
  const provider = index > 0 ? model.slice(0, index) : 'ollama';
  return provider === 'openai' || provider === 'anthropic' ? { provider, name: model.slice(index + 1) } : { provider: 'ollama', name: model };
};
export class ModelRouter implements ModelAdapter {
  private local: Ollama;
  constructor(base?: string, private providers: AiProviderConfig[] = []) { this.local = new Ollama(base); }
  updateProviders(providers: AiProviderConfig[]) { this.providers = providers; }
  private provider(id: string) { const provider = this.providers.find(p => p.provider === id); if (!provider?.apiKey) throw new Error(`Configure an API key for ${id} in Settings.`); return provider; }
  async models() {
    const local = await this.local.models().catch(() => []);
    const remote = this.providers.flatMap(provider => provider.models.map(model => `${provider.provider}:${model}`));
    if (!local.length && !remote.length) return await this.local.models();
    return [...local, ...remote].sort();
  }
  pull(model: string, signal: AbortSignal) { return this.local.pull(model, signal); }
  async chat(model: string, messages: ModelMessage[], signal: AbortSignal, onChunk: (text: string) => void) {
    const target = parseModel(model);
    if (target.provider === 'ollama') return this.local.chat(model, messages, signal, onChunk);
    const content = await this.complete(target.provider, target.name, compactMessages(messages, 18000), [], signal);
    onChunk(content.content || '');
  }
  async turn(model: string, messages: AgentMessage[], tools: ToolSpec[], signal: AbortSignal) {
    const target = parseModel(model);
    if (target.provider === 'ollama') return this.local.turn(model, messages, tools, signal);
    return this.complete(target.provider, target.name, compactMessages(messages, 24000), tools, signal);
  }
  private async complete(providerId: string, model: string, messages: {role:'user'|'assistant'|'system';content:string}[], tools: ToolSpec[], signal: AbortSignal) {
    if (providerId === 'openai') return this.openai(this.provider('openai'), model, messages, tools, signal);
    if (providerId === 'anthropic') return this.anthropic(this.provider('anthropic'), model, messages, tools, signal);
    throw new Error(`Unknown model provider: ${providerId}`);
  }
  private async openai(provider: AiProviderConfig, model: string, messages: {role:'user'|'assistant'|'system';content:string}[], tools: ToolSpec[], signal: AbortSignal) {
    const response = await fetch(new URL('/v1/chat/completions', provider.baseUrl).toString(), { method: 'POST', signal, redirect: 'error', headers: { ...jsonHeaders, Authorization: `Bearer ${provider.apiKey}` }, body: JSON.stringify({ model, messages, tools: tools.length ? tools : undefined, tool_choice: tools.length ? 'auto' : undefined, temperature: 0.2, max_tokens: 1800 }) });
    if (!response.ok) throw new Error(`OpenAI-compatible API returned HTTP ${response.status}: ${(await response.text()).slice(0,1000)}`);
    const data = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) })).optional() }) })).min(1) }).parse(await response.json());
    const message = data.choices[0].message;
    return { content: message.content ?? '', tool_calls: message.tool_calls?.map(call => ({ function: { name: call.function.name, arguments: JSON.parse(call.function.arguments || '{}') } })) };
  }
  private async anthropic(provider: AiProviderConfig, model: string, messages: {role:'user'|'assistant'|'system';content:string}[], tools: ToolSpec[], signal: AbortSignal) {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const bodyMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const response = await fetch(new URL('/v1/messages', provider.baseUrl).toString(), { method: 'POST', signal, redirect: 'error', headers: { ...jsonHeaders, 'x-api-key': provider.apiKey ?? '', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, system: system || undefined, messages: bodyMessages, tools: tools.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })), max_tokens: 1800 }) });
    if (!response.ok) throw new Error(`Anthropic API returned HTTP ${response.status}: ${(await response.text()).slice(0,1000)}`);
    const data = z.object({ content: z.array(z.discriminatedUnion('type', [z.object({ type:z.literal('text'), text:z.string() }).passthrough(), z.object({ type:z.literal('tool_use'), name:z.string(), input:z.unknown() }).passthrough()])) }).parse(await response.json());
    return { content: data.content.filter(part => part.type === 'text').map(part => part.text).join(''), tool_calls: data.content.filter(part => part.type === 'tool_use').map(part => ({ function: { name: part.name, arguments: part.input } })) };
  }
}
