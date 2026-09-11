import React, { useEffect, useRef, useState } from 'react';

export function VoiceInput({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(t => t.stop());
  }, []);

  const toggle = async () => {
    if (recording) { recorder.current?.stop(); return; }
    setError(''); setBusy(true);
    try {
      const status = await window.nix.voiceStatus();
      if (!status.ready) throw new Error('Download local voice models in Settings first.');
      await window.nix.allowMicrophone();
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!mounted.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const rec = new MediaRecorder(media, { mimeType: 'audio/webm' });
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = async () => {
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach(t => t.stop());
        if (!mounted.current) return;
        setRecording(false); setBusy(true);
        try {
          const buffer = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
          const text = await window.nix.transcribe(new Uint8Array(buffer));
          if (mounted.current) onText(text);
        } catch (e) { if (mounted.current) setError(String(e)); }
        finally { if (mounted.current) setBusy(false); }
      };
      rec.start(); setRecording(true);
      timer.current = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 60000);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <span className="voice-control">
      <button type="button" aria-label={recording ? 'Stop recording' : 'Dictate with microphone'} disabled={busy} onClick={() => void toggle()}>
        {recording ? '● Stop recording' : busy ? 'Transcribing…' : '◉ Dictate'}
      </button>
      {error && <span className="message-error" role="alert">{error}</span>}
    </span>
  );
}

export function SpeakButton({ text }: { text: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { audio.current?.pause(); }, []);

  return (
    <span className="voice-control">
      <button type="button" disabled={busy} onClick={() => {
        setError(''); setBusy(true); audio.current?.pause();
        void window.nix.speak(text.slice(0, 3000))
          .then(data => { audio.current = new Audio(data); return audio.current.play(); })
          .catch(e => setError(String(e)))
          .finally(() => setBusy(false));
      }}>{busy ? 'Preparing voice…' : '▷ Read aloud'}</button>
      <button type="button" onClick={() => { audio.current?.pause(); void window.nix.cancelVoice(); }}>Stop audio</button>
      {error && <span className="message-error">{error}</span>}
    </span>
  );
}

export function SaveMp3Button({ text }: { text: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const save = () => {
    setError(''); setDone(false); setBusy(true);
    void window.nix.mp3Export()
      .then(enabled => {
        if (!enabled) throw new Error('MP3 export is disabled. Enable it in Settings.');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safe = (text.slice(0, 30).replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '') || 'chat');
        const outputPath = `${ts}-${safe}.mp3`;
        return window.nix.speakToMp3({ texts: [text.slice(0, 3000)], outputPath });
      })
      .then(() => { setDone(true); setTimeout(() => setDone(false), 5000); })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  return (
    <span className="voice-control">
      <button type="button" disabled={busy || !text.trim()} onClick={save}>
        {busy ? 'Saving…' : done ? '✓ Saved' : '↓ MP3'}
      </button>
      {error && <span className="message-error">{error}</span>}
    </span>
  );
}
