import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Conversation, Message } from '../shared/contracts';
import './ui.css';
import './theme.css';
import { Tasks } from './tasks';
import { Settings } from './settings';
import {VoiceInput,SpeakButton} from './voice';

function App() {
  const [view, setView] = useState<'chat' | 'tasks' | 'settings'>('chat');
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
    try { const item = await window.nix.create(); setConversations(items => [item, ...items]); await load(item.id); setError(''); } catch (e) { fail(e); }
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
    <aside><div className="brand"><span className="mark"><img src="./nix-emblem.png" alt="NiX emblem"/></span><div>NiX <span className="muted">Companion</span><small>LOCAL INTELLIGENCE</small></div></div>
      <div className="view-switch" aria-label="Workspace view"><button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>◈ Chat</button><button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}>⌘ Tasks</button></div>
      <button className="new" onClick={() => void create()} disabled={sending}>＋ New conversation</button>
      <h2>CONVERSATIONS</h2><nav aria-label="Conversations">{conversations.length === 0 && <p className="empty-nav">Your conversations will appear here.</p>}{conversations.map(item => <button key={item.id} className={selected === item.id ? 'conversation selected' : 'conversation'} onClick={() => void load(item.id)} disabled={sending}>{item.title}</button>)}</nav>
      <div className="local-note"><span className="dot"/> Stored on this PC<small>Local inference · No API key</small></div>
      <button className="settings-button" onClick={()=>setView('settings')}>⚙ Settings</button>
    </aside>
    <main><header><div><div className="eyebrow">NIX / {view === 'chat' ? 'CONVERSATION' : 'OPERATIONS'}</div><h1>{view === 'tasks' ? 'Mission control' : conversations.find(c => c.id === selected)?.title ?? 'Your intelligence. Your machine.'}</h1><p>{view === 'tasks' ? 'Plan, approve, execute, verify.' : 'A private channel to your local intelligence.'}</p></div><span className="badge"><span className="dot"/> LOCAL CORE</span></header>
      <section className="model-bar" aria-label="Model settings"><span className={connected ? 'dot' : 'dot offline'}/><span>{checking ? 'Connecting…' : connected ? 'Ollama connected' : 'Ollama unavailable'}</span><label htmlFor="model">Model</label><select id="model" value={model} disabled={!!active || sending} onChange={e => { const value = e.target.value; setModel(value); void window.nix.selectModel(value).catch(fail); }}>{!models.includes(model) && <option value={model}>{model} (not installed)</option>}{models.map(name => <option key={name}>{name}</option>)}</select><button onClick={() => void refresh()} disabled={checking}>Refresh</button></section>
      {error && <div className="error" role="alert">{error}</div>}
      {connected && !models.includes(model) && <div className="notice">Select an installed model, or run <code>ollama pull qwen3:8b</code> in PowerShell and refresh.</div>}
      {view === 'settings' ? <Settings/> : view === 'tasks' ? <Tasks model={model}/> : <><section className="messages" aria-label="Messages" aria-busy={!!active}>
        {messages.length === 0 && <div className="welcome"><div className="core-assembly"><div className="core-ring"/><div className="welcome-icon"><img src="./nix-emblem.png" alt="NiX emblem"/></div><span className="core-coordinate">01 / CORE ONLINE</span></div><div className="eyebrow">PRIVATE BY DESIGN. READY WHEN YOU ARE.</div><h2>What’s on your mind?</h2><p>Think through a problem, explore an idea, or draft something together.</p><div className="suggestions">{['Explain a coding concept', 'Help me draft a project plan', 'Brainstorm ideas with me'].map(text => <button key={text} onClick={() => setDraft(text)}>{text} <span>↗</span></button>)}</div><small>For file operations and coding, open Tasks and choose a workspace.</small></div>}
        {messages.map(message => <article key={message.id} className={`message ${message.role}`}><div className="message-meta">{message.role === 'user' ? 'YOU' : 'NiX'}<span>{message.role === 'assistant' ? message.model : ''}</span></div><div className="message-text">{message.content || (message.status === 'streaming' ? 'Thinking…' : 'No reply received.')}</div>{message.error && <p className="message-error">{message.error}</p>}{message.status === 'streaming' && <small className="streaming">Generating…</small>}</article>)}<div ref={bottom}/>
      </section>
      <div className="chat-voice"><VoiceInput onText={text=>setDraft(text)}/>{messages.filter(m=>m.role==='assistant'&&m.status==='complete').at(-1)&&<SpeakButton text={messages.filter(m=>m.role==='assistant'&&m.status==='complete').at(-1)!.content}/>}</div>
      <footer><form onSubmit={e => { e.preventDefault(); void send(); }}><textarea aria-label="Message" placeholder="Message NiX…" value={draft} maxLength={6000} rows={3} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/>{active ? <button type="button" className="primary" onClick={() => void window.nix.cancel(active).catch(fail)}>Stop reply</button> : <button className="primary" disabled={sending || !connected || !models.includes(model) || !draft.trim()}>{sending ? 'Starting…' : 'Send ↑'}</button>}</form><div className="footer-note"><span>Enter to send · Shift+Enter for a new line</span><span>4K context · Older messages may be omitted</span></div></footer></>}
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
