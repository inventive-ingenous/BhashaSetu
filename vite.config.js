import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation (COOP/COEP) would let the speech model use several CPU threads, but it
// also blocks workers/resources that lack matching headers. Kept OFF for now; to try it, set
// ISOLATE = true (and serve the built app with the same two headers).
const ISOLATE = false;
const isolation = ISOLATE
  ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  : {};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true, headers: isolation },
  preview: { headers: isolation },
  // the translation and speech workers are ES modules
  worker: { format: 'es' },
  // transformers.js loads ONNX Runtime itself; pre-bundling it breaks that
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
