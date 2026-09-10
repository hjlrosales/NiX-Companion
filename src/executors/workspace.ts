import { lstat, realpath, readFile, writeFile, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
export class Workspace {
  constructor(readonly root: string) {}
  async path(input: string, creating = false) {
    if (!input || isAbsolute(input) || input.includes(':') || input.includes('\0') || input.split(/[\\/]/).some(p => p === '..' || /[. ]$/.test(p) && p !== '.' || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) throw new Error('Use a relative path inside the selected workspace.');
    const root = await realpath(this.root); const target = resolve(root, input); const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path escapes the workspace.');
    let current = root;
    for (const part of rel.split(/[\\/]/).filter(Boolean)) {
      current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlinks and junctions are not allowed in file tools.'); }
      catch (error) { if (creating && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    }
    return target;
  }
  async read(path: string) { const target = await this.path(path); if ((await lstat(target)).size > 2_000_000) throw new Error('File exceeds 2 MB; use a document extraction tool or inspect a smaller file.'); return (await readFile(target, 'utf8')).slice(0, 12000); }
  async list(path: string) { return (await readdir(await this.path(path), { withFileTypes: true })).slice(0, 300).map(e => `${e.isDirectory() ? '[dir]' : e.isSymbolicLink() ? '[link]' : '[file]'} ${e.name}`).join('\n'); }
  async write(path: string, content: string) {
    const target = await this.path(path, true); await mkdir(dirname(target), { recursive: true }); await this.path(path, true);
    const temp = join(dirname(target), `.nix-${randomUUID()}.tmp`);
    try { await writeFile(temp, content, { flag: 'wx' }); await rename(temp, target); } finally { await unlink(temp).catch(() => {}); }
    return target;
  }
  async move(source: string, destination: string) { const from = await this.path(source); const to = await this.path(destination, true); try { await lstat(to); throw new Error('Destination already exists.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } await rename(from, to); return to; }
  async remove(path: string) { const target = await this.path(path); if (!(await lstat(target)).isFile()) throw new Error('Only single files can be deleted.'); await unlink(target); }
}
