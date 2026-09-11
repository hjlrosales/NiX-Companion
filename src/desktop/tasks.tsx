import React, { useEffect, useState, useRef } from 'react';
import type { AgentState, AuditEvent, RunInput, ImportedFile, Run } from '../shared/agent';
import { VoiceInput, SaveMp3Button } from './voice';
import type { TaskSkill } from '../shared/task-skills';
import type { CapabilityManifest } from '../shared/capabilities';
import { CapabilityPicker } from './capabilities';
import type { ExecutionTrace, LearnedSkill, SkillValidation } from '../shared/learned-skills';
import type { ProcessedAttachment } from '../shared/attachments';
import { MessageComposer } from './composer';

/* ─── Helpers ───────────────────────────────────────────── */

function parseData(event: AuditEvent) {
  try { return JSON.parse(event.data); } catch { return event.data; }
}

function eventTitle(event: AuditEvent) {
  if (event.type === 'user.message') return 'User request';
  if (event.type === 'run.review') return 'Review ready';
  if (event.type === 'tool.call') return 'Tool requested';
  if (event.type === 'capability.discovery') return 'Capability discovery';
  if (event.type === 'tool.started') return 'Tool started';
  if (event.type === 'tool.result') return 'Tool executed';
  if (event.type === 'tool.error') return 'Tool failed';
  if (event.type.includes('approval')) return 'Permission event';
  const label = event.type.replaceAll('.', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function eventTone(type: string) {
  if (type.includes('error') || type.includes('denied') || type.includes('failed')) return 'danger';
  if (type.includes('approval') || type.includes('waiting') || type.includes('review')) return 'warning';
  if (type.includes('result') || type.includes('completed')) return 'success';
  return 'neutral';
}

function statusTone(status: string) {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'waiting' || status === 'review' || status === 'interrupted') return 'warning';
  return 'neutral';
}

function formatTime(value: number) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}

/* ─── Status Badge ──────────────────────────────────────── */

function StatusBadge({ value }: { value: string }) {
  return <span className={`status-badge ${statusTone(value)}`}>{value}</span>;
}

/* ─── Timeline Event ────────────────────────────────────── */

function TimelineEvent({ event }: { event: AuditEvent }) {
  const data = parseData(event);
  const summary = typeof data === 'string' ? data : data.description ?? data.tool ?? data.content ?? data.summary ?? data.error ?? data.name ?? event.type;
  const open = event.type === 'tool.result' || event.type === 'tool.error' || event.type.includes('approval');
  return <details className={`timeline-event ${eventTone(event.type)}`} open={open}>
    <summary>
      <span className="event-dot" aria-hidden="true" />
      <span className="event-info"><strong>{eventTitle(event)}</strong><small>{String(summary).slice(0, 140)}</small></span>
      <time>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </summary>
    <pre>{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
  </details>;
}

/* ─── Artifact Item ─────────────────────────────────────── */

function ArtifactItem({ path, onOpen }: { path: string; onOpen: () => void }) {
  const name = fileName(path);
  const ext = name.includes('.') ? name.split('.').pop()?.toUpperCase() : 'FILE';
  return <button className="artifact-item" onClick={onOpen}>
    <span className="file-icon">{ext?.slice(0, 3)}</span>
    <span><strong>{name}</strong><small>Generated artifact</small></span>
    <span className="artifact-action">Show in folder</span>
  </button>;
}

/* ─── Execution Panel (collapsible) ─────────────────────── */

function ExecutionPanel({ events, goal }: { events: AuditEvent[]; goal: string }) {
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0 && !goal) return null;
  return <div className={`execution-panel ${expanded ? 'expanded' : 'collapsed'}`}>
    <div className="execution-header" onClick={() => setExpanded(!expanded)}>
      <div className="execution-header-left">
        <span className="execution-header-label">Execution</span>
        {events.length > 0 && <span className="execution-header-count">{events.length} events</span>}
      </div>
      <button className="execution-toggle" aria-label={expanded ? 'Collapse execution' : 'Expand execution'}>{expanded ? '▾' : '▸'}</button>
    </div>
    {expanded && <div className="execution-body">
      <div className="execution-timeline">
        {!events.some(e => e.type === 'user.message') && goal && <div className="timeline-event synthetic" style={{ borderLeft: 'none', marginLeft: 0, paddingLeft: 0 }}>
          <span className="event-dot" style={{ background: 'var(--muted)' }} />
          <span className="event-info"><strong>User request</strong><small>{goal}</small></span>
        </div>}
        {events.map(event => <TimelineEvent key={event.id} event={event} />)}
      </div>
    </div>}
  </div>;
}

