import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
export type Session = { id: string; runId: string; child: ChildProcessWithoutNullStreams; output: string; exitCode: number | null; done: boolean; container?: string; closed: Promise<void>; stopping?: Promise<void>; abort: () => void };
export const DOCKER_IMAGE = 'python:3.13-slim';
export function dockerArgs(root: string, name: string, network: boolean, command: string) {
  if (root.includes(',') || /[\r\n]/.test(root)) throw new Error('Docker workspace paths cannot contain commas or newlines.');
  return ['run', '--rm', '--pull=never', '-i', '--name', name, '--network', network ? 'bridge' : 'none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=2g', '--cpus=2', '--mount', `type=bind,source=${root},target=/workspace`, '--workdir=/workspace', DOCKER_IMAGE, 'sh', '-lc', command];
}
function command(file: string, args: string[]): Promise<void> { return new Promise((resolve, reject) => { const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' }); const timer = setTimeout(() => { child.kill(); reject(new Error(`${file} timed out.`)); }, 15000); child.once('error', e => { clearTimeout(timer); reject(e); }); child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)); }); }); }
export class Processes {
  private sessions = new Map<string, Session>();
  async start(runId: string, root: string, mode: 'host' | 'docker', network: boolean, text: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if ([...this.sessions.values()].filter(s => s.runId === runId && !s.done).length >= 4) throw new Error('A task can have at most four active processes.');
    const cwd = await realpath(root); signal.throwIfAborted();
    const id = randomUUID(); const container = mode === 'docker' ? `nix-${id}` : undefined;
    const executable = mode === 'docker' ? 'docker' : process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args = mode === 'docker' ? dockerArgs(cwd, container!, network, text) : process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', text] : ['-lc', text];
    const child = spawn(executable, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' });
    let close!: () => void;
    const session: Session = { id, runId, child, container, output: '', exitCode: null, done: false, closed: new Promise<void>(r => { close = r; }), abort: () => {} };
    this.sessions.set(id, session);
    const append = (data: Buffer | string) => { session.output = (session.output + data.toString()).slice(-24000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', e => append(`Process error: ${e.message}`)); child.stdin.on('error', () => {});
    child.once('close', code => { session.exitCode = code; session.done = true; signal.removeEventListener('abort', session.abort); close(); });
    session.abort = () => { void this.stop(runId, id).catch(e => append(`Termination error: ${e.message}`)); };
    signal.addEventListener('abort', session.abort, { once: true }); if (signal.aborted) session.abort();
    await Promise.race([session.closed, new Promise(r => setTimeout(r, 500))]);
    return this.poll(runId, id);
  }
  private get(runId: string, id: string) { const s = this.sessions.get(id); if (!s || s.runId !== runId) throw new Error('Process does not belong to this run or no longer exists.'); return s; }
  poll(runId: string, id: string) { const s = this.get(runId, id); return { sessionId: id, output: s.output, running: !s.done, exitCode: s.exitCode }; }
  write(runId: string, id: string, text: string) { const s = this.get(runId, id); if (s.done) throw new Error('Process already exited.'); s.child.stdin.write(text); return this.poll(runId, id); }
  async stop(runId: string, id: string) {
    const s = this.get(runId, id);
    if (s.stopping) return s.stopping;
    s.stopping = this.terminate(s); return s.stopping;
  }
  private async terminate(s: Session) {
    if (s.done && !s.container) return;
    if (s.container) await command('docker', ['rm', '-f', s.container]).catch(error => { if (!s.done) throw error; });
    if (!s.done && s.child.pid) {
      if (process.platform === 'win32') await command('taskkill.exe', ['/PID', String(s.child.pid), '/T', '/F']).catch(error => { if (!s.done) throw error; });
      else { try { process.kill(-s.child.pid, 'SIGKILL'); } catch (error) { if (!s.done && (error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
    }
    await s.closed;
  }
  async cleanup(runId: string) { const owned = [...this.sessions.values()].filter(s => s.runId === runId); const results = await Promise.allSettled(owned.map(s => this.stop(runId, s.id))); for (const s of owned) if (s.done) this.sessions.delete(s.id); const failed = results.find(r => r.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason; }
}
