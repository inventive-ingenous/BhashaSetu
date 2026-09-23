import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../services/engine';
import { SAMPLES } from '../data/content';
import { useApp } from './AppContext';

/**
 * Voice session + avatar state machine.
 *
 * phase:        idle -> listening -> thinking -> speaking -> result
 * avatarState:  derived from phase, or temporarily overridden (happy / encouraging / confused / excited / success)
 *
 * listening: real microphone -> speech recognition (engine.listen). Words appear as they are heard.
 * thinking:  on-device translation (engine.translate).
 * speaking:  text-to-speech with an installed voice (engine.speak), words revealed in step.
 * Every screen reads from here, so the character always reflects what the teacher is doing.
 */
const Ctx = createContext(null);
export const useVoice = () => useContext(Ctx);

const PHASE_TO_AVATAR = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  result: 'idle',
};

const MIN_THINKING_MS = 700; // keep the "thinking" animation readable even when the model is fast
const words = (s) => (s ? s.trim().split(/\s+/) : []);
const norm = (s) => (s || '').replace(/[\s।॥.?!,᱾]+/g, ' ').trim();

export function VoiceProvider({ children }) {
  const { pair, fromLang, toLang, prefs, toast } = useApp();
  const [phase, setPhase] = useState('idle');
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [meta, setMeta] = useState(null); // lesson sample (meaning / explanation), when the sentence is one
  const [info, setInfo] = useState(null); // { source: 'model' | 'demo', ms }
  const [srcShown, setSrcShown] = useState(0);
  const [dstShown, setDstShown] = useState(0);
  const [override, setOverride] = useState(null); // { state, text }
  const timers = useRef([]);
  const session = useRef(null); // active speech-recognition session
  const voiceWarned = useRef(false);
  const run = useRef(0); // bumps on every new utterance / reset so stale translations are ignored
  const dstRef = useRef('');
  const metaRef = useRef(null);
  const pairRef = useRef(pair);
  pairRef.current = pair;
  const langRef = useRef({ fromLang, toLang });
  langRef.current = { fromLang, toLang };

  const clearAll = useCallback(() => {
    timers.current.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    timers.current = [];
    session.current?.abort();
    session.current = null;
    engine.stopSpeaking();
  }, []);
  useEffect(() => clearAll, [clearAll]);

  const later = useCallback((fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  }, []);
  const every = useCallback((fn, ms) => {
    const id = setInterval(fn, ms);
    timers.current.push(id);
    return id;
  }, []);

  const finish = useCallback(() => setPhase('result'), []);

  const startSpeaking = useCallback(
    (rate = 1, replay = false) => {
      const text = dstRef.current;
      const list = words(text);
      const runId = run.current;
      setPhase('speaking');
      const step = 330 / rate;
      // finish when BOTH the words are shown and the voice has stopped
      let revealed = false;
      let spoken = false;
      const maybeFinish = () => revealed && spoken && runId === run.current && later(finish, 400);
      const voiceLang = langRef.current.toLang.tts;
      if (voiceLang) {
        engine.speak(text, { lang: voiceLang, rate }).then((ok) => {
          if (!ok && !voiceWarned.current) {
            voiceWarned.current = true;
            const kind = engine.voiceKind(voiceLang);
            toast(
              kind === 'online' && !navigator.onLine
                ? 'The only Hindi voice in this browser needs internet. Install the Windows Hindi voice to hear it offline (see Settings > Voice).'
                : 'No Hindi voice on this device, so the translation is shown but not spoken. See Settings > Voice.',
              'error'
            );
          }
          spoken = true;
          maybeFinish();
        });
      } else {
        spoken = true;
      }
      if (replay) {
        setDstShown(list.length);
        revealed = true;
        maybeFinish();
        return;
      }
      let k = 0;
      setDstShown(0);
      const id = every(() => {
        k += 1;
        setDstShown(k);
        if (k >= list.length) {
          clearInterval(id);
          revealed = true;
          maybeFinish();
        }
      }, step);
    },
    [every, later, finish, toast]
  );

  /** Translate the source text, then play the result. */
  const translate = useCallback(
    async (text, runId) => {
      setPhase('thinking');
      setSrc(text);
      setSrcShown(words(text).length);
      if (!metaRef.current) {
        const lesson = SAMPLES.find((s) => norm(s[pairRef.current.from]) === norm(text)) || null;
        metaRef.current = lesson;
        setMeta(lesson);
      }
      const t0 = Date.now();
      const r = await engine.translate(text, pairRef.current);
      if (runId !== run.current) return; // a newer utterance or a reset happened meanwhile
      const wait = Math.max(0, MIN_THINKING_MS - (Date.now() - t0));
      later(() => {
        if (runId !== run.current) return;
        if (!r.text) {
          const { fromLang: f, toLang: t } = langRef.current;
          toast(r.error ? `Translation failed: ${r.error}` : `${f.label} → ${t.label} is not available yet`, 'error');
          setPhase('idle');
          setOverride({ state: 'confused', text: 'I could not translate that.' });
          later(() => setOverride(null), 3000);
          return;
        }
        if (r.error) toast('On-device model failed, showing a sample translation', 'error');
        dstRef.current = r.text;
        setDst(r.text);
        setInfo({ source: r.source, ms: r.ms });
        startSpeaking(1);
      }, wait);
    },
    [later, startSpeaking, toast]
  );

  const begin = useCallback((text, sample) => {
    clearAll();
    run.current += 1;
    const lesson = sample || SAMPLES.find((s) => norm(s[pairRef.current.from]) === norm(text)) || null;
    metaRef.current = lesson;
    dstRef.current = '';
    setMeta(lesson);
    setSrc(text);
    setDst('');
    setInfo(null);
    setSrcShown(0);
    setDstShown(0);
    setOverride(null);
    return run.current;
  }, [clearAll]);

  /** Mic flow: listen with real speech recognition, then translate what was heard. */
  const start = useCallback(() => {
    const { fromLang: f } = langRef.current;
    if (!f.asr) {
      toast(`Listening in ${f.label} is not available yet. Use "Type instead".`, 'info');
      return;
    }
    const id = begin('', null);
    setPhase('listening');
    session.current = engine.listen({
      lang: f.asr,
      onProcessing: () => {
        // offline model: recording finished, now turning audio into text
        if (id === run.current) setPhase('thinking');
      },
      onPartial: (t) => {
        if (id !== run.current) return;
        setSrc(t);
        setSrcShown(words(t).length);
      },
      onFinal: (t) => {
        if (id !== run.current) return;
        session.current = null;
        translate(t, id);
      },
      onError: (code, msg) => {
        if (id !== run.current) return;
        session.current = null;
        toast(msg, code === 'no-speech' ? 'info' : 'error');
        setPhase('idle');
        setOverride({ state: 'confused', text: code === 'no-speech' ? "I didn't hear you." : 'I cannot listen right now.' });
        later(() => setOverride(null), 3000);
      },
    });
  }, [begin, later, translate, toast]);

  /** Typed input: translate any sentence straight away. */
  const submitText = useCallback(
    (text) => {
      const t = (text || '').trim();
      if (!t) return;
      const id = begin(t, null);
      setSrcShown(words(t).length);
      translate(t, id);
    },
    [begin, translate]
  );

  const toggle = useCallback(() => {
    if (phase === 'idle' || phase === 'result') return start();
    if (phase === 'listening') {
      session.current?.stop(); // delivers what was heard -> onFinal -> translate
      return undefined;
    }
    if (phase === 'speaking') {
      clearAll();
      setDstShown(words(dstRef.current).length);
      return finish();
    }
    return undefined; // thinking: let it finish
  }, [phase, start, clearAll, finish]);

  const flash = useCallback(
    (state, text, ms = 2800) => {
      setOverride({ state, text });
      later(() => setOverride(null), ms);
    },
    [later]
  );

  const play = useCallback(
    (rate = 1) => {
      if (!dstRef.current) {
        toast('Tap the microphone and speak first.', 'info');
        return;
      }
      clearAll();
      setOverride(null);
      startSpeaking(rate, true);
    },
    [clearAll, startSpeaking, toast]
  );

  const repeat = useCallback(() => play(1), [play]);
  const slow = useCallback(() => {
    if (dstRef.current) toast('Playing slowly', 'info');
    play(prefs.voiceSpeed || 0.6);
  }, [play, prefs.voiceSpeed, toast]);

  const explain = useCallback(() => {
    const s = metaRef.current;
    if (!dstRef.current) {
      toast('Say something first, then tap Explain.', 'info');
      return;
    }
    if (!s?.explainHi) {
      toast('Explanations are available for lesson sentences', 'info');
      return;
    }
    clearAll();
    engine.speak(s.explainHi, { lang: 'hi-IN', rate: 0.95 });
    setOverride({ state: 'speaking', text: s.explainHi });
    later(() => setOverride(null), 4200);
  }, [clearAll, later, toast]);

  const encourage = useCallback(() => {
    clearAll();
    setOverride({ state: 'happy', text: 'शाबाश, बच्चों! 👏' });
    later(() => setOverride(null), 2800);
    toast('Encouragement sent to the class', 'success');
  }, [clearAll, later, toast]);

  // Teacher marks the child's spoken response.
  const markResponse = useCallback(
    (kind) => {
      clearAll();
      if (kind === 'correct') flash('happy', 'Excellent!', 3000);
      else if (kind === 'incorrect') flash('encouraging', "Almost there! Let's try again.", 3400);
      else flash('confused', "I didn't catch that. Try again?", 3400);
    },
    [clearAll, flash]
  );

  const reset = useCallback(() => {
    clearAll();
    run.current += 1;
    dstRef.current = '';
    metaRef.current = null;
    setPhase('idle');
    setOverride(null);
    setSrc('');
    setDst('');
    setMeta(null);
    setInfo(null);
    setSrcShown(0);
    setDstShown(0);
  }, [clearAll]);

  // Changing language or direction starts a fresh session.
  useEffect(() => {
    reset();
  }, [pair.from, pair.to, reset]);

  const srcList = words(src);
  const dstList = words(dst);

  const value = useMemo(
    () => ({
      phase,
      avatarState: override?.state ?? PHASE_TO_AVATAR[phase],
      overrideText: override?.text,
      hasResult: Boolean(dst),
      meaning: meta?.meaning || null,
      info,
      srcWords: srcList.slice(0, srcShown),
      dstWords: dstList.slice(0, dstShown),
      srcTotal: srcList.length,
      dstTotal: dstList.length,
      srcText: src,
      dstText: dst,
      toggle,
      start,
      submitText,
      repeat,
      slow,
      explain,
      encourage,
      markResponse,
      flash,
      reset,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, override, src, dst, meta, info, srcShown, dstShown, toggle, start, submitText, repeat, slow, explain, encourage, markResponse, flash, reset]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