/* ─── Task Sidebar Item ─────────────────────────────────── */

function TaskSidebarItem({ run, selected, active, approvalRequired, onSelect, onDelete }: { run: Run; selected: boolean; active: boolean; approvalRequired: boolean; onSelect: () => void; onDelete: (event: React.MouseEvent) => void }) {
  const dotClass = active ? 'running' : statusTone(run.status);
  return <button className={`task-nav-item ${selected ? 'selected' : ''}`} onClick={onSelect} onContextMenu={onDelete}>
    <strong>{run.goal}</strong>
    <span className="task-nav-meta">
      <span className={`dot ${dotClass}`} />
      <span>{active ? 'running' : run.status} · {formatTime(run.createdAt)}</span>
    </span>
    {approvalRequired && <span style={{ fontSize: '9px', color: 'var(--warning)' }}>Approval required</span>}
  </button>;
}

/* ─── Tasks Component ───────────────────────────────────── */

export function Tasks({ model }: { model: string }) {
  const [state, setState] = useState<AgentState>({ runs: [], active: null, approvals: [] });
  const [selected, setSelected] = useState<string | null>(null); const selectedRef = useRef<string | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]); const [workspace, setWorkspace] = useState('');
  const [mode, setMode] = useState<RunInput['mode']>('host'); const [permissionMode, setPermissionMode] = useState<RunInput['permissionMode']>('plan'); const [network, setNetwork] = useState(false);
  const [teach, setTeach] = useState(false);
  const [attachments, setAttachments] = useState<ImportedFile[]>([]);
  const [skills, setSkills] = useState<TaskSkill[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityManifest[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [goal, setGoal] = useState(''); const [error, setError] = useState(''); const [starting, setStarting] = useState(false);
  const newTaskRef = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [proposal, setProposal] = useState<LearnedSkill | null>(null);
  const [proposalJson, setProposalJson] = useState('');
  const [validation, setValidation] = useState<SkillValidation | null>(null);
  const [similarRuns, setSimilarRuns] = useState<Run[]>([]);
  const [configOpen, setConfigOpen] = useState(true);
  const conversationRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const select = async (id: string) => { newTaskRef.current = false; selectedRef.current = id; setSelected(id); const list = await window.nix.runEvents(id); if (selectedRef.current === id) setEvents(list); };

  useEffect(() => {
    let alive = true; let loading = false, again = false;
    const refresh = async () => {
      if (loading) { again = true; return; } loading = true;
      try { do { again = false; const [next, nextSkills, nextCapabilities] = await Promise.all([window.nix.agentState(), window.nix.taskSkills(), window.nix.capabilities()]); if (!alive) return; setState(next); setSkills(nextSkills); setCapabilities(nextCapabilities); const id = selectedRef.current ?? (newTaskRef.current ? undefined : next.runs[0]?.id); if (id) await select(id); } while (again && alive); } catch (e) { if (alive) fail(e); } finally { loading = false; }
    };
    const off = window.nix.onAgent(() => void refresh()); void refresh(); void window.nix.workspace().then(setWorkspace).catch(fail);
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && !state.active && target?.tagName !== 'TEXTAREA' && target?.tagName !== 'INPUT' && target?.tagName !== 'SELECT') { event.preventDefault(); setPickerOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.active]);

  useEffect(() => { if (events.length && conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight; }, [events]);

  const current = state.runs.find(r => r.id === selected);

  const begin = async () => {
    setStarting(true); setError('');
    try {
      const id = selected ? await window.nix.replyRun({ id: selected, content: goal, attachments: composerAttachments.length ? composerAttachments : undefined }) : await window.nix.startRun({ goal, model, mode, permissionMode, workspace: mode === 'mock' ? '.' : workspace, network, teach, attachments });
      await select(id); setGoal(''); setAttachments([]);
    } catch (e) { fail(e); } finally { setStarting(false); }
  };

  const importFiles = async () => {
    setError('');
    try {
      const files = await window.nix.importFiles({ workspace });
      setAttachments(previous => {
        const existing = new Set(previous.map(file => `${file.name}:${file.path}`));
        return [...previous, ...files.filter(file => !existing.has(`${file.name}:${file.path}`))].slice(0, 20);
      });
    } catch (e) { fail(e); }
  };

  const deleteRun = async (id: string) => {
    if (state.active === id) return;
    const run = state.runs.find(item => item.id === id);
    if (!confirm(`Delete "${run?.goal.slice(0, 80) ?? 'this task'}"? This removes its task log from this PC.`)) return;
    try {
      await window.nix.deleteRun(id);
      const next = state.runs.filter(item => item.id !== id);
      setState(previous => ({ ...previous, runs: next }));
      if (selectedRef.current === id) {
        const nextId = next[0]?.id ?? null;
        selectedRef.current = nextId; setSelected(nextId); setEvents([]);
        if (nextId) await select(nextId);
      }
      setError('');
    } catch (e) { fail(e); }
  };

  const startNew = () => { newTaskRef.current = true; selectedRef.current = null; setSelected(null); setEvents([]); setGoal(''); setAttachments([]); setTeach(false); };
  const runAgain = (run: Run, teachMode = false) => { startNew(); setMode(run.mode); setPermissionMode(run.permissionMode); setNetwork(run.network); setTeach(teachMode); setGoal(run.goal); };
  const viewTrace = async (id: string) => { setError(''); try { setTrace(await window.nix.executionTrace(id)); } catch (e) { fail(e); } };

  const reviewSkill = async (ids: string[]) => {
    setError(''); setValidation(null);
    try {
      const next = await window.nix.proposeSkill({ runIds: ids });
      setProposal(next); setProposalJson(JSON.stringify(next, null, 2));
      setValidation(await window.nix.validateSkill({ skill: next, testRunId: ids[0] }));
    } catch (e) { fail(e); }
  };

  const installProposal = async () => {
    setError('');
    try {
      const parsed = JSON.parse(proposalJson) as LearnedSkill;
      const result = await window.nix.validateSkill({ skill: parsed });
      setValidation(result);
      if (!result.workflowRecognized || !result.requiredToolsAvailable || !result.permissionsValid || !result.outputVerified) return;
      await window.nix.installSkill(parsed);
      setSkills(await window.nix.taskSkills());
      setProposal(null); setProposalJson('');
    } catch (e) { fail(e); }
  };

  const approvals = state.approvals;
  const composerAttachments: ProcessedAttachment[] = attachments.map(file => ({ id: file.path, name: file.name, mimeType: file.kind || 'file', size: 0, source: file.path, status: 'ready', processorType: file.kind === 'png' || file.kind === 'jpg' || file.kind === 'jpeg' ? 'image' : 'document', extractedContent: `Imported into workspace as ${file.path}.`, metadata: { kind: file.kind } }));
  const artifacts = events.flatMap(e => { try { return e.type === 'tool.result' ? JSON.parse(e.data).artifacts ?? [] : []; } catch { return []; } }) as string[];
  const uniqueArtifacts = [...new Set(artifacts)];

  useEffect(() => {
    if (!current || current.status !== 'completed') { setSimilarRuns([]); return; }
    void window.nix.similarSuccessfulTasks(current.id).then(setSimilarRuns).catch(() => setSimilarRuns([]));
  }, [current?.id, current?.status]);

  return <div className="task-view">
    {/* Error */}
    {error && <div className="error" role="alert">{error}</div>}

    {/* Task Config (collapsible) */}
    <div className="task-config">
      <div className="task-config-header">
        <h3>{current ? current.goal.slice(0, 60) : 'New task'}</h3>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {current && <StatusBadge value={state.active === current.id ? 'running' : current.status} />}
          <button className="secondary-action" onClick={() => setConfigOpen(!configOpen)}>{configOpen ? 'Hide config' : 'Show config'}</button>
          <button className="new-task" style={{ margin: 0, padding: '6px 10px', height: '30px' }} disabled={!!state.active} onClick={startNew}><span>New task</span></button>
        </div>
      </div>
      {configOpen && <div className="task-options">
        <label className="select-field">Environment<select aria-label="Environment" value={mode} disabled={!!state.active} onChange={e => setMode(e.target.value as RunInput['mode'])}><option value="host">Host</option><option value="docker">Docker</option><option value="mock">Mock</option></select></label>
        <label className="select-field">Permission<select aria-label="Permission mode" value={permissionMode} disabled={!!state.active} onChange={e => setPermissionMode(e.target.value as RunInput['permissionMode'])}><option value="plan">Plan</option><option value="act">Act</option></select></label>
        <span className="workspace-chip"><span>Workspace</span><strong>{workspace || 'Not set'}</strong></span>
        <button className="secondary-action" disabled={!!state.active} onClick={() => void window.nix.pickWorkspace().then(path => { if (path) setWorkspace(path); }).catch(fail)}>Choose</button>
        <label className="check-label"><input type="checkbox" checked={teach} disabled={!!state.active} onChange={e => setTeach(e.target.checked)} /> Teach</label>
        <button className="secondary-action" disabled={!!state.active} onClick={() => setPickerOpen(true)}>Search /</button>
      </div>}
    </div>

    {/* Main two-column layout */}
    <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Run list sidebar */}
      <div style={{ overflow: 'auto', borderRight: '1px solid var(--line-soft)', padding: '8px' }}>
        <div className="sidebar-heading"><span>Tasks</span><span>{state.runs.length}</span></div>
        {state.runs.length === 0 && <p className="task-nav-empty">Your tasks will appear here.</p>}
        {state.runs.map(run => <TaskSidebarItem key={run.id} run={run} selected={run.id === selected} active={state.active === run.id} approvalRequired={approvals.some(item => item.runId === run.id)} onSelect={() => void select(run.id).catch(fail)} onDelete={e => { e.preventDefault(); void deleteRun(run.id); }} />)}
      </div>

      {/* Right: execution + conversation + composer */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Execution panel */}
        <ExecutionPanel events={events} goal={current?.goal ?? ''} />

        {/* Conversation thread */}
        <div ref={conversationRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px' }}>
          {!current && <div className="task-empty">
            <img src="./nix-emblem.png" alt="NiX" />
            <h2>Intent into action</h2>
            <p>Describe the result you want. NiX will plan, ask for permission when needed, execute, and leave evidence behind.</p>
          </div>}
          {current && <>
            {/* Run overview */}
            <div style={{ marginBottom: '12px' }}>
              <div className="run-meta">
                <span>{current.model}</span>
                <span>{current.mode}</span>
                <span>{current.permissionMode}</span>
                <span>{formatTime(current.createdAt)}</span>
              </div>
              {current.summary && current.status !== 'review' && current.status !== 'completed' && <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: '12px', lineHeight: '1.55' }}>{current.summary}</p>}
            </div>

            {/* Task conversation */}
            <div className="task-conversation">
              {!events.some(e => e.type === 'user.message') && <div className="conversation-entry"><strong>You</strong><p>{current.goal}</p></div>}
              {events.filter(e => e.type === 'user.message' || e.type === 'run.review').map(event => { const data = parseData(event) as { content?: string; summary?: string }; return <div className="conversation-entry" key={event.id}><strong>{event.type === 'user.message' ? 'You' : 'NiX'}</strong><p>{data.content ?? data.summary}</p>{event.type === 'run.review' && data.content && <SaveMp3Button text={data.content} />}</div>; })}
            </div>

            {/* Review card */}
            {current.status === 'review' && approvals.some(item => item.runId === current.id) && <div className="review-card">
              <div className="review-label">Review required</div>
              <div className="review-body"><p>NiX wants to execute actions that require your approval.</p></div>
              <div className="review-actions">
                {approvals.filter(item => item.runId === current.id).map(item => <React.Fragment key={item.id}>
                  <button className="primary" onClick={() => void window.nix.approve({ id: item.id, allow: true, remember: false }).catch(fail)}>Allow once</button>
                  <button className="secondary-action" onClick={() => void window.nix.approve({ id: item.id, allow: true, remember: true }).catch(fail)}>Allow & remember</button>
                  <button className="danger-action" onClick={() => void window.nix.approve({ id: item.id, allow: false, remember: false }).catch(fail)}>Deny</button>
                </React.Fragment>)}
              </div>
            </div>}

            {/* Artifacts */}
            {uniqueArtifacts.length > 0 && <div className="artifact-list">
              <span className="section-label">Artifacts</span>
              {uniqueArtifacts.map(path => <ArtifactItem key={path} path={path} onOpen={() => void window.nix.openArtifact({ runId: current.id, path }).catch(fail)} />)}
            </div>}

            {/* Teach panel */}
            {current.teach && <div className="teach-panel">
              <span className="section-label">Teaching NiX</span>
              <h3>Workflow capture active</h3>
              <ol>{events.filter(event => ['user.message','tool.started','tool.result','tool.error','run.review'].includes(event.type)).slice(0, 8).map((event, index) => <li key={event.id}>Step {index + 1}: {eventTitle(event)}</li>)}</ol>
              {current.status === 'completed' && <p>I've learned a repeatable workflow from this task.</p>}
            </div>}

            {/* Run actions */}
            <div className="run-actions">
              {state.active === current.id && <button className="secondary-action" onClick={() => void window.nix.cancelRun(current.id).catch(fail)}>Stop</button>}
              {!state.active && current.status !== 'completed' && <button className="secondary-action" onClick={() => void window.nix.resumeRun(current.id).then(select).catch(fail)}>Resume</button>}
              {current.status === 'review' && <button className="primary" onClick={() => void window.nix.acceptRun(current.id).catch(fail)}>Accept</button>}
              {current.status === 'completed' && <button className="secondary-action" disabled={!!state.active} onClick={() => runAgain(current)}>Run Again</button>}
              {current.status === 'completed' && <button className="primary" onClick={() => void reviewSkill([current.id])}>Save as Skill</button>}
              {current.status === 'completed' && <button className="secondary-action" disabled={!!state.active} onClick={() => runAgain(current, true)}>Teach</button>}
              {current.status === 'completed' && similarRuns.length > 1 && <button className="secondary-action" onClick={() => void reviewSkill(similarRuns.map(run => run.id))}>Learn from {similarRuns.length} similar</button>}
              <button className="tertiary-action" onClick={() => void viewTrace(current.id)}>Execution trace</button>
              <button className="tertiary-action" onClick={() => void window.nix.exportLog(current.id).catch(fail)}>Export</button>
              <button className="danger-action" disabled={state.active === current.id} onClick={() => void deleteRun(current.id)}>Delete</button>
            </div>
          </>}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div style={{ flexShrink: 0, padding: '0 24px 16px', borderTop: '1px solid var(--line-soft)' }}>
          <VoiceInput onText={text => setGoal(text)} />
          <MessageComposer
            label="Task goal"
            placeholder={current ? 'Reply with a correction, question, or next step' : 'Describe a task or a result to verify'}
            value={goal}
            rows={2}
            onChange={setGoal}
            onSubmit={() => void begin()}
            onAttach={() => void importFiles()}
            attachDisabled={!!state.active || mode === 'mock' || !workspace}
            attachments={composerAttachments}
            onRemoveAttachment={id => setAttachments(previous => previous.filter(file => file.path !== id))}
            canSubmit={!!goal.trim() && !state.active && !starting && (!!current || !!workspace)}
            busy={starting}
            submitLabel={current ? 'Reply' : 'Run task'}
            submitAriaLabel={current ? 'Reply' : 'Run task'}
            busyLabel="Starting"
          />
          <div className="composer-footer"><span>{permissionMode === 'act' ? 'Act mode' : 'Plan mode'}</span></div>
        </div>
      </div>
    </div>

    {/* Modals */}
    {preview && <div className="approval-backdrop"><section className="preview-dialog panel" role="dialog" aria-modal="true" aria-label="Preview"><button autoFocus onClick={() => setPreview(null)}>Close</button><img src={preview} alt="Preview" /></section></div>}
    {trace && <div className="approval-backdrop"><section className="skill-dialog panel" role="dialog" aria-modal="true" aria-label="Execution trace"><div className="panel-header"><div><span className="section-label">Execution Trace</span><h2>Workflow record</h2></div><button autoFocus onClick={() => setTrace(null)}>Close</button></div><div className="trace-grid"><span>Task ID<strong>{trace.taskId.slice(0, 8)}</strong></span><span>Tools<strong>{trace.toolsUsed.length}</strong></span><span>Corrections<strong>{trace.userCorrections.length}</strong></span><span>Verified<strong>{trace.success ? 'Yes' : 'No'}</strong></span></div><pre>{JSON.stringify(trace, null, 2)}</pre></section></div>}
    {proposal && <div className="approval-backdrop"><section className="skill-dialog panel" role="dialog" aria-modal="true" aria-label="Skill proposal"><div className="panel-header"><div><span className="section-label">Skill Proposal</span><h2>{proposal.name}</h2></div><button onClick={() => setProposal(null)}>Close</button></div><div className="proposal-summary"><p>{proposal.description}</p><div className="permission-row">{proposal.tools.map(tool => <span key={tool}>{tool}</span>)}{proposal.permissions.map(permission => <span key={permission}>{permission}</span>)}</div></div><div className="validation-list" aria-label="Validation results">{validation && [['Workflow recognized', validation.workflowRecognized], ['Required tools available', validation.requiredToolsAvailable], ['Permissions valid', validation.permissionsValid], ['Test execution successful', validation.testExecutionSuccessful], ['Output verified', validation.outputVerified]].map(([label, ok]) => <span key={String(label)} className={ok ? 'ok' : 'blocked'}>{ok ? '✓' : '!'} {label}</span>)}</div><textarea aria-label="Editable skill proposal JSON" spellCheck={false} rows={14} value={proposalJson} onChange={e => setProposalJson(e.target.value)} /><div className="proposal-actions"><button onClick={() => void Promise.resolve().then(() => JSON.parse(proposalJson) as LearnedSkill).then(skill => window.nix.validateSkill({ skill })).then(setValidation).catch(fail)}>Re-test</button><button className="primary" onClick={() => void installProposal()}>Install Skill</button></div>{validation?.messages.length ? <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: '11px' }}>{validation.messages.join(' ')}</p> : null}</section></div>}
    {pickerOpen && <CapabilityPicker capabilities={capabilities} onClose={() => setPickerOpen(false)} onPick={prompt => { startNew(); setGoal(prompt); }} />}
    {approvals.filter(item => !item.runId || !current || item.runId !== current.id).length > 0 && <div className="approval-backdrop"><section className="approval-dialog panel" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="section-label">Permission Gate</div><h2 id="approval-title">Review proposed action</h2><h3>{approvals[0].capabilityName ? `${approvals[0].capabilityName} - ${approvals[0].tool}` : approvals[0].tool}</h3><p>{approvals[0].description}</p>{approvals[0].permissions?.length ? <div className="permission-row">{approvals[0].permissions.map(permission => <span key={permission}>{permission}</span>)}</div> : null}<pre>{JSON.stringify(approvals[0].arguments, null, 2)}</pre><div className="approval-actions"><button onClick={() => void window.nix.approve({ id: approvals[0].id, allow: false, remember: false }).catch(fail)}>Deny</button><button className="secondary-action" onClick={() => void window.nix.approve({ id: approvals[0].id, allow: true, remember: true }).catch(fail)}>Allow & remember</button><button autoFocus className="primary" onClick={() => void window.nix.approve({ id: approvals[0].id, allow: true, remember: false }).catch(fail)}>Allow once</button></div><small>Approval is bound to this tool and these exact arguments.</small></section></div>}
  </div>;
}
