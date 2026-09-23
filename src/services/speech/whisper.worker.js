/* Web Worker: offline Whisper speech recognition with transformers.js (ONNX Runtime, WebAssembly). */
import { pipeline, env } from '@huggingface/transformers';

let asr = null;
let loading = null;

function load({ model, dtype, device: wantDevice, modelsUrl, wasmUrl, files: installedFiles }, post) {
  if (asr) return Promise.resolve(asr);
  if (loading) return loading;

  // Everything comes from this app's own server - never from the internet.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Must be a PATH, not a full http:// URL: transformers.js v4 skips its local-file check for URLs,
  // decides preprocessor_config.json "does not exist" and builds the pipeline without a processor
  // ("Cannot read properties of null (reading 'feature_extractor')").
  env.localModelPath = new URL(modelsUrl, self.location.href).pathname;
  env.useBrowserCache = false;
  // Only files the setup script installed exist. Anything else is a clean 404, even when the dev
  // server would answer an unknown path with index.html.
  const installed = new Set((installedFiles || []).map((f) => `${env.localModelPath}${model}/${f}`));
  const baseFetch = self.fetch.bind(self);
  env.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, self.location.href);
    if (url.origin === self.location.origin && url.pathname.startsWith(`${env.localModelPath}${model}/`) && installed.size && !installed.has(url.pathname)) {
      return new Response(null, { status: 404, statusText: 'Not installed' });
    }
    const res = await baseFetch(input, init);
    if (res.ok && /\.json$/.test(url.pathname) && (res.headers.get('content-type') || '').includes('text/html')) {
      return new Response(null, { status: 404, statusText: 'Not found' });
    }
    return res;
  };
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    // transformers.js points ONNX Runtime at a CDN by default ({ mjs, wasm } URLs, v4) -
    // keep the same file names but serve them from public/ort/ so it works offline.
    const cur = wasm.wasmPaths;
    const name = (u) => String(u).split('/').pop();
    if (wasmUrl) {
      wasm.wasmPaths =
        cur && typeof cur === 'object' && cur.mjs && cur.wasm ? { mjs: wasmUrl + name(cur.mjs), wasm: wasmUrl + name(cur.wasm) } : wasmUrl;
    }
    // threads need cross-origin isolation (COOP/COEP headers, see vite.config.js)
    wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  }

  const files = {};
  const progress_callback = (p) => {
    if (p.status !== 'progress' || !p.file) return;
    files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
    let loaded = 0;
    let total = 0;
    Object.values(files).forEach((f) => {
      loaded += f.loaded;
      total += f.total;
    });
    post({ type: 'progress', loaded, total });
  };

  // WebGPU (graphics card) is much faster; fall back to the CPU (WebAssembly) when it is missing.
  const device = wantDevice === 'webgpu' && self.navigator?.gpu ? 'webgpu' : 'wasm';
  console.info('[BhashaSetu] offline speech model', model, 'on', device, JSON.stringify(dtype));
  loading = pipeline('automatic-speech-recognition', model, { dtype, device, progress_callback })
    .then((p) => {
      asr = p;
      return p;
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

// Whisper sometimes "hears" captions on noise: [संगीत], (music), ♪ ...
const clean = (t) =>
  (t || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

self.onmessage = async ({ data }) => {
  const { reqId, type } = data;
  const post = (msg) => self.postMessage({ reqId, ...msg });
  try {
    const p = await load(data.config, post);
    if (type === 'load') {
      post({ type: 'ready' });
      return;
    }
    const t0 = performance.now();
    const audio = data.audio;
    const opts = { language: data.language || 'hindi', task: 'transcribe' };
    if (audio.length > 30 * 16000) Object.assign(opts, { chunk_length_s: 30, stride_length_s: 5 });
    const out = await p(audio, opts);
    const text = clean(Array.isArray(out) ? out.map((o) => o.text).join(' ') : out?.text);
    post({ type: 'result', text, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    post({ type: 'error', message: String(e?.message || e) });
  }
};
