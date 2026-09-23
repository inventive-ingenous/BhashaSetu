import { useState } from 'react';
import { LuMic, LuVolume2, LuCopy, LuKeyboard, LuSend, LuCpu } from 'react-icons/lu';
import { useVoice } from '../context/VoiceContext';
import { useApp, useModelStatus } from '../context/AppContext';

/** Type a sentence instead of speaking (always available; useful offline or in browsers without speech recognition). */
function TypeBox({ theme, fromLang }) {
  const v = useVoice();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const busy = v.phase === 'thinking';
  const send = (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    v.submitText(text);
  };
  if (!open) {
    return (
      <button type="button" className="lang-card__type-toggle" onClick={() => setOpen(true)}>
        <LuKeyboard size={16} /> Type instead
      </button>
    );
  }
  return (
    <form className={`typebox typebox--${theme}`} onSubmit={send}>
      <input
        className={fromLang.font}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Type in ${fromLang.label}…`}
        aria-label={`Type a sentence in ${fromLang.label}`}
        lang={fromLang.key}
        autoFocus
      />
      <button type="submit" className="typebox__send" disabled={!text.trim() || busy} aria-label="Translate">
        <LuSend size={18} />
      </button>
    </form>
  );
}

export function SpeechCard({ theme = 'light' }) {
  const v = useVoice();
  const { fromLang } = useApp();
  const empty = v.srcWords.length === 0;
  return (
    <section className={`lang-card lang-card--speech lang-card--${theme}`} aria-label="Your speech">
      <header>
        <LuMic size={17} />
        <span>Your Speech ({fromLang.label})</span>
      </header>
      <div className={`lang-card__body ${fromLang.font}`} aria-live="polite">
        {empty ? (
          <span className="lang-card__placeholder">{v.phase === 'listening' ? 'Listening… speak now, I stop when you pause' : v.phase === 'thinking' ? 'Recognising speech…' : 'Your words will appear here'}</span>
        ) : (
          <p>
            {v.srcWords.map((w, i) => (
              <span key={i} className="w">{w} </span>
            ))}
            {v.phase === 'listening' && <i className="caret" />}
          </p>
        )}
      </div>
      <TypeBox theme={theme} fromLang={fromLang} />
    </section>
  );
}

function ModelLoading({ pair, toLang }) {
  const st = useModelStatus(pair);
  if (st.state !== 'loading') return null;
  return (
    <p className="lang-card__loading">
      <LuCpu size={15} /> Loading {toLang.label} model… {Math.round((st.progress || 0) * 100)}%
    </p>
  );
}

export function TranslationCard({ theme = 'light' }) {
  const v = useVoice();
  const { toast, toLang, pair } = useApp();
  const thinking = v.phase === 'thinking';
  const started = v.dstWords.length > 0;
  const complete = v.hasResult && v.dstWords.length === v.dstTotal && !thinking && v.phase !== 'listening';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(v.dstText);
      toast('Translation copied', 'success');
    } catch {
      toast('Could not copy on this device', 'error');
    }
  };
  return (
    <section className={`lang-card lang-card--translation lang-card--${theme}`} aria-label="Translation">
      <header>
        <span>Translation ({toLang.label})</span>
        <button className="lang-card__play" onClick={v.repeat} aria-label="Play translation" title="Play translation" disabled={!v.hasResult}>
          <LuVolume2 size={18} />
        </button>
      </header>
      <div className={`lang-card__body ${toLang.font}`} aria-live="polite" lang={toLang.key}>
        {thinking ? (
          <>
            <ModelLoading pair={pair} toLang={toLang} />
            <div className="lang-card__skeleton">
              <span className="skeleton" style={{ width: '92%' }} />
              <span className="skeleton" style={{ width: '64%' }} />
            </div>
          </>
        ) : !started ? (
          <span className="lang-card__placeholder">Translation appears here</span>
        ) : (
          <p>
            {v.dstWords.map((w, i) => (
              <span key={i} className="w">{w} </span>
            ))}
          </p>
        )}
        {complete && (
          <button className="lang-card__copy" onClick={copy} aria-label="Copy translation" title="Copy">
            <LuCopy size={17} />
          </button>
        )}
      </div>
      {complete && v.meaning && (
        <div className="lang-card__meaning">
          <strong>Meaning (for you)</strong>
          <span>{v.meaning}</span>
        </div>
      )}
      {complete && v.info && (
        <p className="lang-card__source">
          {v.info.source === 'model' ? `On-device model • ${(v.info.ms / 1000).toFixed(1)} s` : 'Sample translation (no model for this language yet)'}
        </p>
      )}
    </section>
  );
}

export default function TranslationPanel({ theme = 'light' }) {
  return (
    <div className="tp-stack">
      <SpeechCard theme={theme} />
      <TranslationCard theme={theme} />
    </div>
  );
}
