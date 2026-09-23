#!/usr/bin/env node
/**
 * One-time setup for OFFLINE speech recognition (run once, with internet):
 *
 *   npm install
 *   npm run setup:whisper                  # Whisper small: full-precision encoder + 8-bit decoder (~510 MB)
 *   npm run setup:whisper -- --encoder q8  # Whisper small, all 8-bit (~250 MB, noticeably less accurate)
 *   npm run setup:whisper -- --model base  # Whisper base          (~80 MB, faster, less accurate)
 *   npm run setup:whisper -- --model tiny  # Whisper tiny          (~45 MB, for very weak devices)
 *   npm run setup:whisper -- --model turbo # Whisper large-v3-turbo (~1.5 GB, much better Hindi; needs a GPU browser - WebGPU)
 *   npm run setup:whisper -- --repo <hf-user>/<onnx-whisper-repo>   # any transformers.js Whisper export
 *
 * What it does:
 *   1. downloads the ONNX Whisper model into  public/models/<id>/
 *   2. copies the ONNX Runtime WebAssembly files into  public/ort/  (so nothing loads from a CDN)
 *   3. writes  public/models/asr.json  - the app sees it and switches to offline recognition
 *
 * After this the app needs no internet for speech recognition. Re-running skips files already downloaded.
 * Set HF_ENDPOINT to use a Hugging Face mirror.
 */
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(/\s*--/)
    .filter(Boolean)
    .map((kv) => {
      const [k, ...v] = kv.trim().split(/[\s=]+/);
      return [k, v.join(' ') || true];
    })
);

const PRESETS = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
  turbo: 'onnx-community/whisper-large-v3-turbo',
};
// Model-specific defaults: the turbo model is too big for full precision on the CPU, so it uses a
// 16-bit encoder + 4-bit decoder and runs on the graphics card (WebGPU) when the browser supports it.
const MODEL_DEFAULTS = { turbo: { encoder: 'fp16', dtype: 'q4', device: 'webgpu' } };
const SUFFIX = { fp32: '', fp16: '_fp16', q8: '_quantized', int8: '_int8', uint8: '_uint8', q4: '_q4', q4f16: '_q4f16' };

const repo = args.repo || PRESETS[args.model || 'small'];
if (!repo) {
  console.error(`Unknown --model "${args.model}". Use one of: ${Object.keys(PRESETS).join(', ')} (or --repo).`);
  process.exit(1);
}
// 8-bit quantisation of the ENCODER hurts Whisper's accuracy a lot (especially for Hindi);
// the decoder tolerates it well. Default: full-precision encoder + 8-bit decoder.
const md = MODEL_DEFAULTS[args.model] || {};
const decDtype = args.dtype || md.dtype || 'q8';
const encDtype = args.encoder || (args.dtype ? args.dtype : md.encoder || 'fp32');
const device = args.device || md.device || 'wasm';
for (const d of [decDtype, encDtype]) {
  if (!(d in SUFFIX)) {
    console.error(`Unknown dtype "${d}". Use one of: ${Object.keys(SUFFIX).join(', ')}`);
    process.exit(1);
  }
}
const id = args.id || repo.split('/').pop();
const hub = (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/$/, '');
const modelsDir = path.join(root, 'public', 'models');
const outDir = path.join(modelsDir, id);
const onnxFiles = [`onnx/encoder_model${SUFFIX[encDtype]}.onnx`, `onnx/decoder_model_merged${SUFFIX[decDtype]}.onnx`];
const FALLBACK = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'normalizer.json', 'vocab.json', 'merges.txt'];

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

