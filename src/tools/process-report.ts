import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Workspace } from '../executors/workspace';
import { Registry } from './registry';

const explain = (name: string, path: string, company: string) => {
  const lower = name.toLowerCase();
  const source = `${path} ${company}`.toLowerCase();
  if (lower.includes('ollama')) return 'Local AI model service used to run language models on this PC.';
  if (['chrome','msedge','firefox','brave'].some(v => lower.includes(v))) return 'Web browser process. Multiple entries are normal because browsers split tabs, extensions, and GPU work into separate processes.';
  if (['electron','node'].some(v => lower.includes(v)) || source.includes('nodejs')) return 'JavaScript or Electron runtime used by desktop apps, developer tools, or local services.';
  if (source.includes('microsoft') || path.toLowerCase().startsWith('c:\\windows')) return 'Windows or Microsoft application/service process that supports the desktop, apps, updates, security, or background features.';
  if (source.includes('autodesk') || lower.includes('adsk')) return 'Autodesk background service, licensing helper, or design application support process.';
  if (lower.includes('docker') || source.includes('docker')) return 'Docker Desktop or container support process.';
  if (lower.includes('python')) return 'Python runtime process used by scripts, local tools, automation, or AI/document workers.';
  if (lower.includes('code')) return 'Visual Studio Code or related editor/helper process.';
  if (['defender','securityhealth','msmpeng'].some(v => lower.includes(v))) return 'Windows security or antivirus protection process.';
  return 'Running application or background service. Review the path and company fields to identify its owner and purpose.';
};
const ps = `Get-Process | Sort-Object ProcessName,Id | Select-Object -First 250 | ForEach-Object {
  $path = ''; $company = ''
  try { $path = $_.Path } catch {}
  try { $company = $_.MainModule.FileVersionInfo.CompanyName } catch {}
  [pscustomobject]@{
    name = $_.ProcessName
    id = $_.Id
    cpu = $_.CPU
    memoryMb = [math]::Round($_.WorkingSet64 / 1MB, 1)
    path = $path
    company = $company
  }
} | ConvertTo-Json -Depth 3`;

export function processReportTools(registry: Registry, root: string, project: string) {
  const workspace = new Workspace(root);
  registry.add({
    name: 'process_report_docx',
    description: 'Read the current Windows running process list and create a real DOCX report in the selected workspace. Use this for requests like processes.docx or detailed process explanations.',
    schema: z.object({ path: z.string().min(1).max(200).default('processes.docx') }).strict().refine(a => a.path.toLowerCase().endsWith('.docx'), 'Output path must end with .docx'),
    policy: 'ask',
    capabilityId: 'documents',
    permissions: ['filesystem.write', 'process.execute'],
    execute: async (a, c) => {
      if (process.platform !== 'win32') throw new Error('Process DOCX reports require Windows.');
      const output = await workspace.path(a.path, true);
      const python = join(project, '.venv', 'Scripts/python.exe');
      if (!existsSync(python)) throw new Error('Python worker runtime missing. Rebuild the project .venv first.');
      const processes = await new Promise<any[]>((resolve, reject) => {
        execFile('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command', ps], { windowsHide: true, signal: c.signal, timeout: 30000, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
          if (error) reject(new Error(stderr || error.message));
          else {
            const data = JSON.parse(stdout || '[]');
            resolve((Array.isArray(data) ? data : [data]).map(item => ({ ...item, explanation: explain(String(item.name || ''), String(item.path || ''), String(item.company || '')) })));
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(python, [join(project, 'scripts/process_report.py')], { windowsHide: true, stdio: 'pipe' });
        let stdout = '', stderr = '';
        const abort = () => child.kill();
        c.signal.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', d => { stdout += d.toString(); });
        child.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-2000); });
        child.on('error', reject);
        child.once('close', code => {
          c.signal.removeEventListener('abort', abort);
          if (code !== 0) return reject(new Error(stderr || stdout || `Process report worker exited ${code}`));
          const result = JSON.parse(stdout || '{}');
          if (result.error) return reject(new Error(result.error));
          resolve();
        });
        child.stdin.end(JSON.stringify({ output, processes }));
      });
      return { output: `Created ${output} with ${processes.length} running processes and explanations.`, artifacts: [output], evidence: [`Captured ${processes.length} running processes`, `Wrote ${a.path}`] };
    }
  });
  return registry;
}
