import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Conversation, Message } from '../shared/contracts';
import { runInputSchema, type Run, type AuditEvent, type RunStatus } from '../shared/agent';
import { userTaskSkillSchema, userTaskSkillsSchema, type UserTaskSkill } from '../shared/task-skills';
type RunInputRecord = Partial<Run> & Pick<Run, 'id' | 'taskId' | 'goal' | 'model' | 'mode' | 'workspace' | 'status' | 'summary' | 'createdAt'>;
const normalizeRun = (raw: any): Run => ({ ...raw, ...runInputSchema.parse({ goal: raw.goal, model: raw.model, mode: raw.mode, permissionMode: raw.permissionMode, workspace: raw.workspace, network: raw.network, attachments: raw.attachments }) });

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, error TEXT, model TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, runId TEXT NOT NULL REFERENCES runs(id), type TEXT NOT NULL, data TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS event_run ON events(runId,id);
      UPDATE runs SET status='interrupted' WHERE status IN ('running','waiting');
      CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversationId, createdAt);
      UPDATE messages SET status='interrupted', error='The app closed before this reply finished. Send a new message to continue.' WHERE status='streaming';`);
  }
  close() { this.db.close(); }
  list(): Conversation[] { return this.db.prepare('SELECT * FROM conversations ORDER BY updatedAt DESC, rowid DESC').all() as Conversation[]; }
  create(): Conversation {
    const item = { id: randomUUID(), title: 'New conversation', updatedAt: Date.now() };
    this.db.prepare('INSERT INTO conversations VALUES (?, ?, ?)').run(item.id, item.title, item.updatedAt);
    return item;
  }
  deleteConversation(id: string) {
    this.messages(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM messages WHERE conversationId=?').run(id);
      this.db.prepare('DELETE FROM conversations WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  messages(id: string): Message[] {
    if (!this.db.prepare('SELECT id FROM conversations WHERE id=?').get(id)) throw new Error('Conversation not found.');
    return this.db.prepare('SELECT * FROM messages WHERE conversationId=? ORDER BY createdAt, rowid').all(id) as Message[];
  }
  begin(id: string, content: string, model: string): Message {
    this.messages(id);
    const now = Date.now();
    const reply: Message = { id: randomUUID(), conversationId: id, role: 'assistant', content: '', status: 'streaming', error: null, model, createdAt: now };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      insert.run(randomUUID(), id, 'user', content, 'complete', null, model, now);
      insert.run(reply.id, id, reply.role, '', reply.status, null, model, now);
      this.db.prepare("UPDATE conversations SET title=CASE WHEN title='New conversation' THEN ? ELSE title END, updatedAt=? WHERE id=?").run(content.slice(0, 70), now, id);
      this.db.exec('COMMIT');
      return reply;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  save(message: Message) { this.db.prepare('UPDATE messages SET content=?, status=?, error=? WHERE id=?').run(message.content, message.status, message.error, message.id); }
  model(): string { return (this.db.prepare("SELECT value FROM settings WHERE key='model'").get() as { value: string } | undefined)?.value ?? 'qwen3:8b'; }
  setModel(model: string) { this.db.prepare("INSERT INTO settings VALUES ('model', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(model); }
  runs(): Run[] { return this.db.prepare('SELECT data,status FROM runs ORDER BY rowid DESC LIMIT 100').all().map(r => normalizeRun({ ...JSON.parse(r.data as string), status: r.status as RunStatus })); }
  run(id: string): Run { const row = this.db.prepare('SELECT data,status FROM runs WHERE id=?').get(id); if (!row) throw new Error('Run not found.'); return normalizeRun({ ...JSON.parse(row.data as string), status: row.status as RunStatus }); }
  putRun(run: RunInputRecord) { const normalized = normalizeRun(run); this.db.prepare('INSERT INTO runs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,status=excluded.status').run(normalized.id, normalized.taskId, JSON.stringify(normalized), normalized.status); }
  deleteRun(id: string) {
    this.run(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM events WHERE runId=?').run(id);
      this.db.prepare('DELETE FROM runs WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(runId: string, type: string, data: unknown) { const text = JSON.stringify(data); const bounded = text.length > 20000 ? JSON.stringify({ truncated: true, preview: text.slice(0, 19000) }) : text; this.db.prepare('INSERT INTO events(runId,type,data,createdAt) VALUES (?,?,?,?)').run(runId, type, bounded, Date.now()); }
  events(runId: string): AuditEvent[] { this.run(runId); return this.db.prepare('SELECT * FROM events WHERE runId=? ORDER BY id').all(runId) as AuditEvent[]; }
  setting(key: string) { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  userTaskSkills(): UserTaskSkill[] {
    const raw = this.setting('taskSkills');
    if (!raw) return [];
    return userTaskSkillsSchema.parse(JSON.parse(raw));
  }
  upsertUserTaskSkill(skill: UserTaskSkill) {
    const next = new Map(this.userTaskSkills().map(item => [item.id, item]));
    next.set(skill.id, userTaskSkillSchema.parse(skill));
    this.setSetting('taskSkills', JSON.stringify([...next.values()].slice(-50)));
  }
  deleteUserTaskSkill(id: string) {
    const current = this.userTaskSkills();
    const next = current.filter(skill => skill.id !== id);
    if (next.length === current.length) throw new Error('Task skill not found.');
    this.setSetting('taskSkills', JSON.stringify(next));
  }
}
