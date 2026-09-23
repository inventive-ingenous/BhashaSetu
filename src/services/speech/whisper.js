/**
 * Offline speech-recognition backend: microphone -> Whisper (in a Web Worker) -> text.
 *
 * Installed by `npm run setup:whisper`, which downloads the model into public/models/<id>/,
 * copies the ONNX Runtime files into public/ort/ and writes public/models/asr.json.
 * When asr.json is missing this backend simply reports itself unavailable and the app falls
 * back to browser speech recognition.
 */
import { startRecording } from './audio';
import { speechError } from './errors';

const BASE = import.meta.env?.BASE_URL ?? '/';
const LANG = { hi: 'hindi', en: 'english', bn: 'bengali', or: 'odia' }; // Whisper language names

let status = { state: 'unknown', progress: 0, error: null, manifest: null };
const listeners = new Set();
const set = (patch) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
};

// ---- worker plumbing
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.reqId);
    if (!p) return;
    if (data.type === 'progress') {
      p.onProgress?.(data);
      return;
    }
    pending.delete(data.reqId);
    if (data.type === 'error') p.reject(new Error(data.message));
    else p.resolve(data);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Speech worker failed to start');
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker = null;
  };
  return worker;
}

function request(msg, transfer = [], onProgress) {
  return new Promise((resolve, reject) => {
    const reqId = ++seq;
    pending.set(reqId, { resolve, reject, onProgress });
    try {
      getWorker().postMessage({ ...msg, reqId }, transfer);
    } catch (e) {
      pending.delete(reqId);
      reject(e);
    }
  });
}

const config = () => {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return {
    model: status.manifest.id,
    dtype: status.manifest.dtype || 'q8', // string, or { encoder_model, decoder_model_merged }
    modelsUrl: `${origin}${BASE}models/`,
    wasmUrl: `${origin}${BASE}ort/`,
    files: status.manifest.files || [],
    device: status.manifest.device || 'wasm',
  };
};

// ---- install check (runs once at startup)
const checked = (async () => {
  if (typeof fetch === 'undefined' || typeof Worker === 'undefined') {
    set({ state: 'missing' });
    return;
  }
  try {
    const r = await fetch(`${BASE}models/asr.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error('not installed');
    const manifest = await r.json(); // the dev server answers unknown paths with index.html -> JSON error
    if (!manifest?.id) throw new Error('bad manifest');
    set({ state: 'idle', manifest });
  } catch {
    set({ state: 'missing' });
  }
})();

let lastAudio = null; // copy of the last recording, for Settings > Play last recording
let loadPromise = null;
function preload() {
  if (status.state === 'ready') return Promise.resolve(true);
  if (!status.manifest) return Promise.resolve(false);
  if (loadPromise) return loadPromise;
  set({ state: 'loading', progress: 0, error: null });
  loadPromise = request({ type: 'load', config: config() }, [], (p) => set({ progress: p.total ? p.loaded / p.total : 0 }))
    .then(() => {
      set({ state: 'ready', progress: 1 });
      return true;
    })
    .catch((e) => {
      loadPromise = null;
      console.error('[BhashaSetu] offline speech model failed to load:', e);
      set({ state: 'error', error: e.message });
      return false;
    });
  return loadPromise;
}

async function transcribe(audio, language) {
  await preload();
  if (status.state !== 'ready') throw Object.assign(new Error(speechError('model-failed')), { code: 'model-failed' });
  lastAudio = audio.slice();
  const r = await request({ type: 'transcribe', config: config(), audio, language }, [audio.buffer]);
  return r.text;
}

export const whisper = {
  status: () => status,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  ready: checked,
  preload,
  hasRecording: () => Boolean(lastAudio),
  transcribe: (audio, language = 'hindi') => transcribe(audio, language),
  /** Play back exactly what the model received (16 kHz, after silence trimming). */
  async playLast() {
    if (!lastAudio) return false;
    const ctx = new AudioContext();
    const buf = ctx.createBuffer(1, lastAudio.length, 16000);
    buf.copyToChannel(lastAudio, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => ctx.close();
    src.start();
    return true;
  },
};

export const whisperBackend = {
  id: 'whisper',
  offline: true,
  get label() {
    return `Offline Whisper on this device${status.manifest ? ` (${status.manifest.id})` : ''}`;
  },
  available: () => ['idle', 'loading', 'ready'].includes(status.state) && Boolean(navigator.mediaDevices?.getUserMedia),

  listen({ lang, onFinal, onError, onProcessing, onLevel }) {
    const language = LANG[(lang || 'hi').split('-')[0]] || 'hindi';
    let rec = null;
    let stopAsked = false;
    let aborted = false;
    preload(); // warm up the model while the teacher is speaking

    startRecording({ onLevel })
      .then((r) => {
        rec = r;
        if (aborted) r.abort();
        else if (stopAsked) r.stop();
        return r.result;
      })
      .then(async (res) => {
        if (aborted) return;
        console.info('[BhashaSetu] recorded', res.durationMs, 'ms, speech detected:', res.speech);
        if (!res.speech) {
          onError('no-speech', speechError('no-speech'));
          return;
        }
        onProcessing?.();
        const text = await transcribe(res.audio, language);
        console.info('[BhashaSetu] offline speech heard:', JSON.stringify(text), `(${res.durationMs} ms of audio)`);
        if (aborted) return;
        if (text) onFinal(text);
        else onError('no-speech', speechError('no-speech'));
      })
      .catch((e) => {
        if (aborted || e?.code === 'aborted') return;
        console.error('[BhashaSetu] offline speech failed:', e);
        onError(e?.code || 'error', e?.code ? speechError(e.code, e.message) : `Offline speech recognition failed: ${e?.message || e}`);
      });

    return {
      stop() {
        if (rec) rec.stop();
        else stopAsked = true;
      },
      abort() {
        aborted = true;
        rec?.abort();
      },
    };
  },
};
