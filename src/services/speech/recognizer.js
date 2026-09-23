/**
 * Speech-to-text, behind one small interface so backends can be swapped:
 *
 *   const session = recognizer.listen({ lang: 'hi-IN', onPartial, onFinal, onError })
 *   session.stop()   // finish now and deliver what was heard
 *   session.abort()  // cancel, deliver nothing
 *
 * Backends (Auto = online when there is internet, offline Whisper when not):
 *   'whisper' - offline Whisper in the browser (services/speech/whisper.js) - used when installed
 *   'browser' - Web Speech API (Chrome / Edge). Needs internet.
 *
 * Mode (Settings > Speech recognition): 'auto' | 'offline' | 'online'.
 */
import { SPEECH_ERRORS } from './errors';
import { whisperBackend } from './whisper';

const SILENCE_MS = 1600; // stop automatically after this long without new words
const MAX_MS = 30000; // hard limit for one utterance

const ERRORS = SPEECH_ERRORS;

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const browserBackend = {
  id: 'browser',
  label: 'Browser speech recognition (Chrome / Edge, needs internet)',
  offline: false,
  available: () => Boolean(SR),
  listen({ lang, onPartial, onFinal, onError }) {
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = '';
    let interim = '';
    let done = false;
    let aborted = false;
    let silence = null;
    const hardStop = setTimeout(() => stop(), MAX_MS);

    const text = () => `${finalText} ${interim}`.replace(/\s+/g, ' ').trim();
    const armSilence = () => {
      clearTimeout(silence);
      silence = setTimeout(() => stop(), SILENCE_MS);
    };
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(silence);
      clearTimeout(hardStop);
      if (aborted) return;
      const heard = text();
      if (heard) onFinal(heard);
      else onError(err || 'no-speech', ERRORS[err || 'no-speech'] || `Speech recognition error: ${err}`);
    };
    function stop() {
      try {
        rec.stop(); // triggers onend -> finish
      } catch {
        finish();
      }
    }

    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += ` ${r[0].transcript}`;
        else interim += ` ${r[0].transcript}`;
      }
      onPartial?.(text());
      armSilence();
    };
    let lastError = null;
    rec.onerror = (e) => {
      lastError = e.error;
      if (e.error === 'aborted') return;
    };
    rec.onend = () => finish(text() ? null : lastError);

    try {
      rec.start();
    } catch (e) {
      done = true;
      clearTimeout(hardStop);
      onError('start-failed', `Could not start the microphone: ${e.message}`);
    }
    return {
      stop,
      abort() {
        aborted = true;
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
        finish();
      },
    };
  },
};

const backends = [whisperBackend, browserBackend];
let mode = 'auto';

export const recognizer = {
  setMode(m) {
    mode = ['offline', 'online'].includes(m) ? m : 'auto';
  },
  mode: () => mode,
  /** Register an extra backend. Earlier entries win, so offline ones go first. */
  register(backend, { first = true } = {}) {
    if (first) backends.unshift(backend);
    else backends.push(backend);
  },
  current() {
    const ok = (b) => (mode === 'offline' ? b.offline : mode === 'online' ? !b.offline : true);
    // Auto: the browser's online recogniser is far more accurate for Hindi than the offline model,
    // so use it whenever there is internet; fall back to offline Whisper only without internet.
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    const order = mode === 'auto' && isOnline ? [...backends].sort((x, y) => Number(x.offline) - Number(y.offline)) : backends;
    return order.find((b) => ok(b) && b.available()) || null;
  },
  available() {
    return Boolean(this.current());
  },
  listen(opts) {
    const b = this.current();
    if (!b) {
      opts.onError('unsupported', ERRORS.unsupported);
      return { stop() {}, abort() {} };
    }
    if (!b.offline && typeof navigator !== 'undefined' && navigator.onLine === false) {
      opts.onError('network', ERRORS.network);
      return { stop() {}, abort() {} };
    }
    console.info('[BhashaSetu] speech recognition via', b.id);
    return b.listen(opts);
  },
};
