import { SAMPLES } from '../data/content';
import { modelFor } from '../data/languages';
import { translatorClient } from './translator/client';
import { recognizer } from './speech/recognizer';
import { whisper } from './speech/whisper';
import { tts } from './speech/tts';

/**
 * Language engine adapter - the UI talks ONLY to this file.
 *
 *   translate(text, pair)  -> on-device model when one exists for the pair (data/languages.js MODELS),
 *                             otherwise the sample phrases in data/content.js ("demo").
 *   listen(opts)           -> microphone -> text (services/speech/recognizer.js: browser now, offline Whisper next)
 *   speak(text, opts)      -> text-to-speech with a matching installed voice (services/speech/tts.js)
 *
 * pair = { from: 'hi', to: 'mun' }
 */

// ---- model load status, shared with the UI (useModelStatus in AppContext)
const statuses = {}; // modelId -> { state: 'idle'|'loading'|'ready'|'error', progress: 0..1, error }
const listeners = new Set();
const setStatus = (id, patch) => {
  statuses[id] = { ...(statuses[id] || { state: 'idle', progress: 0 }), ...patch };
  listeners.forEach((fn) => fn(id, statuses[id]));
};
const loads = {};

let translateOptions = {}; // e.g. { numBeams: 4 } for the slower, more careful search

export const engine = {
  setTranslateQuality(careful) {
    translateOptions = careful ? { numBeams: 4 } : {};
  },

  get mode() {
    return translatorClient.supported ? 'on-device' : 'demo';
  },

  /** A model exists for this pair and this browser can run it. */
  hasModel({ from, to }) {
    return Boolean(modelFor(from, to)) && translatorClient.supported;
  },

  /** Sample data can stand in for this pair (demo mode). */
  hasDemo({ from, to }) {
    return SAMPLES.some((s) => s[from] && s[to]);
  },

  canTranslate(pair) {
    return this.hasModel(pair) || this.hasDemo(pair);
  },

  status(modelId) {
    return statuses[modelId] || { state: 'idle', progress: 0 };
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Load the model for a pair in the background (first time downloads ~68 MB, then served from cache). */
  preload(pair) {
    const model = modelFor(pair.from, pair.to);
    if (!model || !translatorClient.supported) return Promise.resolve(false);
    if (loads[model.id]) return loads[model.id];
    setStatus(model.id, { state: 'loading', progress: 0, error: null });
    loads[model.id] = translatorClient
      .load(model, (p) => setStatus(model.id, { progress: p.total ? p.loaded / p.total : 0 }))
      .then(() => {
        setStatus(model.id, { state: 'ready', progress: 1 });
        return true;
      })
      .catch((e) => {
        delete loads[model.id];
        setStatus(model.id, { state: 'error', error: e.message });
        return false;
      });
    return loads[model.id];
  },

  /** Speech recognition. See recognizer.listen for options. */
  canListen: () => recognizer.available(),
  listenerInfo: () => recognizer.current(),
  listen: (opts) => recognizer.listen(opts),
  setListenMode: (m) => recognizer.setMode(m),
  /** Offline speech model: status(), subscribe(fn), preload(), ready (install check promise). */
  whisper,

  /**
   * Translate text. Resolves { text, source: 'model' | 'demo' | 'none', ms, error? }.
   * Never throws: a failed model falls back to demo data when possible.
   */
  async translate(text, pair) {
    const model = modelFor(pair.from, pair.to);
    let error;
    if (model && translatorClient.supported) {
      try {
        await this.preload(pair);
        const r = await translatorClient.translate(model, text, translateOptions);
        return { text: r.text, source: 'model', ms: r.ms };
      } catch (e) {
        error = e.message;
      }
    }
    const clean = (s) => (s || '').replace(/[\s।॥.?!,᱾]+/g, ' ').trim();
    const hit = SAMPLES.find((s) => s[pair.from] && clean(s[pair.from]) === clean(text));
    if (hit?.[pair.to]) return { text: hit[pair.to], source: 'demo', ms: 0, error };
    return { text: '', source: 'none', ms: 0, error };
  },

  /** Speak text; resolves true when finished, false when no voice could play it. */
  speak(text, opts) {
    return tts.speak(text, opts);
  },

  hasVoice: (lang) => tts.hasVoice(lang),
  voiceName: (lang) => tts.voiceName(lang),
  voiceKind: (lang) => tts.voiceKind(lang),

  stopSpeaking() {
    tts.stop();
  },
};
