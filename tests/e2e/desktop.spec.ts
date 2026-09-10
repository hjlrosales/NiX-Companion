import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('desktop streams, stops, rejects malformed IPC and continues persisted conversation after restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nix-desktop-'));
  const requests: { messages: { content: string }[] }[] = [];
  let unavailable = false;
  const server = createServer((req, res) => {
    if (unavailable) { res.writeHead(503); res.end(); return; }
    if (req.url === '/api/tags') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'local:8b' }, { name: 'test:cloud' }] })); return; }
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const input = JSON.parse(body); requests.push(input);
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ message: { content: 'Remembered: violet.' }, done: false }) + '\n');
      if (input.messages.at(-1).content === 'Keep going') return;
      setTimeout(() => res.end('{"done":true}\n'), 150);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const env = { ...process.env, NIX_USER_DATA: folder, NIX_OLLAMA_URL: `http://127.0.0.1:${port}` };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: ['.'], env });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch(); let page = await app.firstWindow();
    await expect(page.getByText('Ollama connected')).toBeVisible();
    await page.getByLabel('Model', { exact: true }).selectOption('local:8b');
    expect(await page.locator('option').allTextContents()).not.toContain('test:cloud');
    expect(await page.evaluate(() => typeof (window as unknown as { require: unknown }).require)).toBe('undefined');
    expect(await app.evaluate(({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): Record<string, boolean> }; const p = contents.getLastWebPreferences(); return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }; })).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    await page.getByLabel('Message', { exact: true }).fill('Remember my color: violet'); await page.getByRole('button', { name: 'Send ↑' }).click();
    await expect(page.getByText('Remembered: violet.', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Stop reply' })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/desktop-chat.png' });
    await app.close(); app = await launch(); page = await app.firstWindow();
    await expect(page.getByText('Remembered: violet.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('local:8b');
    await page.getByLabel('Message', { exact: true }).fill('What color?'); await page.getByRole('button', { name: 'Send ↑' }).click();
    await expect(page.getByRole('button', { name: 'Stop reply' })).toHaveCount(0);
    await expect(page.getByText('Remembered: violet.', { exact: true })).toHaveCount(2);
    expect(requests[1].messages.some(m => m.content === 'Remember my color: violet')).toBe(true);
    const rejection = await page.evaluate(async () => { try { await window.nix.messages('../escape'); return false; } catch { return true; } }); expect(rejection).toBe(true);
    await page.getByLabel('Message', { exact: true }).fill('Keep going'); await page.getByRole('button', { name: 'Send ↑' }).click();
    await page.getByRole('button', { name: 'Stop reply' }).click(); await expect(page.getByText('Reply stopped.', { exact: true })).toBeVisible();
    unavailable = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('HTTP 503');
    await expect(page.getByText('Remember my color: violet', { exact: true }).last()).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 580));
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/desktop-small.png' });
  } finally { await app?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(folder, { recursive: true, force: true }); }
});
