/**
 * Dependency-free mT5 / T5-v1.1 encoder-decoder inference in plain JavaScript.
 *
 * Weights come from tools/convert_mt5.py: a safetensors file where every matrix is stored as
 * per-row int8 (`name` = I8, `name.scale` = F32) and norms / position biases stay float32.
 * Runs inside a Web Worker in the browser (and in Node for testing).
 */

export function parseSafetensors(buf) {
  const dv = new DataView(buf);
  const n = Number(dv.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  const base = 8 + n;
  const out = {};
  for (const [k, h] of Object.entries(header)) {
    if (k === '__metadata__') continue;
    const [a, z] = h.data_offsets;
    const off = base + a;
    const len = z - a;
    let data;
    if (h.dtype === 'I8') data = new Int8Array(buf, off, len);
    else if (h.dtype === 'F32') data = off % 4 === 0 ? new Float32Array(buf, off, len / 4) : new Float32Array(buf.slice(off, off + len));
    else throw new Error(`Unsupported dtype ${h.dtype} for ${k}`);
    out[k] = { shape: h.shape, data };
  }
  return out;
}

/** int8 matrix [out, in] with one float scale per output row. */
class Linear {
  constructor(t, name) {
    const w = t[name];
    if (!w) throw new Error(`Missing weight ${name}`);
    this.q = w.data;
    this.s = t[`${name}.scale`].data;
    [this.out, this.inn] = w.shape;
  }

  forward(x, y = new Float32Array(this.out)) {
    const { q, s, out, inn } = this;
    for (let j = 0, o = 0; j < out; j++, o += inn) {
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let a3 = 0;
      let i = 0;
      for (; i + 3 < inn; i += 4) {
        a0 += x[i] * q[o + i];
        a1 += x[i + 1] * q[o + i + 1];
        a2 += x[i + 2] * q[o + i + 2];
        a3 += x[i + 3] * q[o + i + 3];
      }
      for (; i < inn; i++) a0 += x[i] * q[o + i];
      y[j] = (a0 + a1 + a2 + a3) * s[j];
    }
    return y;
  }

  /** Row lookup (used for the token embedding table). */
  row(id, y = new Float32Array(this.inn)) {
    const { q, s, inn } = this;
    const o = id * inn;
    const sc = s[id];
    for (let i = 0; i < inn; i++) y[i] = q[o + i] * sc;
    return y;
  }
}

function rmsNorm(x, w, eps) {
  let v = 0;
  for (let i = 0; i < x.length; i++) v += x[i] * x[i];
  const r = 1 / Math.sqrt(v / x.length + eps);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = w[i] * x[i] * r;
  return y;
}

const GELU_C = Math.sqrt(2 / Math.PI);

function addInto(a, b) {
  for (let i = 0; i < a.length; i++) a[i] += b[i];
}

/** T5 relative-position bucket (same maths as HuggingFace `_relative_position_bucket`). */
function bucket(rel, bidirectional, numBuckets, maxDistance) {
  let ret = 0;
  let n = numBuckets;
  if (bidirectional) {
    n >>= 1;
    if (rel > 0) ret += n;
    rel = Math.abs(rel);
  } else {
    rel = -Math.min(rel, 0);
  }
  const maxExact = n >> 1;
  if (rel < maxExact) return ret + rel;
  const v = maxExact + Math.floor((Math.log(rel / maxExact) / Math.log(maxDistance / maxExact)) * (n - maxExact));
  return ret + Math.min(v, n - 1);
}

export class MT5 {
  constructor(config, tensors) {
    this.c = config;
    const t = tensors;
    this.H = config.num_heads;
    this.dk = config.d_kv;
    this.inner = this.H * this.dk;
    this.eps = config.layer_norm_epsilon ?? 1e-6;
    this.embed = new Linear(t, 'shared.weight');
    this.lmHead = new Linear(t, 'lm_head.weight');
    const f = (k) => {
      if (!t[k]) throw new Error(`Missing weight ${k}`);
      return t[k].data;
    };
    const attn = (p) => ({
      q: new Linear(t, `${p}q.weight`),
      k: new Linear(t, `${p}k.weight`),
      v: new Linear(t, `${p}v.weight`),
      o: new Linear(t, `${p}o.weight`),
    });
    const ff = (p) => ({ wi0: new Linear(t, `${p}wi_0.weight`), wi1: new Linear(t, `${p}wi_1.weight`), wo: new Linear(t, `${p}wo.weight`) });
    this.enc = [];
    for (let l = 0; l < config.num_layers; l++) {
      const p = `encoder.block.${l}.layer.`;
      this.enc.push({ ln0: f(`${p}0.layer_norm.weight`), sa: attn(`${p}0.SelfAttention.`), ln1: f(`${p}1.layer_norm.weight`), ff: ff(`${p}1.DenseReluDense.`) });
    }
    this.dec = [];
    for (let l = 0; l < config.num_decoder_layers; l++) {
      const p = `decoder.block.${l}.layer.`;
      this.dec.push({
        ln0: f(`${p}0.layer_norm.weight`),
        sa: attn(`${p}0.SelfAttention.`),
        ln1: f(`${p}1.layer_norm.weight`),
        ca: attn(`${p}1.EncDecAttention.`),
        ln2: f(`${p}2.layer_norm.weight`),
        ff: ff(`${p}2.DenseReluDense.`),
      });
    }
    this.encFinal = f('encoder.final_layer_norm.weight');
    this.decFinal = f('decoder.final_layer_norm.weight');
    // [buckets, heads]; only block 0 owns a bias table, the other blocks reuse it
    this.encBias = f('encoder.block.0.layer.0.SelfAttention.relative_attention_bias.weight');
    this.decBias = f('decoder.block.0.layer.0.SelfAttention.relative_attention_bias.weight');
  }

  posBias(table, rel, bidirectional, h) {
    const b = bucket(rel, bidirectional, this.c.relative_attention_num_buckets, this.c.relative_attention_max_distance);
    return table[b * this.H + h];
  }

  /** One query vector against key/value vectors. biasFn(h, j) -> additive bias. T5 uses no 1/sqrt(d) scaling. */
  attend(q, K, V, biasFn) {
    const { H, dk } = this;
    const out = new Float32Array(this.inner);
    const n = K.length;
    const sc = new Float32Array(n);
    for (let h = 0; h < H; h++) {
      const o = h * dk;
      let mx = -Infinity;
      for (let j = 0; j < n; j++) {
        const k = K[j];
        let s = 0;
        for (let d = 0; d < dk; d++) s += q[o + d] * k[o + d];
        if (biasFn) s += biasFn(h, j);
        sc[j] = s;
        if (s > mx) mx = s;
      }
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sc[j] = Math.exp(sc[j] - mx);
        sum += sc[j];
      }
      for (let j = 0; j < n; j++) {
        const p = sc[j] / sum;
        const v = V[j];
        for (let d = 0; d < dk; d++) out[o + d] += p * v[o + d];
      }
    }
    return out;
  }

  /** Gated-GELU feed-forward (T5 v1.1 / mT5). */
  feedForward(ff, x) {
    const a = ff.wi0.forward(x);
    const b = ff.wi1.forward(x);
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      a[i] = 0.5 * v * (1 + Math.tanh(GELU_C * (v + 0.044715 * v * v * v))) * b[i];
    }
    return ff.wo.forward(a);
  }

  encode(ids) {
    const X = ids.map((id) => this.embed.row(id));
    const S = X.length;
    const bias = [];
    for (let h = 0; h < this.H; h++) {
      const m = new Float32Array(S * S);
      for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) m[i * S + j] = this.posBias(this.encBias, j - i, true, h);
      bias.push(m);
    }
    for (const L of this.enc) {
      const N = X.map((x) => rmsNorm(x, L.ln0, this.eps));
      const Q = N.map((x) => L.sa.q.forward(x));
      const K = N.map((x) => L.sa.k.forward(x));
      const V = N.map((x) => L.sa.v.forward(x));
      for (let i = 0; i < S; i++) {
        const a = this.attend(Q[i], K, V, (h, j) => bias[h][i * S + j]);
        addInto(X[i], L.sa.o.forward(a));
      }
      for (let i = 0; i < S; i++) addInto(X[i], this.feedForward(L.ff, rmsNorm(X[i], L.ln1, this.eps)));
    }
    return X.map((x) => rmsNorm(x, this.encFinal, this.eps));
  }

  /**
   * Greedy decoding with repetition control.
   * options: maxNewTokens, noRepeatNgramSize, repetitionPenalty, bannedIds, shouldStop(), onStep(logits)
   */
  generate(inputIds, options = {}) {
    const {
      maxNewTokens = Math.min(128, inputIds.length * 3 + 8),
      noRepeatNgramSize = 3,
      repetitionPenalty = 1.2,
      bannedIds = [this.c.pad_token_id ?? 0, 2],
      forcedIds = null, // for testing: feed these tokens instead of choosing
      shouldStop,
      onStep,
    } = options;
    const eos = this.c.eos_token_id ?? 1;
    const encOut = this.encode(inputIds);
    const cross = this.dec.map((L) => ({ K: encOut.map((x) => L.ca.k.forward(x)), V: encOut.map((x) => L.ca.v.forward(x)) }));
    const selfK = this.dec.map(() => []);
    const selfV = this.dec.map(() => []);
    const out = [];
    let tok = this.c.decoder_start_token_id ?? 0;
    const steps = forcedIds ? forcedIds.length : maxNewTokens;
    for (let t = 0; t < steps; t++) {
      if (shouldStop?.()) break;
      const x = this.embed.row(tok);
      this.dec.forEach((L, l) => {
        const n0 = rmsNorm(x, L.ln0, this.eps);
        selfK[l].push(L.sa.k.forward(n0));
        selfV[l].push(L.sa.v.forward(n0));
        const q = L.sa.q.forward(n0);
        addInto(x, L.sa.o.forward(this.attend(q, selfK[l], selfV[l], (h, j) => this.posBias(this.decBias, j - t, false, h))));
        const n1 = rmsNorm(x, L.ln1, this.eps);
        addInto(x, L.ca.o.forward(this.attend(L.ca.q.forward(n1), cross[l].K, cross[l].V, null)));
        addInto(x, this.feedForward(L.ff, rmsNorm(x, L.ln2, this.eps)));
      });
      const logits = this.lmHead.forward(rmsNorm(x, this.decFinal, this.eps));
      onStep?.(logits);
      if (forcedIds) {
        tok = forcedIds[t];
        out.push(tok);
        continue;
      }
      if (repetitionPenalty !== 1) {
        for (const id of new Set(out)) logits[id] = logits[id] > 0 ? logits[id] / repetitionPenalty : logits[id] * repetitionPenalty;
      }
      for (const id of bannedIds) logits[id] = -Infinity;
      const n = noRepeatNgramSize;
      if (n > 0 && out.length >= n - 1) {
        const tail = out.slice(out.length - (n - 1)).join(',');
        for (let i = 0; i + n <= out.length; i++) {
          if (out.slice(i, i + n - 1).join(',') === tail) logits[out[i + n - 1]] = -Infinity;
        }
      }
      let best = 0;
      for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
      if (best === eos) break;
      out.push(best);
      tok = best;
    }
    return out;
  }

  /** One decoder step for one hypothesis. cache = { K: [layer][t], V: [layer][t] } (arrays are extended). */
  decodeStep(tok, t, cross, cache) {
    const x = this.embed.row(tok);
    this.dec.forEach((L, l) => {
      const n0 = rmsNorm(x, L.ln0, this.eps);
      cache.K[l].push(L.sa.k.forward(n0));
      cache.V[l].push(L.sa.v.forward(n0));
      const q = L.sa.q.forward(n0);
      addInto(x, L.sa.o.forward(this.attend(q, cache.K[l], cache.V[l], (h, j) => this.posBias(this.decBias, j - t, false, h))));
      const n1 = rmsNorm(x, L.ln1, this.eps);
      addInto(x, L.ca.o.forward(this.attend(L.ca.q.forward(n1), cross[l].K, cross[l].V, null)));
      addInto(x, this.feedForward(L.ff, rmsNorm(x, L.ln2, this.eps)));
    });
    return this.lmHead.forward(rmsNorm(x, this.decFinal, this.eps));
  }

  /**
   * Beam search: keeps the `numBeams` most likely partial translations at every step instead of
   * only the single best word (greedy). Usually gives more fluent, more accurate sentences.
   */
  generateBeam(inputIds, options = {}) {
    const {
      numBeams = 4,
      maxNewTokens = Math.min(128, inputIds.length * 3 + 8),
      noRepeatNgramSize = 3,
      repetitionPenalty = 1.2,
      lengthPenalty = 1.0,
      bannedIds = [this.c.pad_token_id ?? 0, 2],
      shouldStop,
    } = options;
    const eos = this.c.eos_token_id ?? 1;
    const encOut = this.encode(inputIds);
    const cross = this.dec.map((L) => ({ K: encOut.map((x) => L.ca.k.forward(x)), V: encOut.map((x) => L.ca.v.forward(x)) }));
    const newCache = () => ({ K: this.dec.map(() => []), V: this.dec.map(() => []) });
    const copyCache = (c) => ({ K: c.K.map((a) => a.slice()), V: c.V.map((a) => a.slice()) });
    let beams = [{ tokens: [], logp: 0, cache: newCache(), last: this.c.decoder_start_token_id ?? 0 }];
    const done = [];
    const norm = (b) => b.logp / Math.pow(Math.max(1, b.tokens.length), lengthPenalty);

    for (let t = 0; t < maxNewTokens && beams.length; t++) {
      if (shouldStop?.()) break;
      const cand = [];
      for (const b of beams) {
        const logits = this.decodeStep(b.last, t, cross, b.cache);
        if (repetitionPenalty !== 1) {
          for (const id of new Set(b.tokens)) logits[id] = logits[id] > 0 ? logits[id] / repetitionPenalty : logits[id] * repetitionPenalty;
        }
        for (const id of bannedIds) logits[id] = -Infinity;
        const n = noRepeatNgramSize;
        const out = b.tokens;
        if (n > 0 && out.length >= n - 1) {
          const tail = out.slice(out.length - (n - 1)).join(',');
          for (let i = 0; i + n <= out.length; i++) if (out.slice(i, i + n - 1).join(',') === tail) logits[out[i + n - 1]] = -Infinity;
        }
        // log-softmax
        let mx = -Infinity;
        for (let i = 0; i < logits.length; i++) if (logits[i] > mx) mx = logits[i];
        let sum = 0;
        for (let i = 0; i < logits.length; i++) sum += Math.exp(logits[i] - mx);
        const lse = mx + Math.log(sum);
        // top (2 * numBeams) tokens of this beam
        const k = 2 * numBeams;
        const top = [];
        for (let i = 0; i < logits.length; i++) {
          const v = logits[i];
          if (v === -Infinity) continue;
          if (top.length < k) {
            top.push([v, i]);
            if (top.length === k) top.sort((a, c) => a[0] - c[0]);
          } else if (v > top[0][0]) {
            top[0] = [v, i];
            top.sort((a, c) => a[0] - c[0]);
          }
        }
        for (const [v, id] of top) cand.push({ parent: b, id, logp: b.logp + (v - lse) });
      }
      cand.sort((a, c) => c.logp - a.logp);
      const next = [];
      for (const c of cand) {
        if (c.id === eos) {
          if (c.parent.tokens.length) done.push({ tokens: c.parent.tokens, logp: c.logp });
        } else {
          next.push({ tokens: [...c.parent.tokens, c.id], logp: c.logp, cache: null, parent: c.parent, last: c.id });
        }
        if (next.length >= numBeams) break;
      }
      // share caches: the first child of a parent takes it over, the others copy
      const used = new Set();
      for (const b of next) {
        b.cache = used.has(b.parent) ? copyCache(b.parent.cache) : b.parent.cache;
        used.add(b.parent);
        delete b.parent;
      }
      beams = next;
      // stop once enough finished hypotheses beat every open one
      if (done.length >= numBeams) {
        const bestDone = Math.max(...done.map(norm));
        const bestOpen = beams.length ? Math.max(...beams.map((b) => b.logp / Math.pow(maxNewTokens, lengthPenalty))) : -Infinity;
        if (bestDone >= bestOpen || !beams.length) break;
      }
    }
    const all = done.length ? done : beams;
    all.sort((a, c) => norm(c) - norm(a));
    return all[0]?.tokens || [];
  }
}
