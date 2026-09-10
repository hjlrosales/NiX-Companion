import type { ChatEvent, SendInput } from '../shared/contracts';
import { sendSchema } from '../shared/contracts';
import type { ModelAdapter, ModelMessage } from '../models/ollama';
import { Store } from '../storage/database';

export function context(messages: ModelMessage[]): ModelMessage[] {
  const selected: ModelMessage[] = [];
  let size = 0;
  for (const message of [...messages].reverse()) {
    if (size + message.content.length > 10000) break;
    selected.unshift(message); size += message.content.length;
  }
  while (selected[0]?.role === 'assistant') selected.shift();
  return [{ role: 'system', content: 'You are NiX, a local desktop chat assistant. You currently have no tools or access to files, terminal, devices, or the internet. Never claim to have performed actions. Older conversation messages may be omitted to fit context.' }, ...selected];
}
export class ChatRuntime {
  private active: { id: string; controller: AbortController; work: Promise<void> } | null = null;
  constructor(private store: Store, private adapter: ModelAdapter, private emit: (event: ChatEvent) => void, private timeoutMs = 180000) {}
  activeId() { return this.active?.id ?? null; }
  async send(raw: SendInput) {
    const input = sendSchema.parse(raw);
    if (this.active) throw new Error('Wait for the current reply or stop it first.');
    const controller = new AbortController();
    // Reserve the slot before asynchronous model validation.
    const slot = { id: input.conversationId, controller, work: Promise.resolve() };
    this.active = slot;
    try {
      if (!(await this.adapter.models()).includes(input.model)) throw new Error('Select an installed local model. Refresh the model list.');
      if (controller.signal.aborted) throw new Error('Request cancelled.');
      const previous = this.store.messages(input.conversationId).filter(m => m.status === 'complete').map(m => ({ role: m.role, content: m.content }));
      const reply = this.store.begin(input.conversationId, input.content, input.model);
      this.emit({ conversationId: input.conversationId, message: { ...reply } });
      slot.work = (async () => {
        const timeout = setTimeout(() => controller.abort(new Error('Reply timed out after three minutes.')), this.timeoutMs);
        try {
          await this.adapter.chat(input.model, context([...previous, { role: 'user', content: input.content }]), controller.signal, text => {
            if (controller.signal.aborted) throw controller.signal.reason;
            if (reply.content.length + text.length > 100000) throw new Error('Reply exceeded the output limit.');
            reply.content += text;
            this.store.save(reply);
            this.emit({ conversationId: input.conversationId, message: { ...reply } });
          });
          if (controller.signal.aborted) throw controller.signal.reason;
          if (!reply.content.trim()) throw new Error('The model returned no answer. Try another model or rephrase your message.');
          reply.status = 'complete';
        } catch (error) {
          reply.status = controller.signal.aborted && controller.signal.reason === 'cancelled' ? 'cancelled' : 'error';
          reply.error = reply.status === 'cancelled' ? 'Reply stopped.' : (controller.signal.reason instanceof Error ? controller.signal.reason.message : error instanceof Error ? error.message : 'The reply failed.');
        } finally {
          clearTimeout(timeout);
          this.store.save(reply);
          this.active = null;
          this.emit({ conversationId: input.conversationId, message: { ...reply } });
        }
      })();
    } catch (error) { this.active = null; throw error; }
  }
  cancel(id: string) { if (this.active?.id === id) this.active.controller.abort('cancelled'); }
  async idle() { await this.active?.work; }
}
