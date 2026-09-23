import { useState } from 'react';
import { startRecording } from '../services/speech/audio';
import { tts } from '../services/speech/tts';
import { whisper } from '../services/speech/whisper';
import { recognizer } from '../services/speech/recognizer';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

function browserName() {
  const ua = navigator.userAgent;
  const b = navigator.brave ? 'Brave' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : 'Other';
  const v = (ua.match(/(Edg|Chrome|Firefox)\/(\d+)/) || [])[2];
  return v ? `${b} ${v}` : b;
}

function playPcm(audio) {
  const ctx = new AudioContext();
  const buf = ctx.createBuffer(1, audio.length, 16000);
  buf.copyToChannel(audio, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.onended = () => ctx.close();
  src.start();
}

/**
 * One-screen diagnostics for microphone, offline speech model and voice output.
 * A screenshot of this card tells a developer exactly which part fails.
 */
export default function SpeechCheck() {
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);
  const [clip, setClip] = useState(null);
  const add = (ok, text) => setLog((l) => [...l, { ok, text, t: new Date().toLocaleTimeString() }]);

  const env = () => {
    const ws = whisper.status();
    const hi = tts.allVoices().filter((v) => v.lang.toLowerCase().startsWith('hi'));
    return [
      `Browser: ${browserName()} • internet: ${navigator.onLine ? 'yes' : 'NO'}`,
      `Speech recognition used: ${recognizer.current()?.id || 'none'} (mode ${recognizer.mode()}) • browser online recogniser: ${SR ? 'available' : 'not available'}`,
      `Offline model: ${ws.state}${ws.manifest ? ` (${ws.manifest.id}, ${JSON.stringify(ws.manifest.dtype)})` : ''}${ws.error ? ` - ${ws.error}` : ''}`,
      `Voices: ${tts.allVoices().length} total • Hindi: ${hi.length ? hi.map((v) => `${v.name} [${v.offline ? 'offline' : 'online'}]`).join(', ') : 'NONE'}`,
    ];
  };

  const testMic = async () => {
    setBusy(true);
    setClip(null);
    add(null, 'Speak a Hindi sentence now (stops when you pause)…');
    try {
      const rec = await startRecording({ onLevel: (l) => setLevel(l), noSpeechMs: 6000 });
      const r = await rec.result;
      setLevel(0);
      let peak = 0;
      for (const v of r.audio) peak = Math.max(peak, Math.abs(v));
      add(r.speech, `Mic: ${(r.durationMs / 1000).toFixed(1)} s recorded • loudest ${Math.round(peak * 100)}% • speech detected: ${r.speech ? 'yes' : 'NO'} • device rate ${rec.sampleRate} Hz`);
      if (peak < 0.05) add(false, 'Very quiet - move closer to the mic or raise the mic volume in Windows sound settings.');
      if (peak > 0.99) add(false, 'Clipping (too loud) - lower the mic volume.');
      setClip(r.audio.slice());
      if (whisper.status().manifest) {
        add(null, 'Offline model is transcribing… (first time loads ~500 MB, can take a minute)');
        const t0 = performance.now();
        const text = await whisper.transcribe(r.audio.slice());
        add(Boolean(text), `Offline model heard: "${text}" (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
      } else {
        add(false, 'Offline model not installed - run "npm run setup:whisper".');
      }
    } catch (e) {
      setLevel(0);
      add(false, `Mic/model error: ${e?.code ? `${e.code} - ` : ''}${e?.message || e}`);
    }
    setBusy(false);
  };

  const testVoice = async () => {
    setBusy(true);
    const name = tts.voiceName('hi-IN');
    add(null, `Speaking with: ${name || '(no voice chosen - browser default)'}`);
    const ok = await tts.speak('नमस्ते बच्चों, आज हम पेड़ के बारे में सीखेंगे।', { lang: 'hi-IN' });
    add(ok, ok ? 'Voice finished playing. Did you hear it? If not, check the speaker volume / output device.' : `Voice failed: ${tts.lastError() || 'unknown'}`);
    setBusy(false);
  };

  return (
    <div className="speech-check">
      <ul className="speech-check__env">
        {env().map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="speech-check__actions">
        <button className="btn btn--primary" onClick={testMic} disabled={busy}>1. Test microphone + model</button>
        {clip && <button className="btn btn--ghost" onClick={() => playPcm(clip)}>Play what was recorded</button>}
        <button className="btn btn--primary" onClick={testVoice} disabled={busy}>2. Test voice</button>
      </div>
      {busy && level > 0 && (
        <div className="speech-check__meter" aria-label="Microphone level"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
      )}
      <ol className="speech-check__log">
        {log.map((l, i) => (
          <li key={i} className={l.ok === true ? 'is-ok' : l.ok === false ? 'is-bad' : ''}>
            <small>{l.t}</small> {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