async function listFiles() {
  try {
    const r = await fetch(`${hub}/api/models/${repo}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return (j.siblings || []).map((s) => s.rfilename);
  } catch (e) {
    console.warn(`  (could not list ${repo}: ${e.message}; using the standard file list)`);
    return null;
  }
}

async function download(file, { optional = false } = {}) {
  const dest = path.join(outDir, file);
  const url = `${hub}/${repo}/resolve/main/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (optional && res.status === 404) return 0;
    throw new Error(`${file}: HTTP ${res.status} from ${url}`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  if (total && fs.existsSync(dest) && fs.statSync(dest).size === total) {
    console.log(`  ✓ ${file} (already downloaded)`);
    await res.body?.cancel();
    return total;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const ws = fs.createWriteStream(tmp);
  let got = 0;
  let last = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!ws.write(chunk)) await once(ws, 'drain');
    if (process.stdout.isTTY && got - last > 2e6) {
      last = got;
      process.stdout.write(`\r  … ${file} ${mb(got)}${total ? ` / ${mb(total)}` : ''}   `);
    }
  }
  ws.end();
  await once(ws, 'finish');
  fs.renameSync(tmp, dest);
  if (process.stdout.isTTY) process.stdout.write('\r');
  console.log(`  ✓ ${file} ${mb(got)}                    `);
  return got;
}

// Find an installed package folder without require.resolve (packages with an "exports" map,
// like transformers.js, do not expose package.json to it).
function findPackage(name, startDirs) {
  for (const start of startDirs) {
    let dir = start;
    for (;;) {
      const candidate = path.join(dir, 'node_modules', ...name.split('/'));
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

function copyOrt() {
  const tfDir = findPackage('@huggingface/transformers', [root]);
  if (!tfDir) {
    console.error('\n@huggingface/transformers is not installed. Run "npm install" first, then run this again.');
    process.exit(1);
  }
  const tfVersion = JSON.parse(fs.readFileSync(path.join(tfDir, 'package.json'), 'utf8')).version;
  console.log(`  transformers.js ${tfVersion}`);
  const dirs = [];
  // the onnxruntime-web that transformers.js itself uses (nested copy first, then the hoisted one)
  const ortDir = findPackage('onnxruntime-web', [tfDir, root]);
  if (ortDir) dirs.push(path.join(ortDir, 'dist'));
  dirs.push(path.join(tfDir, 'dist'));
  const out = path.join(root, 'public', 'ort');
  fs.mkdirSync(out, { recursive: true });
  const copied = new Set();
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/^ort-wasm.*\.(wasm|mjs)$/.test(f) || copied.has(f)) continue;
      fs.copyFileSync(path.join(d, f), path.join(out, f));
      copied.add(f);
    }
  }
  if (!copied.size) {
    console.error('Could not find the ONNX Runtime WebAssembly files (ort-wasm*.wasm) in node_modules.');
    process.exit(1);
  }
  console.log(`  ✓ ONNX Runtime: ${copied.size} files -> public/ort/`);
}

async function main() {
  console.log(`\nBhashaSetu offline speech setup\n  model: ${repo} (encoder ${encDtype}, decoder ${decDtype})\n  into:  public/models/${id}/\n`);
  copyOrt();

  const listed = await listFiles();
  if (listed) {
    const missing = onnxFiles.filter((f) => !listed.includes(f));
    if (missing.length) {
      const avail = listed.filter((f) => f.startsWith('onnx/')).join('\n    ');
      console.error(`\n${repo} has no ${missing.join(', ')}.\nAvailable ONNX files:\n    ${avail}\nPick another --encoder / --dtype.`);
      process.exit(1);
    }
  }
  const small = listed ? listed.filter((f) => !f.includes('/') && /\.(json|txt)$/.test(f)) : FALLBACK;
  let bytes = 0;
  for (const f of small) bytes += await download(f, { optional: !listed });
  for (const f of onnxFiles) bytes += await download(f);

  const dtype = encDtype === decDtype ? decDtype : { encoder_model: encDtype, decoder_model_merged: decDtype };
  const manifest = { id, repo, dtype, device, language: 'hindi', files: [...small, ...onnxFiles], installedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(modelsDir, 'asr.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nDone: ${mb(bytes)} in public/models/${id}/ and public/models/asr.json written.`);
  console.log('Start the app (npm run dev) - Settings > Speech recognition should say "Offline model: Installed".\n');
}

main().catch((e) => {
  console.error(`\nSetup failed: ${e.message}\nCheck your internet connection and run "npm run setup:whisper" again (finished files are kept).`);
  process.exit(1);
});
