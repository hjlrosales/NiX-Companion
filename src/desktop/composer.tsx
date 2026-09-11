import React from 'react';
import type { ProcessedAttachment } from '../shared/attachments';

function AttachIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5l5.8-5.8a2.1 2.1 0 013 3L6.2 12.1a1.1 1.1 0 01-1.5-1.5L10.5 4.8"/></svg>;
}

export function submitOnEnter(event: React.KeyboardEvent<HTMLTextAreaElement>, submit: () => void) {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  submit();
}

export function MessageComposer({
  label,
  value,
  placeholder,
  rows = 3,
  disabled,
  canSubmit,
  maxLength = 6000,
  submitLabel,
  submitAriaLabel,
  busyLabel,
  busy,
  hideSubmit,
  onChange,
  onSubmit,
  onAttach,
  attachDisabled,
  attachments = [],
  onRemoveAttachment,
  children
}: {
  label: string;
  value: string;
  placeholder: string;
  rows?: number;
  disabled?: boolean;
  canSubmit: boolean;
  maxLength?: number;
  submitLabel: string;
  submitAriaLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  hideSubmit?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAttach?: () => void;
  attachDisabled?: boolean;
  attachments?: ProcessedAttachment[];
  onRemoveAttachment?: (id: string) => void;
  children?: React.ReactNode;
}) {
  const handleSubmit = () => {
    if (!canSubmit || disabled || busy) return;
    onSubmit();
  };
  return <form className="composer" onSubmit={event => { event.preventDefault(); handleSubmit(); }}>
    <div className="composer-main">
      <textarea aria-label={label} placeholder={placeholder} value={value} maxLength={maxLength} rows={rows} disabled={disabled} onChange={event => onChange(event.target.value)} onKeyDown={event => submitOnEnter(event, handleSubmit)} />
      {attachments.length > 0 && <div className="attachment-tray" aria-label="Selected attachments">
        {attachments.map(attachment => <span key={attachment.id} className={`attachment-chip ${attachment.status}`}>
          <span className="attachment-name">{attachment.name}</span>
          <small>{attachment.status === 'ready' ? attachment.processorType : attachment.status === 'error' ? attachment.error ?? 'Failed' : attachment.status}</small>
          {onRemoveAttachment && <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.id)}>x</button>}
        </span>)}
      </div>}
    </div>
    <div className="composer-actions">
      {children}
      {onAttach && <button type="button" className="secondary-action icon-action" aria-label="Attach files" disabled={attachDisabled || disabled || busy} onClick={onAttach}><AttachIcon /></button>}
      {!hideSubmit && <button className="primary" aria-label={submitAriaLabel} disabled={!canSubmit || disabled || busy}>{busy ? busyLabel ?? 'Starting' : submitLabel}</button>}
    </div>
  </form>;
}
