"""
Shrink a fine-tuned mT5 / T5 checkpoint so BhashaSetu can run it on-device in the browser.

  python tools/convert_mt5.py <hf_model_dir> public/models/<pair> [--scripts deva,olck]

Input: a HuggingFace folder (config.json, model.safetensors, spiece.model) - e.g. the Colab output.
Output (in the target folder):
  model.int8.safetensors  every matrix as per-row int8 + float32 scale, norms/biases float32
  vocab.json              SentencePiece pieces + scores, re-numbered to the kept vocabulary
  config.json             the few numbers the JS runtime needs

Two things make it small (1.2 GB -> ~68 MB for mt5-small):
  1. Vocabulary pruning: mT5 ships 250k word pieces for 100+ languages. We keep only pieces written
     in the scripts we need (plus digits / punctuation), and drop those rows from the
     embedding and output tables.
  2. int8 weights with one scale per row.

Only numpy is needed (no torch / transformers / sentencepiece).
"""
import argparse
import json
import os
import struct
import unicodedata

import numpy as np

SCRIPT_RANGES = {
    "deva": [(0x0900, 0x097F), (0xA8E0, 0xA8FF)],  # Hindi, Mundari, Ho (Devanagari)
    "olck": [(0x1C50, 0x1C7F)],  # Santhali (Ol Chiki)
    "wara": [(0x118A0, 0x118FF)],  # Ho (Warang Citi)
    "latn": [(0x0041, 0x005A), (0x0061, 0x007A), (0x00C0, 0x024F)],  # romanised text
}


