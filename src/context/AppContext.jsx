import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { load, save } from '../lib/storage';
import { CLASSES } from '../data/content';
import { DEFAULT_TARGET, LANGUAGES, SOURCE, TARGETS, modelFor } from '../data/languages';
import { engine } from '../services/engine';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const DEFAULT_PREFS = { largeText: false, reduceMotion: false, voiceSpeed: 0.6, asr: 'auto', carefulTranslate: false };

/** Live state of the offline speech model: { state: unknown|missing|idle|loading|ready|error, progress, manifest }. */
export function useWhisperStatus() {
  const [st, setSt] = useState(() => engine.whisper.status());
  useEffect(() => {
    setSt(engine.whisper.status());
    return engine.whisper.subscribe(setSt);
  }, []);
  return st;
}

/** Live load state of a translation model: { state, progress, error }. */
export function useModelStatus(pair) {
  const model = pair ? modelFor(pair.from, pair.to) : null;
  const id = model?.id;
  const [st, setSt] = useState(() => (id ? engine.status(id) : { state: 'none', progress: 0 }));
  useEffect(() => {
    if (!id) {
      setSt({ state: 'none', progress: 0 });
      return undefined;
    }
    setSt(engine.status(id));
    return engine.subscribe((mid, s) => mid === id && setSt(s));
  }, [id]);
  return { ...st, model };
}

export function AppProvider({ children }) {
  const [klass, setKlass] = useState(() => load('bs.class', CLASSES[0]));
  // lang: the tribal language being taught (mun | sat | ho). direction: 'forward' = Hindi -> lang.
  const [lang, setLangState] = useState(() => {
    const l = load('bs.lang', DEFAULT_TARGET);
    return TARGETS.includes(l) ? l : DEFAULT_TARGET;
  });
  const [direction, setDirectionState] = useState(() => load('bs.dir', 'forward'));
  const [prefs, setPrefsState] = useState(() => ({ ...DEFAULT_PREFS, ...load('bs.prefs', {}) }));
  const [records, setRecords] = useState(() => load('bs.records', []));
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const forwardPair = useMemo(() => ({ from: SOURCE, to: lang }), [lang]);
  const reversePair = useMemo(() => ({ from: lang, to: SOURCE }), [lang]);
  const canReverse = engine.canTranslate(reversePair);
  const dir = direction === 'reverse' && canReverse ? 'reverse' : 'forward';
  const pair = dir === 'forward' ? forwardPair : reversePair;

  useEffect(() => save('bs.class', klass), [klass]);
  useEffect(() => save('bs.lang', lang), [lang]);
  useEffect(() => save('bs.dir', direction), [direction]);
  useEffect(() => save('bs.prefs', prefs), [prefs]);
  useEffect(() => save('bs.records', records), [records]);

  // Warm up the model for the chosen language once the page has settled.
  useEffect(() => {
    const t = setTimeout(() => engine.preload(pair), 600);
    return () => clearTimeout(t);
  }, [pair]);

  useEffect(() => engine.setTranslateQuality(prefs.carefulTranslate), [prefs.carefulTranslate]);

  // Speech recognition mode + warm up the offline speech model once it is known to be installed.
  useEffect(() => {
    engine.setListenMode(prefs.asr);
    if (prefs.asr === 'online' || (prefs.asr !== 'offline' && navigator.onLine)) return undefined;
    let t;
    engine.whisper.ready.then(() => {
      t = setTimeout(() => engine.whisper.preload(), 1500);
    });
    return () => clearTimeout(t);
  }, [prefs.asr]);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('large-text', prefs.largeText);
    el.classList.toggle('reduce-motion', prefs.reduceMotion);
  }, [prefs]);

  const setPrefs = useCallback((patch) => setPrefsState((p) => ({ ...p, ...patch })), []);
  const setLang = useCallback((l) => TARGETS.includes(l) && setLangState(l), []);
  const setDirection = useCallback((d) => setDirectionState(d === 'reverse' ? 'reverse' : 'forward'), []);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 260);
  }, []);

  const toast = useCallback(
    (message, type = 'info') => {
      const id = ++toastId.current;
      setToasts((t) => [...t.slice(-2), { id, message, type }]);
      setTimeout(() => dismissToast(id), 3200);
    },
    [dismissToast]
  );

  const addRecord = useCallback((rec) => setRecords((r) => [{ ...rec, at: Date.now() }, ...r].slice(0, 20)), []);

  const value = useMemo(
    () => ({
      klass,
      setKlass,
      lang,
      setLang,
      target: LANGUAGES[lang],
      direction: dir,
      setDirection,
      canReverse,
      pair,
      fromLang: LANGUAGES[pair.from],
      toLang: LANGUAGES[pair.to],
      prefs,
      setPrefs,
      records,
      addRecord,
      toasts,
      toast,
      dismissToast,
    }),
    [klass, lang, setLang, dir, setDirection, canReverse, pair, prefs, setPrefs, records, addRecord, toasts, toast, dismissToast]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
