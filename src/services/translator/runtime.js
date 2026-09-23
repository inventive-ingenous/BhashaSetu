/**
 * Translation runtime shared by the Web Worker (normal path) and the main-thread fallback
 * (used only if the browser refuses to start the worker).
 */
import { UnigramTokenizer } from './tokenizer.js';
import { MT5, parseSafetensors } from './mt5.js';

const CACHE = 'bhashasetu-models-v1';
const loaded = new Map(); // modelId -> Promise<{ tok, model }>

async function cachedFetch(url) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {
    cache = null; // Cache API unavailable - just use the network / disk
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch {
      /* storage full - still works, just not cached */
    }
  }
  return res;
}

async function readWithProgress(res, onProgress) {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const buf = new Uint8Array(total);
  const reader = res.body.getReader();
  let got = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf.set(value, got);
    got += value.length;
    if (got - last > total / 50 || got === total) {
      last = got;
      onProgress?.(got, total);
    }
  }
  return buf.buffer;
}

export function loadModel(modelId, baseUrl, onProgress) {
  if (loaded.has(modelId)) return loaded.get(modelId);
  const p = (async () => {
    const [config, vocab] = await Promise.all([
      cachedFetch(`${baseUrl}config.json`).then((r) => r.json()),
      cachedFetch(`${baseUrl}vocab.json`).then((r) => r.json()),
    ]);
    const res = await cachedFetch(`${baseUrl}model.int8.safetensors`);
    const buf = await readWithProgress(res, onProgress);
    return { tok: new UnigramTokenizer(vocab), model: new MT5(config, parseSafetensors(buf)) };
  })();
  loaded.set(modelId, p);
  p.catch(() => loaded.delete(modelId));
  return p;
}

// The models are trained on single sentences: translate sentence by sentence.
const splitSentences = (text) =>
  text
    .split(/(?<=[।॥?!.᱾᱿])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

export async function translateText(modelId, baseUrl, text, options) {
  const { tok, model } = await loadModel(modelId, baseUrl);
  const t0 = performance.now();
  const out = splitSentences(text || '').map((s) => tok.decode((options?.numBeams > 1 ? model.generateBeam(tok.encode(s), options) : model.generate(tok.encode(s), options))));
  return { text: out.join(' '), ms: Math.round(performance.now() - t0) };
}
