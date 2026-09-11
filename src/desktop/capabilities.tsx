import React, { useEffect, useMemo, useState } from 'react';
import type { CapabilityManifest } from '../shared/capabilities';

function tone(status: string) {
  if (status === 'ready') return 'success';
  if (status === 'disabled' || status === 'permission_required' || status === 'authentication_required') return 'warning';
  if (status === 'error' || status === 'unavailable') return 'danger';
  return 'neutral';
}

function lastUsed(value?: number | null) {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not used yet';
}

export function CapabilityCard({ capability, compact = false, onSelect }: { capability: CapabilityManifest; compact?: boolean; onSelect?: (value: string) => void }) {
  return <article className={compact ? 'capability-card compact' : 'capability-card'}>
    <div className="capability-head">
      <span className="capability-icon">{capability.icon}</span>
      <div><strong>{capability.name}</strong><small>{capability.type}</small></div>
      <span className={`capability-status ${tone(capability.status)}`}>{capability.enabled ? capability.status.replaceAll('_', ' ') : 'disabled'}</span>
    </div>
    <p>{capability.description}</p>
    <div className="capability-meta">
      <span>v{capability.version}</span>
      <span>{capability.tools.length} tools</span>
      <span>{lastUsed(capability.lastUsed)}</span>
    </div>
    {!compact && <>
      <div className="permission-row">{capability.permissions.length ? capability.permissions.map(permission => <span key={permission}>{permission}</span>) : <span>No extra permissions</span>}</div>
      {capability.tools.length > 0 && <div className="tool-list">{capability.tools.map(tool => <button key={tool.name} onClick={() => onSelect?.(`Use ${tool.name} for this task. First inspect its schema and ask for approval if required.`)}><strong>{tool.name}</strong><small>{tool.permissions.join(', ') || 'no permissions'}</small></button>)}</div>}
      {capability.allowedTools?.length ? <div className="allowed-tools"><span>Allowed tools</span><p>{capability.allowedTools.join(', ')}</p></div> : null}
    </>}
  </article>;
}

export function CapabilityPicker({ capabilities, onClose, onPick }: { capabilities: CapabilityManifest[]; onClose: () => void; onPick: (prompt: string) => void }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    const rows = capabilities.flatMap(capability => [
      { id: capability.id, kind: capability.type, label: capability.name, detail: capability.description, prompt: capability.instructions ?? `Use the ${capability.name} ${capability.type} if it is relevant to this task.` },
      ...capability.tools.map(tool => ({ id: `${capability.id}:${tool.name}`, kind: 'tool', label: tool.name, detail: tool.description, prompt: `Use ${tool.name} from ${capability.name} for this task. Inspect the schema, explain required permissions, and request approval if needed.` }))
    ]);
    return rows.filter(row => !text || `${row.label} ${row.detail} ${row.kind}`.toLowerCase().includes(text)).slice(0, 40);
  }, [capabilities, query]);
  return <div className="approval-backdrop">
    <section className="capability-picker panel" role="dialog" aria-modal="true" aria-label="Capability picker">
      <div className="panel-header compact"><div><span className="section-label">Capabilities</span><h2>Search skills, plugins, and tools</h2></div><button onClick={onClose}>Close</button></div>
      <input autoFocus className="capability-search" placeholder="Search capabilities..." value={query} onChange={event => setQuery(event.target.value)} />
      <div className="picker-results">{matches.map(row => <button key={row.id} onClick={() => { onPick(row.prompt); onClose(); }}><span>{row.kind}</span><strong>{row.label}</strong><small>{row.detail}</small></button>)}</div>
    </section>
  </div>;
}

export function CapabilitiesView({ onPick }: { onPick?: (prompt: string) => void }) {
  const [capabilities, setCapabilities] = useState<CapabilityManifest[]>([]);
  const [filter, setFilter] = useState<'installed' | 'skills' | 'plugins' | 'permissions'>('installed');
  const [error, setError] = useState('');
  useEffect(() => { void window.nix.capabilities().then(setCapabilities).catch(e => setError(String(e))); }, []);
  const visible = capabilities.filter(capability => filter === 'installed' ? capability.enabled : filter === 'skills' ? capability.type === 'skill' : filter === 'plugins' ? capability.type !== 'skill' : capability.permissions.length > 0);
  const enabled = capabilities.filter(capability => capability.enabled);
  return <section className="capabilities-view">
    <div className="capability-hero">
      <div><span className="section-label">CAPABILITIES</span><h2>{enabled.length} enabled capabilities</h2><p>Skills guide the agent, plugins and apps expose tools, and every tool declares permissions before execution.</p></div>
      <div className="capability-stats"><span>{capabilities.filter(c => c.type === 'skill').length} skills</span><span>{capabilities.filter(c => c.type !== 'skill').length} plugins/apps</span><span>{capabilities.flatMap(c => c.tools).length} tools</span></div>
    </div>
    <div className="capability-tabs">
      {(['installed','skills','plugins','permissions'] as const).map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="capability-grid">{visible.map(capability => <CapabilityCard key={capability.id} capability={capability} onSelect={onPick} />)}</div>
  </section>;
}
