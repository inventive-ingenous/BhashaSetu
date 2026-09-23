import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Header';
import SpeechCheck from '../components/SpeechCheck';
import { useApp, useModelStatus, useWhisperStatus } from '../context/AppContext';
import { CLASSES } from '../data/content';
import { LANGUAGES, SOURCE, TARGETS, languageStatus } from '../data/languages';
import { engine } from '../services/engine';

function Toggle({ checked, onChange, label }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

function ModelRow() {
  const { pair, fromLang, toLang } = useApp();
  const st = useModelStatus(pair);
  let text;
  if (!st.model) text = engine.hasDemo(pair) ? 'No model yet - using sample translations' : 'No model yet';
  else if (st.state === 'ready') text = `Ready on this device • ${st.model.sizeMB} MB • works offline`;
  else if (st.state === 'loading') text = `Loading… ${Math.round((st.progress || 0) * 100)}%`;
  else if (st.state === 'error') text = `Could not load: ${st.error}`;
  else text = `${st.model.sizeMB} MB • loads on first use`;
  return (
    <div className="row">
      <div>
        <b>Translation model</b>
        <small>
          {fromLang.label} → {toLang.label}: {text}
          {st.model ? ` • ${st.model.base}` : ''}
        </small>
      </div>
      {st.model && st.state !== 'ready' && st.state !== 'loading' && (
        <button className="btn btn--ghost" onClick={() => engine.preload(pair)}>
          Load now
        </button>
      )}
    </div>
  );
}

function SpeechRows() {
  const { toLang, toast, prefs, setPrefs } = useApp();
  const [, tick] = useState(0);
  // voice lists load asynchronously in Chrome - re-render when they arrive
  useEffect(() => {
    const s = window.speechSynthesis;
    if (!s) return undefined;
    const on = () => tick((n) => n + 1);
    s.addEventListener?.('voiceschanged', on);
    const t = setTimeout(on, 800);
    return () => {
      s.removeEventListener?.('voiceschanged', on);
      clearTimeout(t);
    };
  }, []);
  const ws = useWhisperStatus();
  engine.setListenMode(prefs.asr || 'auto'); // keep in step with the toggle during this render
  const mic = engine.listenerInfo();
  const offlineText = {
    unknown: 'Checking…',
    missing: 'Not installed - run "npm run setup:whisper" once (needs internet), then reload',
    idle: `Installed (${ws.manifest?.id}${typeof ws.manifest?.dtype === 'object' ? ', full-precision encoder' : ', 8-bit'}) - loads on first use`,
    loading: `Loading ${ws.manifest?.id}… ${Math.round((ws.progress || 0) * 100)}%`,
    ready: `Ready (${ws.manifest?.id}) - works without internet`,
    error: `Could not load: ${ws.error}`,
  }[ws.state];
  const voiceLang = toLang.tts;
  const voice = voiceLang ? engine.voiceName(voiceLang) : null;
  const test = async () => {
    const ok = await engine.speak(toLang.key === 'mun' ? 'आञ स्कूल सेनोःतानाञ।' : 'नमस्ते बच्चों', { lang: voiceLang || 'hi-IN' });
    if (!ok) toast('No Hindi voice could play. Install one (see the hint on this row).', 'error');
  };
  return (
    <>
      <div className="row">
        <div>
          <b>Speech recognition</b>
          <small>
            Using: {mic ? mic.label : 'nothing available - install the offline model or open Chrome / Edge'}
            <br />
            Offline model: {offlineText}
          </small>
        </div>
        {engine.whisper.hasRecording() && (
          <button className="btn btn--ghost" onClick={() => engine.whisper.playLast()} title="Hear exactly what the offline model received">
            Play last recording
          </button>
        )}
        <div className="seg-text" role="group" aria-label="Speech recognition mode">
          {[
            ['auto', 'Auto'],
            ['offline', 'Offline'],
            ['online', 'Online'],
          ].map(([k, l]) => (
            <button key={k} className={(prefs.asr || 'auto') === k ? 'is-on' : ''} onClick={() => setPrefs({ asr: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <div>
          <b>Voice</b>
          <small>
            {!voiceLang
              ? `No voice for ${toLang.label} yet`
              : engine.voiceKind(voiceLang) === 'offline'
                ? `${voice} - works offline${toLang.key !== 'hi' ? ` (Hindi voice reading ${toLang.label})` : ''}`
                : engine.voiceKind(voiceLang) === 'online'
                  ? `${voice || 'Hindi voice'} - needs internet, so it is silent offline. Install the Windows Hindi voice (works offline): Windows Settings > Time & language > Language & region > Add a language > Hindi, tick Text-to-speech; then restart the browser.`
                  : 'No Hindi voice. Install the Windows Hindi voice (works offline): Windows Settings > Time & language > Language & region > Add a language > Hindi, tick Text-to-speech; then restart the browser.'}
          </small>
        </div>
        {voiceLang && (
          <button className="btn btn--ghost" onClick={test}>
            Test voice
          </button>
        )}
      </div>
    </>
  );
}

export default function Settings() {
  const { klass, setKlass, lang, setLang, target, direction, setDirection, canReverse, prefs, setPrefs, toast } = useApp();
  const pick = (k) => {
    if (!engine.canTranslate({ from: SOURCE, to: k })) {
      toast(`${LANGUAGES[k].label} is coming soon`, 'info');
      return;
    }
    setLang(k);
  };
  return (
    <div className="page settings">
      <PageHeader title="Settings" subtitle="Make BhashaSetu comfortable for your classroom" />
      <div className="surface settings__card">
        <div className="row">
          <div><b>Class</b><small>The class you are teaching today</small></div>
          <select value={klass} onChange={(e) => setKlass(e.target.value)} aria-label="Class">
            {CLASSES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="row">
          <div><b>Children's language</b><small>The tribal language your class speaks</small></div>
          <div className="seg-text" role="group" aria-label="Children's language">
            {TARGETS.map((k) => {
              const st = languageStatus(k);
              const usable = engine.canTranslate({ from: SOURCE, to: k });
              return (
                <button key={k} className={lang === k ? 'is-on' : ''} onClick={() => pick(k)} aria-disabled={!usable} title={usable ? '' : 'Coming soon'}>
                  {LANGUAGES[k].label}
                  {st !== 'ready' && <small className="seg-text__tag">{usable ? 'demo' : 'soon'}</small>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="row">
          <div><b>Translation direction</b><small>{canReverse ? 'Who speaks, and who listens' : `${target.label} → Hindi needs its own model (not trained yet)`}</small></div>
          <div className="seg-text" role="group" aria-label="Translation direction">
            <button className={direction === 'forward' ? 'is-on' : ''} onClick={() => setDirection('forward')}>Hindi → {target.label}</button>
            <button className={direction === 'reverse' ? 'is-on' : ''} onClick={() => setDirection('reverse')} disabled={!canReverse}>
              {target.label} → Hindi
            </button>
          </div>
        </div>
        <ModelRow />
        <SpeechRows />
        <div className="row">
          <div><b>Careful translation</b><small>Compares several possible translations before choosing (beam search). About 4x slower; try it and keep it if the Mundari reads better.</small></div>
          <Toggle checked={Boolean(prefs.carefulTranslate)} onChange={(v) => setPrefs({ carefulTranslate: v })} label="Careful translation" />
        </div>
        <div className="row">
          <div><b>Slow speech</b><small>How slowly the "Slow" button plays</small></div>
          <input type="range" min="0.4" max="0.9" step="0.05" value={prefs.voiceSpeed} onChange={(e) => setPrefs({ voiceSpeed: +e.target.value })} aria-label="Slow speech speed" />
        </div>
        <div className="row">
          <div><b>Larger text</b><small>Easier to read from across the room</small></div>
          <Toggle checked={prefs.largeText} onChange={(v) => setPrefs({ largeText: v })} label="Larger text" />
        </div>
        <div className="row">
          <div><b>Calmer animations</b><small>Turns off most movement, including the character's gestures</small></div>
          <Toggle checked={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} label="Calmer animations" />
        </div>
        <div className="row">
          <div><b>About</b><small>BhashaSetu • Every Child. Every Language. • Engine: {engine.mode}</small></div>
        </div>
      </div>
      <div className="surface settings__card">
        <div className="row row--stack">
          <div><b>Speech check</b><small>Run both tests and send a screenshot of this box if something does not work</small></div>
          <SpeechCheck />
        </div>
      </div>
    </div>
  );
}