# ---------------------------------------------------------------- sentencepiece model (protobuf)
def _varint(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        s += 7
        if x < 128:
            return r, i


def read_spiece(path):
    """Returns [(piece, score, type)] from a SentencePiece .model file (ModelProto field 1)."""
    b = open(path, "rb").read()
    pieces, i = [], 0
    while i < len(b):
        k, i = _varint(b, i)
        f, t = k >> 3, k & 7
        if t == 2:
            n, i = _varint(b, i)
            sub, i = b[i : i + n], i + n
            if f == 1:
                j, p, sc, ty = 0, "", 0.0, 1
                while j < len(sub):
                    k2, j = _varint(sub, j)
                    f2, t2 = k2 >> 3, k2 & 7
                    if t2 == 2:
                        n2, j = _varint(sub, j)
                        if f2 == 1:
                            p = sub[j : j + n2].decode("utf-8")
                        j += n2
                    elif t2 == 5:
                        if f2 == 2:
                            sc = struct.unpack("<f", sub[j : j + 4])[0]
                        j += 4
                    elif t2 == 0:
                        v, j = _varint(sub, j)
                        if f2 == 3:
                            ty = v
                    elif t2 == 1:
                        j += 8
                pieces.append((p, sc, ty))
        elif t == 0:
            _, i = _varint(b, i)
        elif t == 5:
            i += 4
        elif t == 1:
            i += 8
        else:
            raise ValueError("unexpected protobuf wire type %d" % t)
    return pieces


def make_keep(scripts):
    ranges = [r for s in scripts for r in SCRIPT_RANGES[s]]

    def ok_char(c):
        o = ord(c)
        if any(a <= o <= z for a, z in ranges):
            return True
        if c.isascii() and (c.isdigit() or not c.isalnum()):
            return True  # digits, ASCII punctuation
        if not c.isascii() and unicodedata.category(c)[0] in "PSZ":
            return True  # other punctuation / symbols (। ॥ “ ” …)
        return False

    def keep(i, piece, ty):
        if i < 3:  # <pad> </s> <unk>
            return True
        if ty not in (1, 4):  # NORMAL / USER_DEFINED only (drop byte / control pieces)
            return False
        return all(ok_char(c) for c in piece.replace("▁", ""))

    return keep


# ---------------------------------------------------------------- safetensors
def read_safetensors(path):
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        header = json.loads(f.read(n))
    mm = np.memmap(path, dtype=np.uint8, mode="r", offset=8 + n)
    dt = {"F32": np.float32, "F16": np.float16, "BF16": None}

    def get(k):
        h = header[k]
        a, z = h["data_offsets"]
        raw = mm[a:z]
        if h["dtype"] == "BF16":
            u = np.frombuffer(raw, dtype=np.uint16).astype(np.uint32) << 16
            return u.view(np.float32).reshape(h["shape"])
        return np.frombuffer(raw, dtype=dt[h["dtype"]]).astype(np.float32).reshape(h["shape"])

    return [k for k in header if k != "__metadata__"], get


def write_safetensors(path, tensors, meta):
    hdr, off, order = {}, 0, []
    for k in sorted(tensors):
        dtype, arr = tensors[k]
        b = np.ascontiguousarray(arr).tobytes()
        pad = (-off) % 8
        off += pad
        hdr[k] = {"dtype": dtype, "shape": list(arr.shape), "data_offsets": [off, off + len(b)]}
        order.append((pad, b))
        off += len(b)
    hdr["__metadata__"] = meta
    hb = json.dumps(hdr).encode()
    hb += b" " * ((-len(hb)) % 8)
    with open(path, "wb") as o:
        o.write(struct.pack("<Q", len(hb)))
        o.write(hb)
        for pad, b in order:
            o.write(b"\0" * pad)
            o.write(b)
    return off


def quantize_rows(w):
    scale = np.abs(w).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(w / scale[:, None]), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--scripts", default="deva", help="comma list of: " + ",".join(SCRIPT_RANGES))
    ap.add_argument("--name", default="", help="label stored in the file metadata")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    pieces = read_spiece(os.path.join(a.src, "spiece.model"))
    keep = make_keep(a.scripts.split(","))
    ids = [i for i, (p, s, t) in enumerate(pieces) if keep(i, p, t)]
    idx = np.array(ids)
    print("vocabulary: kept %d of %d pieces" % (len(ids), len(pieces)))

    names, get = read_safetensors(os.path.join(a.src, "model.safetensors"))
    cfg_in = json.load(open(os.path.join(a.src, "config.json")))
    tensors = {}
    for k in names:
        if k in ("encoder.embed_tokens.weight", "decoder.embed_tokens.weight"):
            continue  # duplicates of shared.weight
        w = get(k)
        if k in ("shared.weight", "lm_head.weight"):
            w = w[idx]
        if w.ndim == 2 and "relative_attention_bias" not in k:
            q, s = quantize_rows(w)
            tensors[k] = ("I8", q)
            tensors[k + ".scale"] = ("F32", s)
        else:
            tensors[k] = ("F32", w.astype(np.float32))
    if "lm_head.weight" not in names:  # tied checkpoints (original T5): lm_head = shared * d_model^-0.5
        w = get("shared.weight")[idx] * (cfg_in["d_model"] ** -0.5)
        q, s = quantize_rows(w)
        tensors["lm_head.weight"], tensors["lm_head.weight.scale"] = ("I8", q), ("F32", s)

    size = write_safetensors(
        os.path.join(a.out, "model.int8.safetensors"),
        tensors,
        {"format": "bhashasetu-int8-v1", "source": a.name or os.path.basename(os.path.abspath(a.src)), "quant": "per-row symmetric int8"},
    )
    json.dump({"pieces": [[pieces[i][0], pieces[i][1]] for i in ids], "unk": 2, "eos": 1, "pad": 0}, open(os.path.join(a.out, "vocab.json"), "w", encoding="utf-8"), ensure_ascii=False)
    keys = ["d_model", "d_kv", "d_ff", "num_heads", "num_layers", "num_decoder_layers", "relative_attention_num_buckets", "relative_attention_max_distance", "layer_norm_epsilon", "decoder_start_token_id", "eos_token_id", "pad_token_id"]
    cfg = {k: cfg_in.get(k) for k in keys}
    cfg["num_decoder_layers"] = cfg["num_decoder_layers"] or cfg["num_layers"]
    cfg["relative_attention_max_distance"] = cfg["relative_attention_max_distance"] or 128
    cfg.update(vocab_size=len(ids), source_vocab_size=cfg_in["vocab_size"], feed_forward_proj=cfg_in.get("feed_forward_proj"))
    json.dump(cfg, open(os.path.join(a.out, "config.json"), "w"), indent=2)
    print("wrote %s (%.1f MB)" % (a.out, size / 1e6))


if __name__ == "__main__":
    main()
