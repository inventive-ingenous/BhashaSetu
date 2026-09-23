/**
 * UI-side handle to the translation engine. One worker, many models (one per language pair).
 * If the browser will not start the worker, translation runs on the main thread instead
 * (the UI pauses for a moment per sentence, but it keeps working).
 */
let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function describe(e) {
  const where = e?.filename ? ` (${e.filename}:${e.lineno})` : '';
  return `${e?.message || 'Translation worker failed to start'}${where}`;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
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
    console.error('[BhashaSetu] translation worker error:', describe(e), e);
    e.preventDefault?.();
    workerBroken = true;
    const retry = [...pending.values()];
    pending.clear();
    worker?.terminate();
    worker = null;
    retry.forEach((p) => p.fallback());
  };
  return worker;
}

async function onMainThread(msg, onProgress) {
  const rt = await import('./runtime.js');
  await rt.loadModel(msg.modelId, msg.baseUrl, (loaded, total) => onProgress?.({ loaded, total }));
  if (msg.type === 'load') return { type: 'ready' };
  return { type: 'result', ...(await rt.translateText(msg.modelId, msg.baseUrl, msg.text, msg.options)) };
}

function request(msg, onProgress) {
  if (workerBroken) return onMainThread(msg, onProgress);
  return new Promise((resolve, reject) => {
    const reqId = ++seq;
    const fallback = () => onMainThread(msg, onProgress).then(resolve, reject);
    pending.set(reqId, { resolve, reject, onProgress, fallback });
    try {
      getWorker().postMessage({ ...msg, reqId });
    } catch (e) {
      console.error('[BhashaSetu] could not start translation worker:', e);
      pending.delete(reqId);
      workerBroken = true;
      fallback();
    }
  });
}

export const translatorClient = {
  supported: typeof location !== 'undefined' && location.protocol !== 'file:',
  load: (model, onProgress) => request({ type: 'load', modelId: model.id, baseUrl: model.url }, onProgress),
  translate: (model, text, options) => request({ type: 'translate', modelId: model.id, baseUrl: model.url, text, options: { ...model.generation, ...options } }),
};
