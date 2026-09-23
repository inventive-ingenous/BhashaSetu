/**
 * Microphone capture for offline speech recognition.
 *
 *   const rec = await startRecording({ onLevel })
 *   rec.stop()              // finish now
 *   rec.abort()             // discard
 *   const r = await rec.result   // { audio: Float32Array @ 16 kHz mono, speech: boolean, durationMs }
 *
 * A small energy-based voice detector ends the recording automatically when the speaker pauses,
 * and trims leading silence (Whisper works best on tight clips and hallucinates on silence).
 */

export const SAMPLE_RATE = 16000;

const fail = (code, message) => Object.assign(new Error(message || code), { code });

function resample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // average the source samples that fall into this output sample (cheap low-pass)
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let s = 0;
    for (let j = a; j < b; j++) s += input[j];
    out[i] = s / (b - a);
  }
  return out;
}

export async function startRecording({
  onLevel,
  silenceMs = 1200, // pause that ends the utterance
  minSpeechMs = 250, // need at least this much voiced audio
  noSpeechMs = 7000, // give up if nobody speaks
  maxMs = 25000, // Whisper handles 30 s windows; keep one utterance inside that
  preRollMs = 300,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw fail('audio-capture', 'This browser cannot access the microphone.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // noise suppression smears consonants (स/प/त) and hurts recognition, so it is off
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });
  } catch (e) {
    throw fail(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'not-allowed' : 'audio-capture', e?.message);
  }

  // Ask for 16 kHz directly (Chrome/Edge resample for us); fall back to the device rate.
  let ctx;
  let src;
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    src = ctx.createMediaStreamSource(stream);
  } catch {
    try {
      await ctx?.close();
    } catch {
      /* ignore */
    }
    ctx = new AudioContext();
    src = ctx.createMediaStreamSource(stream);
  }
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const rate = ctx.sampleRate;
  const proc = ctx.createScriptProcessor(2048, 1, 1);

  const chunks = [];
  let length = 0;
  let voicedMs = 0;
  let firstVoice = -1; // sample index where speech started
  let lastVoiceAt = 0; // ms timestamp of the last voiced chunk
  let noise = 0.004; // running noise-floor estimate
  const t0 = performance.now();
  let finished = false;
  let resolveResult;
  let rejectResult;
  const result = new Promise((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  const cleanup = () => {
    proc.onaudioprocess = null;
    try {
      src.disconnect();
      proc.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };

  const finish = (discard = false) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (discard) {
      rejectResult(fail('aborted'));
      return;
    }
    const all = new Float32Array(length);
    let o = 0;
    for (const c of chunks) {
      all.set(c, o);
      o += c.length;
    }
    const start = firstVoice < 0 ? 0 : Math.max(0, firstVoice - Math.round((preRollMs / 1000) * rate));
    const audio = resample(all.subarray(start), rate, SAMPLE_RATE);
    resolveResult({ audio, speech: voicedMs >= minSpeechMs, durationMs: Math.round((audio.length / SAMPLE_RATE) * 1000) });
  };

  proc.onaudioprocess = (e) => {
    if (finished) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const now = performance.now();
    const chunkMs = (data.length / rate) * 1000;
    const threshold = Math.max(0.012, noise * 3);
    const voiced = rms > threshold;
    if (voiced) {
      voicedMs += chunkMs;
      lastVoiceAt = now;
      if (firstVoice < 0) firstVoice = length;
    } else {
      noise = noise * 0.95 + rms * 0.05; // adapt to the room while nobody speaks
    }
    length += data.length;
    onLevel?.(Math.min(1, rms / 0.2), voiced);

    const elapsed = now - t0;
    if (voicedMs >= minSpeechMs && now - lastVoiceAt > silenceMs) finish();
    else if (voicedMs < minSpeechMs && elapsed > noSpeechMs) finish();
    else if (elapsed > maxMs) finish();
  };
  src.connect(proc);
  proc.connect(ctx.destination); // required for onaudioprocess to fire; the output stays silent

  return { stop: () => finish(false), abort: () => finish(true), result, sampleRate: rate };
}
