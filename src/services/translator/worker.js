/* Web Worker: loads translation models and runs them off the UI thread. */
import { loadModel, translateText } from './runtime.js';

self.onmessage = async ({ data }) => {
  const { reqId, type, modelId, baseUrl, text, options } = data;
  const post = (msg) => self.postMessage({ reqId, ...msg });
  try {
    await loadModel(modelId, baseUrl, (loaded, total) => post({ type: 'progress', loaded, total }));
    if (type === 'load') {
      post({ type: 'ready' });
      return;
    }
    post({ type: 'result', ...(await translateText(modelId, baseUrl, text, options)) });
  } catch (e) {
    post({ type: 'error', message: String(e?.message || e) });
  }
};
