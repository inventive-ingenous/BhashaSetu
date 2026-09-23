/**
 * SentencePiece "unigram" tokenizer (the kind mT5 / T5 use), dependency-free.
 * Reads the vocab.json written by tools/convert_mt5.py: { pieces: [[piece, score], ...], unk, eos, pad }.
 */
const SPACE = '▁'; // ▁

export class UnigramTokenizer {
  constructor({ pieces, unk = 2, eos = 1, pad = 0 }) {
    this.pieces = pieces.map((p) => p[0]);
    this.unk = unk;
    this.eos = eos;
    this.pad = pad;
    this.map = new Map();
    let maxLen = 1;
    let minScore = 0;
    pieces.forEach(([p, s], id) => {
      if (id <= 2 || !p) return; // specials are never matched from text
      this.map.set(p, [id, s]);
      maxLen = Math.max(maxLen, [...p].length);
      minScore = Math.min(minScore, s);
    });
    this.maxLen = maxLen;
    this.unkScore = minScore - 10;
  }

  /** Text -> token ids (ends with </s>, which the encoder expects). */
  encode(text) {
    const norm = (text || '').normalize('NFKC').trim().split(/\s+/).filter(Boolean).join(SPACE);
    if (!norm) return [this.eos];
    const s = SPACE + norm;
    const cps = [...s]; // code points
    const pos = [0]; // UTF-16 offset of each code point boundary
    for (const c of cps) pos.push(pos[pos.length - 1] + c.length);
    const N = cps.length;
    const best = new Float64Array(N + 1).fill(-Infinity);
    const from = new Int32Array(N + 1);
    const tok = new Int32Array(N + 1);
    best[0] = 0;
    for (let e = 1; e <= N; e++) {
      for (let b = Math.max(0, e - this.maxLen); b < e; b++) {
        if (best[b] === -Infinity) continue;
        const hit = this.map.get(s.slice(pos[b], pos[e]));
        if (hit && best[b] + hit[1] > best[e]) {
          best[e] = best[b] + hit[1];
          from[e] = b;
          tok[e] = hit[0];
        }
      }
      if (best[e] === -Infinity) {
        // unknown character: emit <unk> for it
        best[e] = best[e - 1] + this.unkScore;
        from[e] = e - 1;
        tok[e] = this.unk;
      }
    }
    const ids = [];
    for (let e = N; e > 0; e = from[e]) ids.push(tok[e]);
    ids.reverse();
    // merge runs of <unk> like SentencePiece does
    const merged = ids.filter((id, i) => !(id === this.unk && ids[i - 1] === this.unk));
    merged.push(this.eos);
    return merged;
  }

  decode(ids) {
    return ids
      .filter((id) => id > 2)
      .map((id) => this.pieces[id] ?? '')
      .join('')
      .split(SPACE)
      .join(' ')
      .replace(/\s+([।॥,.?!:;])/g, '$1')
      .trim();
  }
}
