import { randomUUID } from 'node:crypto';
import type { Approval } from '../shared/agent';
import type { CapabilityPermission } from '../shared/capabilities';
export type Policy = 'allow' | 'ask' | 'deny';
export class PermissionGate {
  private pending = new Map<string, { request: Approval; resolve: (allowed: boolean) => void }>();
  private grants = new Map<string, Set<string>>();
  constructor(private changed: () => void, private audit: (run: string, type: string, data: unknown) => void) {}
  list() { return [...this.pending.values()].map(p => p.request); }
  async check(runId: string, tool: string, args: unknown, policy: Policy, description: string, signal: AbortSignal, autoApprove = false, metadata: { capabilityId?: string; capabilityName?: string; permissions?: CapabilityPermission[] } = {}) {
    signal.throwIfAborted();
    const key = JSON.stringify([tool, args]);
    if (policy === 'deny') { this.audit(runId, 'permission.denied', { tool, arguments: args }); return false; }
    if (policy === 'allow' || autoApprove || this.grants.get(runId)?.has(key)) { this.audit(runId, autoApprove && policy === 'ask' ? 'permission.auto_approved' : 'permission.allowed', { tool, arguments: args, policy }); return true; }
    const request: Approval = { id: randomUUID(), runId, tool, arguments: args, description, ...metadata };
    return new Promise<boolean>(resolve => {
      const abort = () => finish(false);
      const finish = (allowed: boolean) => {
        signal.removeEventListener('abort', abort); this.pending.delete(request.id);
        this.audit(runId, allowed ? 'permission.approved' : 'permission.denied', request);
        this.changed(); resolve(allowed);
      };
      this.pending.set(request.id, { request, resolve: finish });
      signal.addEventListener('abort', abort, { once: true });
      this.audit(runId, 'permission.requested', request); this.changed();
    });
  }
  decide(id: string, allow: boolean, remember: boolean) {
    const pending = this.pending.get(id);
    if (!pending) throw new Error('This approval is no longer pending.');
    if (allow && remember) {
      const { runId, tool, arguments: args } = pending.request;
      const grants = this.grants.get(runId) ?? new Set<string>(); grants.add(JSON.stringify([tool, args])); this.grants.set(runId, grants);
    }
    pending.resolve(allow);
  }
  clear(runId: string) { this.grants.delete(runId); for (const p of [...this.pending.values()]) if (p.request.runId === runId) p.resolve(false); }
}
