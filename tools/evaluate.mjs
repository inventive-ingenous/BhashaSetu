#!/usr/bin/env node
/**
 * Measure translation accuracy of the on-device model on real sentence pairs.
 *
 *   node tools/evaluate.mjs <pairs.tsv> [--model public/models/hi-mun] [--n 200] [--beams 4] [--out report.tsv]
 *
 * pairs.tsv: one pair per line, "Hindi<TAB>Mundari" (a header line is skipped automatically).
 * Use sentences the model was NOT trained on (your validation / test split), otherwise the score is inflated.
 *
 * Prints BLEU (word overlap, 0-100) and chrF (character overlap, 0-100, better for Mundari's
 * rich word endings) - the standard metrics for machine translation - plus exact-match %.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--'));
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
if (!file) {
  console.error('Usage: node tools/evaluate.mjs <pairs.tsv> [--model public/models/hi-mun] [--n 200] [--beams 4] [--out report.tsv]');
  process.exit(1);
}
const modelDir = path.resolve(root, opt('model', 'public/models/hi-mun'));
const N = Number(opt('n', 200));
const beams = Number(opt('beams', 1));
const out = opt('out', null);

const { UnigramTokenizer } = await import(pathToFileURL(path.join(root, 'src/services/translator/tokenizer.js')));
const { MT5, parseSafetensors } = await import(pathToFileURL(path.join(root, 'src/services/translator/mt5.js')));
const buf = fs.readFileSync(path.join(modelDir, 'model.int8.safetensors'));
const tok = new UnigramTokenizer(JSON.parse(fs.readFileSync(path.join(modelDir, 'vocab.json'), 'utf8')));
const model = new MT5(JSON.parse(fs.readFileSync(path.join(modelDir, 'config.json'), 'utf8')), parseSafetensors(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));

let pairs = fs
  .readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.split('\t'))
  .filter((c) => c.length >= 2 && c[0].trim() && c[1].trim())
  .map(([hi, mun]) => [hi.trim(), mun.trim()]);
if (pairs.length && !/[ऀ-ॿ]/.test(pairs[0][0])) pairs = pairs.slice(1); // header
// spread the sample over the whole file instead of taking the first N lines
if (pairs.length > N) {
  const step = pairs.length / N;
  pairs = Array.from({ length: N }, (_, i) => pairs[Math.floor(i * step)]);
}

const norm = (s) => s.normalize('NFC').replace(/[।॥.,?!:;"'“”‘’()-]/g, ' ').replace(/ः/g, 'ः').replace(/\s+/g, ' ').trim();
const ngrams = (arr, n) => {
  const m = new Map();
  for (let i = 0; i + n <= arr.length; i++) {
    const k = arr.slice(i, i + n).join('\u0001');
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
};
const overlap = (a, b) => {
  let c = 0;
  for (const [k, v] of a) c += Math.min(v, b.get(k) || 0);
  return c;
};
const total = (m) => [...m.values()].reduce((x, y) => x + y, 0);

// corpus BLEU-4 (whitespace tokens)
const bleuStats = { match: [0, 0, 0, 0], count: [0, 0, 0, 0], hyp: 0, ref: 0 };
// chrF (character 1..6-grams, beta = 2), averaged over sentences
let chrfSum = 0;
let exact = 0;
const rows = [];
const t0 = Date.now();
pairs.forEach(([hi, ref], i) => {
  const ids = tok.encode(hi);
  const opts = { noRepeatNgramSize: 3, repetitionPenalty: 1.2 };
  const hyp = tok.decode(beams > 1 ? model.generateBeam(ids, { ...opts, numBeams: beams }) : model.generate(ids, opts));
  const h = norm(hyp);
  const r = norm(ref);
  if (h === r) exact++;
  const hw = h.split(' ').filter(Boolean);
  const rw = r.split(' ').filter(Boolean);
  bleuStats.hyp += hw.length;
  bleuStats.ref += rw.length;
  for (let n = 1; n <= 4; n++) {
    const hn = ngrams(hw, n);
    bleuStats.match[n - 1] += overlap(hn, ngrams(rw, n));
    bleuStats.count[n - 1] += total(hn);
  }
  const hc = [...h.replace(/ /g, '')];
  const rc = [...r.replace(/ /g, '')];
  let p = 0;
  let rr = 0;
  let k = 0;
  for (let n = 1; n <= 6; n++) {
    const hn = ngrams(hc, n);
    const rn = ngrams(rc, n);
    const th = total(hn);
    const tr = total(rn);
    if (!th || !tr) continue;
    const o = overlap(hn, rn);
    p += o / th;
    rr += o / tr;
    k++;
  }
  p = k ? p / k : 0;
  rr = k ? rr / k : 0;
  const chrf = p + rr ? ((1 + 4) * p * rr) / (4 * p + rr) : 0;
  chrfSum += chrf;
  rows.push([hi, ref, hyp, (chrf * 100).toFixed(1)]);
  if ((i + 1) % 10 === 0 || i === pairs.length - 1) process.stdout.write(`\r  translated ${i + 1}/${pairs.length}`);
});
const precisions = bleuStats.match.map((m, i) => (m + (i ? 1 : 0)) / (bleuStats.count[i] + (i ? 1 : 0))); // +1 smoothing for n>1
const bp = bleuStats.hyp > bleuStats.ref ? 1 : Math.exp(1 - bleuStats.ref / Math.max(1, bleuStats.hyp));
const bleu = bp * Math.exp(precisions.reduce((s, p) => s + Math.log(Math.max(p, 1e-9)), 0) / 4) * 100;
const chrF = (chrfSum / pairs.length) * 100;

console.log(`\n\nSentences: ${pairs.length}   decoding: ${beams > 1 ? `beam search (${beams})` : 'greedy'}   time: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`BLEU  : ${bleu.toFixed(1)} / 100   (word overlap with the reference translation)`);
console.log(`chrF  : ${chrF.toFixed(1)} / 100   (character overlap - the main score for Mundari)`);
console.log(`Exact : ${((exact / pairs.length) * 100).toFixed(1)} %   (identical to the reference)`);
if (out) {
  fs.writeFileSync(out, ['hindi\treference\tmodel\tchrF', ...rows.map((r) => r.join('\t'))].join('\n'));
  console.log(`Per-sentence results written to ${out}`);
}
