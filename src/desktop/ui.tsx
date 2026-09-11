import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import type { Conversation, Message } from '../shared/contracts';
import type { ProcessedAttachment } from '../shared/attachments';
import './ui.css';
import './theme.css';
import { Tasks } from './tasks';
import { Settings } from './settings';
import { VoiceInput, SpeakButton, SaveMp3Button } from './voice';
import { CapabilitiesView } from './capabilities';
import { DevicesView } from './devices';
import { MessageComposer } from './composer';

/* ─── Helpers ───────────────────────────────────────────── */

function timeAgo(value: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/* ─── SVG Icons ─────────────────────────────────────────── */

function NavIcon({ name }: { name: 'chat' | 'tasks' | 'settings' | 'capabilities' | 'devices' }) {
  if (name === 'chat') return <span className="nav-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 2h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-2.5 2.5V3a1 1 0 011-1z"/></svg></span>;
  if (name === 'tasks') return <span className="nav-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="2" y="2" width="11" height="11" rx="2"/><path d="M5 7.5l2 2 3.5-4"/></svg></span>;
  if (name === 'capabilities') return <span className="nav-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="7.5" cy="7.5" r="5.5"/><path d="M7.5 5v5M5 7.5h5"/></svg></span>;
  if (name === 'devices') return <span className="nav-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="3" y="2" width="9" height="11" rx="1.5"/><line x1="6" y1="12" x2="9" y2="12"/></svg></span>;
  return <span className="nav-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="7.5" cy="7.5" r="2"/><path d="M7.5 1.5v1.5M7.5 12v1.5M13.5 7.5h-1.5M3 7.5H1.5M11.8 3.2l-1 1M4.2 10.8l-1 1M11.8 11.8l-1-1M4.2 4.2l-1-1"/></svg></span>;
}

function PlusIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>;
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  const rotate = direction === 'up' ? 180 : 0;
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rotate}deg)` }}><polyline points="2,3.5 5,6.5 8,3.5"/></svg>;
}

/* ─── Status Dot ────────────────────────────────────────── */

function statusDotClass(status: string) {
  if (status === 'running') return 'running';
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'review' || status === 'waiting') return 'warning';
  return '';
}

/* ─── App ───────────────────────────────────────────────── */

type View = 'chat' | 'tasks' | 'capabilities' | 'devices' | 'settings';

function App() {
  const [view, setView] = useState<View>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('qwen3:8b');
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ProcessedAttachment[]>([]);
  const [error, setError] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showJump, setShowJump] = useState(false);

  const currentConversation = conversations.find(c => c.id === selected);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Please try again.');

  /* ── Data loading ── */
  const refresh = async () => {
    setChecking(true);
    try { setModels(await window.nix.models()); setConnected(true); setError(''); }
    catch (e) { setConnected(false); fail(e); }
    finally { setChecking(false); }
  };

  const load = async (id: string) => {
    selectedRef.current = id; setSelected(id); setMessages([]); setDraft(''); setAttachments([]);
    try { const next = await window.nix.messages(id); if (selectedRef.current === id) setMessages(next); } catch (e) { fail(e); }
  };

  useEffect(() => {
    const unsubscribe = window.nix.onMessage(event => {
      setActive(event.message.status === 'streaming' ? event.conversationId : null);
      if (selectedRef.current === event.conversationId) setMessages(previous => {
        const index = previous.findIndex(m => m.id === event.message.id);
        return index < 0 ? [...previous, event.message] : previous.map(m => m.id === event.message.id ? event.message : m);
      });
    });
    void window.nix.snapshot().then(snapshot => {
      setConversations(snapshot.conversations); setModel(snapshot.selectedModel); setActive(snapshot.active);
      if (snapshot.conversations[0]) void load(snapshot.conversations[0].id);
    }).catch(fail);
    void refresh();
    return unsubscribe;
  }, []);

  /* ── Auto-scroll ── */
  useEffect(() => {
    if (autoScroll && chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = chatRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(atBottom);
    setShowJump(!atBottom && messages.length > 0);
  }, [messages.length]);

  const jumpToLatest = () => {
    setAutoScroll(true);
    setShowJump(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  /* ── Conversation actions ── */
  const create = async () => {
    try { const item = await window.nix.create(); setConversations(items => [item, ...items]); await load(item.id); setView('chat'); setError(''); } catch (e) { fail(e); }
  };

  const deleteConversation = async (id: string) => {
    if (active === id || sending) return;
    const item = conversations.find(c => c.id === id);
    if (!confirm(`Delete "${item?.title ?? 'this conversation'}"? This removes its messages from this PC.`)) return;
    try {
      await window.nix.deleteConversation(id);
      const next = conversations.filter(c => c.id !== id);
      setConversations(next);
      if (selectedRef.current === id) {
        selectedRef.current = next[0]?.id ?? null;
        setSelected(next[0]?.id ?? null);
        setMessages([]);
        if (next[0]) await load(next[0].id);
      }
      setError('');
    } catch (e) { fail(e); }
  };

  const send = async () => {
    if (!draft.trim() || active || sending) return;
    setSending(true); setError('');
    const content = draft.trim();
    const readyAttachments = attachments.filter(attachment => attachment.status === 'ready');
    try {
      let id = selected;
      if (!id) { const item = await window.nix.create(); id = item.id; selectedRef.current = id; setSelected(id); }
      await window.nix.send({ conversationId: id, content, model, attachments: readyAttachments });
      setDraft(''); setAttachments([]);
      const [history, snapshot] = await Promise.all([window.nix.messages(id), window.nix.snapshot()]);
      if (selectedRef.current === id) setMessages(history);
      setConversations(snapshot.conversations); setActive(snapshot.active);
    } catch (e) { fail(e); } finally { setSending(false); }
  };

  const attachFiles = async () => {
    setError('');
    try {
      const files = await window.nix.attachChatFiles();
      setAttachments(previous => {
        const existing = new Set(previous.map(file => `${file.name}:${file.size}`));
        return [...previous, ...files.filter(file => !existing.has(`${file.name}:${file.size}`))].slice(0, 20);
      });
    } catch (e) { fail(e); }
  };

  /* ── Sidebar navigation ── */
  const isActive = (v: View) => view === v;
  const switchView = (v: View) => setView(v);

  const showChatSidebar = view === 'chat' || view === 'tasks';

  /* ── Render ── */
  return <div className="app">
    {/* ── Left Sidebar ── */}
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="mark"><img src="./nix-emblem.png" alt="NiX" /></span>
        <div className="sidebar-brand-text"><strong>NiX</strong><small>Companion</small></div>
      </div>
      <nav className="sidebar-nav" aria-label="Navigation">
        <button className={isActive('chat') ? 'active' : ''} onClick={() => switchView('chat')}><NavIcon name="chat" /><span>Chat</span></button>
        <button className={isActive('tasks') ? 'active' : ''} onClick={() => switchView('tasks')}><NavIcon name="tasks" /><span>Tasks</span></button>
        <button className={isActive('capabilities') ? 'active' : ''} onClick={() => switchView('capabilities')}><NavIcon name="capabilities" /><span>Capabilities</span></button>
        <button className={isActive('devices') ? 'active' : ''} onClick={() => switchView('devices')}><NavIcon name="devices" /><span>Devices</span></button>
        <button className={isActive('settings') ? 'active' : ''} onClick={() => switchView('settings')}><NavIcon name="settings" /><span>Settings</span></button>
      </nav>
      {showChatSidebar && <>
        <button className="new-task" onClick={() => void create()} disabled={sending}><PlusIcon /> <span>New chat</span></button>
        <div className="sidebar-heading"><span>Conversations</span><span>{conversations.length}</span></div>
        <div className="task-nav" aria-label="Conversations">
          {conversations.length === 0 && <p className="task-nav-empty">Your conversations will appear here.</p>}
          {conversations.map(item => <button key={item.id} className={`task-nav-item ${selected === item.id ? 'selected' : ''}`} onClick={() => void load(item.id)} onContextMenu={e => { e.preventDefault(); void deleteConversation(item.id); }} disabled={sending}>
            <strong>{item.title}</strong>
            <span className="task-nav-meta">
              <span className={`dot ${active === item.id ? 'running' : ''}`} />
              <span>{timeAgo(item.updatedAt)}</span>
            </span>
          </button>)}
        </div>
      </>}
      <div className="sidebar-bottom">
        <div className="status-pill-row">
          <span className={`status-pill ${connected ? 'success' : 'warning'}`}><span className="status-dot" />{checking ? 'Checking' : connected ? 'Online' : 'Offline'}</span>
        </div>
      </div>
    </aside>

    {/* ── Main Workspace ── */}
    <main className="workspace">
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-left">
          {view === 'tasks' ? <button className="topbar-back" onClick={() => setView('chat')} aria-label="Back to chat">←</button> : null}
          <h1 className="topbar-title">{view === 'tasks' ? 'Mission control' : view === 'capabilities' ? 'Capabilities' : view === 'devices' ? 'Devices' : view === 'settings' ? 'Settings' : currentConversation?.title ?? 'NiX Companion'}</h1>
        </div>
        <div className="topbar-status">
          <span className={`status-pill ${connected ? 'success' : 'warning'}`}><span className="status-dot" />{checking ? 'Checking' : connected ? 'Core online' : 'Offline'}</span>
        </div>
      </header>

      {/* Model bar (chat views only) */}
      {(view === 'chat' || view === 'tasks') && <section className="model-bar" aria-label="Model settings">
        <label className="select-field" htmlFor="model"><span>Model</span>
          <select id="model" aria-label="Model" value={model} disabled={!!active || sending} onChange={e => { const value = e.target.value; setModel(value); void window.nix.selectModel(value).catch(fail); }}>
            {!models.includes(model) && <option value={model}>{model} (not installed)</option>}
            {models.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>
        <button className="secondary-action" onClick={() => void refresh()} disabled={checking} style={{ marginLeft: 'auto' }}>Refresh</button>
      </section>}

      {error && <div className="error" role="alert">{error}</div>}
      {connected && !models.includes(model) && (view === 'chat' || view === 'tasks') && <div className="notice">Select an installed model, or run <code>ollama pull qwen3:8b</code> in PowerShell and refresh.</div>}

      {/* ── Views ── */}
      {view === 'settings' ? <Settings />
        : view === 'capabilities' ? <CapabilitiesView onPick={prompt => { setDraft(prompt); setView('chat'); }} />
        : view === 'devices' ? <DevicesView />
        : view === 'tasks' ? <Tasks model={model} />
        : /* ── Chat View ── */
        <div className="main-content">
          {/* Chat Thread */}
          <div className="chat-thread" ref={chatRef} onScroll={handleScroll} aria-label="Messages" aria-busy={!!active}>
            {messages.length === 0 && <div className="chat-welcome">
              <div className="chat-welcome-icon"><img src="./nix-emblem.png" alt="NiX" /></div>
              <h2>What should we work through?</h2>
              <p>Ask a question, sketch a plan, or switch to Tasks when you want NiX to use tools in a workspace.</p>
              <div className="chat-suggestions">{['Explain a coding concept', 'Help me draft a project plan', 'Brainstorm product ideas'].map(text => <button key={text} onClick={() => setDraft(text)}>{text}<span aria-hidden="true">→</span></button>)}</div>
            </div>}
            {messages.map(message => <article key={message.id} className={`chat-message ${message.role}`}>
              <div className="msg-header">
                <span className="msg-role">{message.role === 'user' ? 'You' : 'NiX'}</span>
                <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                {message.role === 'assistant' && message.model && <span>{message.model}</span>}
              </div>
              <div className="msg-body">{message.content || (message.status === 'streaming' ? 'Thinking...' : 'No reply received.')}</div>
              {message.error && <p className="msg-error">{message.error}</p>}
              {message.status === 'streaming' && <small className="msg-streaming">Generating response</small>}
              {message.role === 'assistant' && message.status === 'complete' && <div className="msg-actions">
                <button onClick={() => { navigator.clipboard.writeText(message.content).catch(() => {}); }}>Copy</button>
                <SaveMp3Button text={message.content} />
              </div>}
            </article>)}
            <div ref={bottomRef} />
            {showJump && <div className="jump-to-latest"><button onClick={jumpToLatest}>↓ Jump to latest</button></div>}
          </div>

          {/* Composer */}
          <footer className="composer-region">
            <div className="composer-voice">
              <VoiceInput onText={text => setDraft(text)} />
              {messages.filter(m => m.role === 'assistant' && m.status === 'complete').at(-1) && <SpeakButton text={messages.filter(m => m.role === 'assistant' && m.status === 'complete').at(-1)!.content} />}
            </div>
            <MessageComposer
              label="Message"
              placeholder="Message NiX..."
              value={draft}
              rows={2}
              onChange={setDraft}
              onSubmit={() => void send()}
              onAttach={() => void attachFiles()}
              attachDisabled={!!active || !connected || !models.includes(model)}
              attachments={attachments}
              onRemoveAttachment={id => setAttachments(previous => previous.filter(attachment => attachment.id !== id))}
              canSubmit={!!draft.trim() && !sending && !active && connected && models.includes(model) && attachments.every(attachment => attachment.status !== 'processing' && attachment.status !== 'queued')}
              busy={sending}
              hideSubmit={!!active}
              submitLabel="Send"
              submitAriaLabel="Send"
              busyLabel="Starting"
            >
              {active && <button type="button" aria-label="Stop reply" className="primary" onClick={() => void window.nix.cancel(active).catch(fail)}>Stop</button>}
            </MessageComposer>
            <div className="composer-footer"><span>Enter to send · Shift+Enter for new line</span></div>
          </footer>
        </div>
      }
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
