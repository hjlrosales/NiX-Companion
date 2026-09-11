import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Conversation, Message } from '../shared/contracts';
import './ui.css';
import './theme.css';
import { Tasks } from './tasks';
import { Settings } from './settings';
import { VoiceInput, SpeakButton } from './voice';
import { CapabilitiesView } from './capabilities';
import { DevicesView } from './devices';

function timeAgo(value: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function Icon({ name }: { name: 'chat' | 'tasks' | 'capabilities' | 'devices' | 'plus' | 'settings' | 'refresh' | 'send' | 'stop' }) {
  const glyphs = { chat: 'C', tasks: 'T', capabilities: '/', devices: 'D', plus: '+', settings: 'S', refresh: 'R', send: '^', stop: '!' };
  return <span className="icon" aria-hidden="true">{glyphs[name]}</span>;
}

function StatusPill({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger'; children: React.ReactNode }) {
  return <span className={`status-pill ${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

function ConversationItem({ item, selected, disabled, active, onLoad, onDelete }: { item: Conversation; selected: boolean; disabled: boolean; active: boolean; onLoad: () => void; onDelete: (event: React.MouseEvent) => void }) {
  return <button className={selected ? 'conversation selected' : 'conversation'} onClick={onLoad} onContextMenu={onDelete} disabled={disabled}>
    <span className="conversation-title">{item.title}</span>
    <span className="conversation-meta"><span>{timeAgo(item.updatedAt)}</span>{active && <span className="live-indicator">active</span>}</span>
  </button>;
}

function App() {
  const [view, setView] = useState<'chat' | 'tasks' | 'capabilities' | 'devices' | 'settings'>('chat');
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
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const currentConversation = conversations.find(c => c.id === selected);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Please try again.');
  const refresh = async () => {
    setChecking(true);
    try { setModels(await window.nix.models()); setConnected(true); setError(''); }
    catch (e) { setConnected(false); fail(e); }
    finally { setChecking(false); }
  };
  const load = async (id: string) => {
    selectedRef.current = id; setSelected(id); setMessages([]); setDraft('');
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
  useEffect(() => { if (messages.length) bottom.current?.scrollIntoView({ behavior: 'instant' }); }, [messages]);
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
    try {
      let id = selected;
      if (!id) { const item = await window.nix.create(); id = item.id; selectedRef.current = id; setSelected(id); }
      await window.nix.send({ conversationId: id, content, model });
      setDraft('');
      const [history, snapshot] = await Promise.all([window.nix.messages(id), window.nix.snapshot()]);
      if (selectedRef.current === id) setMessages(history);
      setConversations(snapshot.conversations); setActive(snapshot.active);
    } catch (e) { fail(e); } finally { setSending(false); }
  };
  return <div className="app">
    <aside className="sidebar">
      <div className="brand">
        <span className="mark"><img src="./nix-emblem.png" alt="NiX emblem" /></span>
        <div><strong>NiX</strong><span> Companion</span><small>Local AI operations</small></div>
      </div>
      <div className="view-switch" aria-label="Workspace view">
        <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}><Icon name="chat" />Chat</button>
        <button aria-label={'\u2318 Tasks'} className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><Icon name="tasks" />Tasks</button>
      </div>
      <button className={view === 'capabilities' ? 'settings-button active' : 'settings-button'} onClick={() => setView('capabilities')}><Icon name="capabilities" />Capabilities</button>
      <button className={view === 'devices' ? 'settings-button active' : 'settings-button'} onClick={() => setView('devices')}><Icon name="devices" />Devices</button>
      <button className="new primary-action" onClick={() => void create()} disabled={sending}><Icon name="plus" />New conversation</button>
      <div className="nav-heading"><span>Conversations</span><span>{conversations.length}</span></div>
      <nav aria-label="Conversations">
        {conversations.length === 0 && <p className="empty-nav">Your conversations will appear here.</p>}
        {conversations.map(item => <ConversationItem key={item.id} item={item} selected={selected === item.id} active={active === item.id} disabled={sending} onLoad={() => void load(item.id)} onDelete={e => { e.preventDefault(); void deleteConversation(item.id); }} />)}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-note"><StatusPill tone="success">Stored on this PC</StatusPill><small>Local by default. Online models are optional.</small></div>
        <button className={view === 'settings' ? 'settings-button active' : 'settings-button'} onClick={() => setView('settings')}><Icon name="settings" />Settings</button>
        {selected && <button className="delete-conversation ghost-danger" onClick={() => void deleteConversation(selected)} disabled={sending || active === selected}>Delete conversation</button>}
      </div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div>
          <div className="eyebrow">NIX OPERATIONS</div>
          <h1>{view === 'tasks' ? 'Mission control' : view === 'capabilities' ? 'Capabilities' : view === 'devices' ? 'Devices' : view === 'settings' ? 'Settings' : currentConversation?.title ?? 'Your intelligence. Your machine.'}</h1>
          <p>{view === 'tasks' ? 'Plan, approve, execute, and verify local work.' : view === 'capabilities' ? 'Inspect installed skills, plugins, apps, tools, and permissions.' : view === 'devices' ? 'Pair, inspect, and control connected devices through shared tools.' : view === 'settings' ? 'Configure models, tools, and trusted integrations.' : 'A private channel to your local intelligence.'}</p>
        </div>
        <StatusPill tone={connected ? 'success' : 'warning'}>{checking ? 'Checking core' : connected ? 'Local core online' : 'Core unavailable'}</StatusPill>
      </header>
      <section className="model-bar" aria-label="Model settings">
        <div className="connection-copy"><StatusPill tone={connected ? 'success' : 'warning'}>{checking ? 'Connecting' : connected ? 'Ollama connected' : 'Ollama unavailable'}</StatusPill></div>
        <label className="select-field" htmlFor="model"><span>Model</span><select id="model" aria-label="Model" value={model} disabled={!!active || sending} onChange={e => { const value = e.target.value; setModel(value); void window.nix.selectModel(value).catch(fail); }}>{!models.includes(model) && <option value={model}>{model} (not installed)</option>}{models.map(name => <option key={name}>{name}</option>)}</select></label>
        <button className="secondary-action" onClick={() => void refresh()} disabled={checking}><Icon name="refresh" />Refresh</button>
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {connected && !models.includes(model) && <div className="notice">Select an installed model, or run <code>ollama pull qwen3:8b</code> in PowerShell and refresh.</div>}
      {view === 'settings' ? <Settings /> : view === 'capabilities' ? <CapabilitiesView onPick={prompt => { setDraft(prompt); setView('tasks'); }} /> : view === 'devices' ? <DevicesView /> : view === 'tasks' ? <Tasks model={model} /> : <>
        <section className="messages" aria-label="Messages" aria-busy={!!active}>
          {messages.length === 0 && <div className="welcome">
            <div className="core-assembly"><div className="welcome-icon"><img src="./nix-emblem.png" alt="NiX emblem" /></div><span>Ready</span></div>
            <div className="eyebrow">PRIVATE BY DESIGN</div>
            <h2>What should we work through?</h2>
            <p>Ask a question, sketch a plan, or move into Tasks when you want NiX to use tools in a workspace.</p>
            <div className="suggestions">{['Explain a coding concept', 'Help me draft a project plan', 'Brainstorm product ideas'].map(text => <button key={text} onClick={() => setDraft(text)}>{text}<span aria-hidden="true">-&gt;</span></button>)}</div>
          </div>}
          {messages.map(message => <article key={message.id} className={`message ${message.role}`}>
            <div className="message-meta"><span>{message.role === 'user' ? 'You' : 'NiX'}</span><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{message.role === 'assistant' && message.model && <span>{message.model}</span>}</div>
            <div className="message-text">{message.content || (message.status === 'streaming' ? 'Thinking...' : 'No reply received.')}</div>
            {message.error && <p className="message-error">{message.error}</p>}
            {message.status === 'streaming' && <small className="streaming">Generating response</small>}
          </article>)}<div ref={bottom} />
        </section>
        <div className="chat-voice"><VoiceInput onText={text => setDraft(text)} />{messages.filter(m => m.role === 'assistant' && m.status === 'complete').at(-1) && <SpeakButton text={messages.filter(m => m.role === 'assistant' && m.status === 'complete').at(-1)!.content} />}</div>
        <footer className="composer-wrap">
          <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
            <textarea aria-label="Message" placeholder="Message NiX..." value={draft} maxLength={6000} rows={3} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            {active ? <button type="button" aria-label="Stop reply" className="primary" onClick={() => void window.nix.cancel(active).catch(fail)}><Icon name="stop" />Stop</button> : <button aria-label={'Send \u2191'} className="primary" disabled={sending || !connected || !models.includes(model) || !draft.trim()}><Icon name="send" />{sending ? 'Starting' : 'Send'}</button>}
          </form>
          <div className="footer-note"><span>Enter to send. Shift+Enter for a new line.</span><span>4K context. Older messages may be omitted.</span></div>
        </footer>
      </>}
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
