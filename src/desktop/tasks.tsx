import React, { useEffect, useState, useRef } from 'react';
import type { AgentState, AuditEvent, RunInput, ImportedFile, Run } from '../shared/agent';
import { VoiceInput } from './voice';
import type { TaskSkill } from '../shared/task-skills';
import type { CapabilityManifest } from '../shared/capabilities';
import { CapabilityPicker } from './capabilities';
import type { ExecutionTrace, LearnedSkill, SkillValidation } from '../shared/learned-skills';

function parseData(event: AuditEvent) {
  try { return JSON.parse(event.data); } catch { return event.data; }
}

function eventTitle(event: AuditEvent) {
  const label = event.type.replaceAll('.', ' ');
  if (event.type === 'user.message') return 'User request';
  if (event.type === 'run.review') return 'Review ready';
  if (event.type === 'tool.call') return 'Tool requested';
  if (event.type === 'capability.discovery') return 'Capability discovery';
  if (event.type === 'tool.started') return 'Tool started';
  if (event.type === 'tool.result') return 'Tool executed';
  if (event.type === 'tool.error') return 'Tool failed';
  if (event.type.includes('approval')) return 'Permission event';
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

function StatusBadge({ value }: { value: string }) {
  return <span className={`status-badge ${statusTone(value)}`}>{value}</span>;
}

function formatTime(value: number) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function TaskItem({ run, selected, active, approvalRequired, onSelect, onDelete }: { run: Run; selected: boolean; active: boolean; approvalRequired: boolean; onSelect: () => void; onDelete: (event: React.MouseEvent) => void }) {
  return <button className={`run-item ${selected ? 'selected' : ''}`} onClick={onSelect} onContextMenu={onDelete}>
    <span className="run-item-top"><strong>{run.goal}</strong><StatusBadge value={active ? 'running' : run.status} /></span>
    <span className="run-item-meta"><span>{run.mode}</span><span>{run.permissionMode}</span><span>{formatTime(run.createdAt)}</span></span>
    {approvalRequired && <span className="approval-chip">Approval required</span>}
  </button>;
}

function ExecutionEvent({ event }: { event: AuditEvent }) {
  const data = parseData(event);
  const summary = typeof data === 'string' ? data : data.description ?? data.tool ?? data.content ?? data.summary ?? data.error ?? data.name ?? event.type;
  const open = event.type === 'tool.result' || event.type === 'tool.error' || event.type.includes('approval');
  return <details className={`event ${eventTone(event.type)}`} open={open}>
    <summary>
      <span className="event-marker" aria-hidden="true" />
      <span className="event-copy"><strong>{eventTitle(event)}</strong><small>{String(summary).slice(0, 160)}</small></span>
      <time>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </summary>
    <pre>{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
  </details>;
}

function ArtifactItem({ path, onOpen }: { path: string; onOpen: () => void }) {
  const name = fileName(path);
  const ext = name.includes('.') ? name.split('.').pop()?.toUpperCase() : 'FILE';
  return <button className="artifact-item" onClick={onOpen}>
    <span className="file-icon">{ext?.slice(0, 3)}</span>
    <span><strong>{name}</strong><small>Generated artifact</small></span>
    <span className="artifact-action">Show in folder</span>
  </button>;
}

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
  const current = state.runs.find(r => r.id === selected);
  const begin = async () => {
    setStarting(true); setError('');
    try {
      const id = selected ? await window.nix.replyRun({ id: selected, content: goal }) : await window.nix.startRun({ goal, model, mode, permissionMode, workspace: mode === 'mock' ? '.' : workspace, network, teach, attachments });
      await select(id); setGoal(''); if (!selected) setAttachments([]);
    } catch (e) { fail(e); } finally { setStarting(false); }
  };
  const importFiles = async () => {
    setError('');
    try { const files = await window.nix.importFiles({ workspace }); setAttachments(previous => [...previous, ...files]); } catch (e) { fail(e); }
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
  const deleteSkill = async (skill: TaskSkill) => {
    if (skill.builtin || state.active) return;
    if (!confirm(`Delete the "${skill.label}" skill shortcut?`)) return;
    try { await window.nix.deleteTaskSkill(skill.id); setSkills(await window.nix.taskSkills()); setError(''); } catch (e) { fail(e); }
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
  const enabledCapabilities = capabilities.filter(capability => capability.enabled);
  const enabledSkills = enabledCapabilities.filter(capability => capability.type === 'skill');
  const enabledPlugins = enabledCapabilities.filter(capability => capability.type !== 'skill');
  const artifacts = events.flatMap(e => { try { return e.type === 'tool.result' ? JSON.parse(e.data).artifacts ?? [] : []; } catch { return []; } }) as string[];
  const uniqueArtifacts = [...new Set(artifacts)];
  useEffect(() => {
    if (!current || current.status !== 'completed') { setSimilarRuns([]); return; }
    void window.nix.similarSuccessfulTasks(current.id).then(setSimilarRuns).catch(() => setSimilarRuns([]));
  }, [current?.id, current?.status]);
  return <div className="task-view">
    <section className="task-controls panel">
      <div className="panel-header"><div><span className="section-label">Execution Environment</span><h2>Run configuration</h2></div><button className="primary-action" disabled={!!state.active} onClick={startNew}>New task</button></div>
      <div className="task-options">
        <label className="select-field">Environment<select aria-label="Environment" value={mode} disabled={!!state.active} onChange={e => setMode(e.target.value as RunInput['mode'])}><option value="host">Host - PowerShell</option><option value="docker">Docker - Linux</option><option value="mock">Mock - No side effects</option></select></label>
        <label className="select-field">Permission<select aria-label="Permission mode" value={permissionMode} disabled={!!state.active} onChange={e => setPermissionMode(e.target.value as RunInput['permissionMode'])}><option value="plan">Plan - ask before actions</option><option value="act">Act - auto-approve run actions</option></select></label>
        <div className="workspace-card"><span>Workspace</span><strong>{workspace || 'Choose a folder for file and coding tasks.'}</strong></div>
        <button className="secondary-action" disabled={!!state.active} onClick={() => void window.nix.pickWorkspace().then(path => { if (path) setWorkspace(path); }).catch(fail)}>Choose workspace</button>
        <button className="tertiary-action" disabled={!!state.active || mode === 'mock' || !workspace} onClick={() => void importFiles()}>Import files</button>
        {mode === 'docker' && <label className="check-label"><input type="checkbox" checked={network} disabled={!!state.active} onChange={e => setNetwork(e.target.checked)} /> Container network</label>}
        <label className="check-label teach-toggle"><input type="checkbox" checked={teach} disabled={!!state.active} onChange={e => setTeach(e.target.checked)} /> Teach NiX</label>
      </div>
      {attachments.length > 0 && <div className="attachment-list">{attachments.map(file => <span key={file.path}>{file.name}</span>)}</div>}
      <div className="capability-summary" aria-label="Installed capabilities">
        <div><span className="section-label">Capabilities</span><strong>{enabledPlugins.length} plugins/apps - {enabledSkills.length} skills enabled</strong><small>{enabledCapabilities.slice(0, 4).map(capability => capability.name).join(' - ')}</small></div>
        <button className="secondary-action" disabled={!!state.active} onClick={() => setPickerOpen(true)}>Search /</button>
      </div>
      <p className="scope-note">{permissionMode === 'act' ? 'Act mode automatically approves proposed workspace, terminal, MCP, browser, and device actions for this run while keeping denied tools blocked and logging every action.' : mode === 'host' ? 'Host commands use your Windows account and can access outside this folder. Actions ask for approval in Plan mode.' : mode === 'docker' ? 'Linux containers mount only this workspace. Docker must be running with python:3.13-slim installed. No host fallback.' : 'Mock tools exercise approvals and failures without changing files.'}</p>
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="task-columns">
      <section className="run-list panel">
        <div className="panel-header compact"><div><span className="section-label">Task History</span><h2>{state.runs.length} runs</h2></div></div>
        {state.runs.length === 0 && <p className="empty-nav">Your task attempts and evidence will appear here.</p>}
        {state.runs.map(run => <TaskItem key={run.id} run={run} selected={run.id === selected} active={state.active === run.id} approvalRequired={approvals.some(item => item.runId === run.id)} onSelect={() => void select(run.id).catch(fail)} onDelete={e => { e.preventDefault(); void deleteRun(run.id); }} />)}
      </section>
      <section className="run-detail panel">
        <div className="panel-header compact"><div><span className="section-label">{current ? 'Execution Record' : 'Ready'}</span><h2>{current ? 'Current task' : 'Start with a concrete goal'}</h2></div>{current && <StatusBadge value={state.active === current.id ? 'running' : current.status} />}</div>
        {!current ? <div className="task-empty"><img src="./nix-emblem.png" alt="NiX emblem" /><h2>Intent into action.</h2><p>Describe the result you want. NiX will plan, ask for permission when needed, execute, and leave evidence behind.</p></div> : <>
          <article className="run-overview">
            <h2>{current.goal}</h2>
            <div className="run-meta"><span className={`status ${current.status}`}>{current.status}</span><span>{current.model}</span><span>{current.mode}</span><span>{current.permissionMode}</span><span>Run {current.id.slice(0, 8)}</span><span>{formatTime(current.createdAt)}</span></div>
            {current.attachments.length > 0 && <div className="attachment-list">{current.attachments.map(file => <span key={file.path}>{file.name}</span>)}</div>}
            {current.summary && current.status !== 'review' && current.status !== 'completed' && <p className="run-summary">{current.summary}</p>}
          </article>
          <div className="task-conversation">
            {!events.some(e => e.type === 'user.message') && <div className="conversation-entry"><strong>You</strong><p>{current.goal}</p></div>}
            {events.filter(e => e.type === 'user.message' || e.type === 'run.review').map(event => { const data = parseData(event) as { content?: string; summary?: string }; return <div className="conversation-entry" key={event.id}><strong>{event.type === 'user.message' ? 'You' : 'NiX'}</strong><p>{data.content ?? data.summary}</p></div>; })}
          </div>
          <div className="run-actions">
            {state.active === current.id && <button className="secondary-action" onClick={() => void window.nix.cancelRun(current.id).catch(fail)}>Stop task</button>}
            {!state.active && current.status !== 'completed' && <button className="secondary-action" onClick={() => void window.nix.resumeRun(current.id).then(select).catch(fail)}>Resume with checkpoint</button>}
            {current.status === 'review' && <button className="primary" onClick={() => void window.nix.acceptRun(current.id).catch(fail)}>Accept reviewed result</button>}
            {current.status === 'completed' && <button className="secondary-action" disabled={!!state.active} onClick={() => runAgain(current)}>Run Again</button>}
            {current.status === 'completed' && <button className="primary" onClick={() => void reviewSkill([current.id])}>Save as Skill</button>}
            {current.status === 'completed' && <button className="secondary-action" disabled={!!state.active} onClick={() => runAgain(current, true)}>Teach NiX</button>}
            {current.status === 'completed' && similarRuns.length > 1 && <button className="secondary-action" onClick={() => void reviewSkill(similarRuns.map(run => run.id))}>Learn from {similarRuns.length} similar successful tasks</button>}
            <button className="tertiary-action" onClick={() => void viewTrace(current.id)}>View Execution</button>
            <button className="tertiary-action" onClick={() => void window.nix.exportLog(current.id).catch(fail)}>Export log</button>
            <button className="danger-action" disabled={state.active === current.id} onClick={() => void deleteRun(current.id)}>Delete task</button>
          </div>
          {current.teach && <section className="teach-panel"><div className="section-label">TEACHING NIX</div><h3>Workflow capture active</h3><ol>{events.filter(event => ['user.message','tool.started','tool.result','tool.error','run.review'].includes(event.type)).slice(0, 8).map((event, index) => <li key={event.id}>Step {index + 1}: {eventTitle(event)}</li>)}</ol>{current.status === 'completed' && <p>I've learned a repeatable workflow from this task.</p>}</section>}
          {uniqueArtifacts.length > 0 && <div className="artifact-list"><div className="section-label">Artifacts</div>{uniqueArtifacts.map(path => <ArtifactItem key={path} path={path} onOpen={() => void window.nix.openArtifact({ runId: current.id, path }).catch(fail)} />)}</div>}
          <div className="timeline">{!events.some(e => e.type === 'user.message') && <div className="event synthetic"><span className="event-marker" aria-hidden="true" /><div><strong>User request</strong><p>{current.goal}</p></div></div>}{events.map(event => <ExecutionEvent key={event.id} event={event} />)}</div>
        </>}
      </section>
    </div>
    <div className="task-composer">
      <VoiceInput onText={text => setGoal(text)} />
      <form className="composer" onSubmit={e => { e.preventDefault(); void begin(); }}>
        <textarea aria-label="Task goal" value={goal} maxLength={6000} onChange={e => setGoal(e.target.value)} rows={2} placeholder={current ? 'Reply with a correction, question, or next step' : 'Describe a task or a result to verify'} />
        <button className="primary" aria-label={current ? 'Send reply' : 'Run task \u2197'} disabled={!!state.active || starting || !goal.trim() || (!current && mode !== 'mock' && !workspace)}>{starting ? 'Starting' : current ? 'Send reply' : 'Run task'}</button>
      </form>
      <div className="footer-note"><span>{permissionMode === 'act' ? 'Act mode auto-approves this run' : 'Plan mode asks before side effects'}. Evidence before completion.</span><span>12 turns / 3 failures / 10 min</span></div>
    </div>
    {current && artifacts.some(p => p.endsWith('.png')) && <div className="preview-controls"><label>Rendered preview <select aria-label="Rendered preview" defaultValue="" onChange={e => { if (e.target.value) void window.nix.previewArtifact({ runId: current.id, path: e.target.value }).then(setPreview).catch(fail); }}><option value="">Choose a page or slide</option>{artifacts.filter(p => p.endsWith('.png')).map(path => <option key={path} value={path}>{fileName(path)}</option>)}</select></label></div>}
    {preview && <div className="approval-backdrop"><section className="preview-dialog panel" role="dialog" aria-modal="true" aria-label="Rendered document preview"><button autoFocus onClick={() => setPreview(null)}>Close preview</button><img src={preview} alt="Rendered document page or slide" /></section></div>}
    {trace && <div className="approval-backdrop"><section className="skill-dialog panel" role="dialog" aria-modal="true" aria-label="Execution trace"><div className="panel-header"><div><span className="section-label">Execution Trace</span><h2>Observable workflow record</h2></div><button autoFocus onClick={() => setTrace(null)}>Close</button></div><div className="trace-grid"><span>Task ID<strong>{trace.taskId.slice(0, 8)}</strong></span><span>Tools<strong>{trace.toolsUsed.length}</strong></span><span>Corrections<strong>{trace.userCorrections.length}</strong></span><span>Verified<strong>{trace.success ? 'Yes' : 'No'}</strong></span></div><pre>{JSON.stringify(trace, null, 2)}</pre></section></div>}
    {proposal && <div className="approval-backdrop"><section className="skill-dialog panel" role="dialog" aria-modal="true" aria-label="Skill proposal"><div className="panel-header"><div><span className="section-label">Skill Proposal</span><h2>{proposal.name}</h2></div><button onClick={() => setProposal(null)}>Close</button></div><div className="proposal-summary"><p>{proposal.description}</p><div className="permission-row">{proposal.tools.map(tool => <span key={tool}>{tool}</span>)}{proposal.permissions.map(permission => <span key={permission}>{permission}</span>)}</div></div><div className="validation-list" aria-label="Validation results">{validation && [['Workflow recognized', validation.workflowRecognized], ['Required tools available', validation.requiredToolsAvailable], ['Permissions valid', validation.permissionsValid], ['Test execution successful', validation.testExecutionSuccessful], ['Output verified', validation.outputVerified]].map(([label, ok]) => <span key={String(label)} className={ok ? 'ok' : 'blocked'}>{ok ? '✓' : '!'} {label}</span>)}</div><textarea aria-label="Editable skill proposal JSON" spellCheck={false} rows={18} value={proposalJson} onChange={e => setProposalJson(e.target.value)} /><div className="proposal-actions"><button onClick={() => void Promise.resolve().then(() => JSON.parse(proposalJson) as LearnedSkill).then(skill => window.nix.validateSkill({ skill })).then(setValidation).catch(fail)}>Re-test</button><button className="primary" onClick={() => void installProposal()}>Install Skill</button></div>{validation?.messages.length ? <p className="scope-note">{validation.messages.join(' ')}</p> : null}</section></div>}
    {pickerOpen && <CapabilityPicker capabilities={capabilities} onClose={() => setPickerOpen(false)} onPick={prompt => { startNew(); setGoal(prompt); }} />}
    {approvals.length > 0 && <div className="approval-backdrop"><section className="approval-dialog panel" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="section-label">Permission Gate</div><h2 id="approval-title">Review proposed action</h2><h3>{approvals[0].capabilityName ? `${approvals[0].capabilityName} - ${approvals[0].tool}` : approvals[0].tool}</h3><p>{approvals[0].description}</p>{approvals[0].permissions?.length ? <div className="permission-row">{approvals[0].permissions.map(permission => <span key={permission}>{permission}</span>)}</div> : null}<pre>{JSON.stringify(approvals[0].arguments, null, 2)}</pre><div className="approval-actions"><button onClick={() => void window.nix.approve({ id: approvals[0].id, allow: false, remember: false }).catch(fail)}>Deny</button><button className="secondary-action" onClick={() => void window.nix.approve({ id: approvals[0].id, allow: true, remember: true }).catch(fail)}>Allow exact action for run</button><button autoFocus className="primary" onClick={() => void window.nix.approve({ id: approvals[0].id, allow: true, remember: false }).catch(fail)}>Allow once</button></div><small>Approval is bound to this tool and these exact arguments. It expires when the run ends.</small></section></div>}
  </div>;
}
