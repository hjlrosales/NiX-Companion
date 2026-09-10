import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const folder = mkdtempSync(join(tmpdir(), 'nix-live-'));
const model = process.env.NIX_TEST_MODEL || 'qwen3:14b';
const env = { ...process.env, NIX_USER_DATA: folder, NIX_OLLAMA_URL: 'http://127.0.0.1:11434' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const launch = () => electron.launch({ args: ['.'], env });
try {
  app = await launch();
  let page = await app.firstWindow();
  await expect(page.getByText('Ollama connected')).toBeVisible();
  await page.getByLabel('Model', { exact: true }).selectOption(model);
  await page.getByLabel('Message', { exact: true }).fill('Remember this code word for our conversation: violet. Reply with just the code word.');
  await page.getByRole('button', { name: 'Send ↑' }).click();
  await expect(page.locator('.message.assistant .message-text')).toContainText(/violet/i, { timeout: 180000 });
  await expect(page.getByRole('button', { name: 'Stop reply' })).toHaveCount(0, { timeout: 180000 });
  await expect(page.locator('.message-error')).toHaveCount(0);
  await app.close(); app = await launch(); page = await app.firstWindow();
  await expect(page.locator('.message.assistant .message-text')).toContainText(/violet/i);
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue(model);
  await page.getByLabel('Message', { exact: true }).fill('What was the code word I asked you to remember? Reply with just that word.');
  await page.getByRole('button', { name: 'Send ↑' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator('.message.assistant .message-text').last()).toContainText(/violet/i, { timeout: 180000 });
  await expect(page.getByRole('button', { name: 'Stop reply' })).toHaveCount(0, { timeout: 180000 });
  await expect(page.locator('.message-error')).toHaveCount(0);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/local-ollama-restart.png' });
  console.log(`PASS: ${model} streamed two local replies and recalled the code word after a full desktop restart.`);
} finally {
  await app?.close();
  rmSync(folder, { recursive: true, force: true });
}
