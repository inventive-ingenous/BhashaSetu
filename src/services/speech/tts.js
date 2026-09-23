/**
 * Text-to-speech through the browser (speechSynthesis), with explicit voice choice.
 *
 * There is no Mundari / Ho voice in any browser yet, so those languages are read with a Hindi voice
 * (same Devanagari script - pronunciation is close, not native). A Piper voice can replace this later.
 *
 * Windows: Edge ships "Microsoft Swara/Madhur (Hindi)" voices; Chrome has "Google हिन्दी" (online).
 * For an offline Hindi voice on Windows install the Hindi speech pack:
 *   Settings > Time & language > Speech > Add voices > Hindi (India).
 */

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voices = [];
let current = null;
let lastError = null; // why the last speak() failed // keep a reference: Chrome drops events for garbage-collected utterances

function refresh() {
  try {
    voices = synth?.getVoices() || [];
  } catch {
    voices = [];
  }
}
refresh();
if (synth && 'onvoiceschanged' in synth) synth.addEventListener?.('voiceschanged', refresh);

const base = (l) => (l || '').toLowerCase().replace('_', '-').split('-')[0];

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** All voices for a language, with whether they work without internet. */
export function listVoices(lang) {
  if (!voices.length) refresh();
  return voices.filter((v) => base(v.lang) === base(lang)).map((v) => ({ name: v.name, lang: v.lang, offline: Boolean(v.localService) }));
}

/**
 * Best voice for a BCP-47 tag. Voices that run on this device (localService) are preferred;
 * online-only voices (e.g. Chrome's "Google हिन्दी", Edge's "Online (Natural)") are skipped when offline.
 */
export function pickVoice(lang) {
  if (!voices.length) refresh();
  const want = (lang || '').toLowerCase();
  const same = voices.filter((v) => base(v.lang) === base(want) && (v.localService || online()));
  if (!same.length) return null;
  const score = (v) => (v.lang.toLowerCase().replace('_', '-') === want ? 1 : 0) + (v.localService ? 2 : 0);
  return same.sort((a, b) => score(b) - score(a))[0];
}

export const tts = {
  supported: Boolean(synth),

  hasVoice(lang) {
    return Boolean(pickVoice(lang));
  },

  voiceName(lang) {
    return pickVoice(lang)?.name || null;
  },

  /** 'offline' (installed on this device) | 'online' (needs internet) | 'none' */
  voiceKind(lang) {
    const all = listVoices(lang);
    if (all.some((v) => v.offline)) return 'offline';
    return all.length ? 'online' : 'none';
  },

  /**
   * Speak text. Resolves true when speech finished, false if it could not play.
   * onStart fires when audio actually begins (useful to sync animations).
   */
  speak(text, { lang = 'hi-IN', rate = 1, onStart } = {}) {
    return new Promise((resolve) => {
      lastError = null;
      if (!synth || !text) {
        lastError = synth ? 'empty text' : 'speechSynthesis not supported';
        return resolve(false);
      }
      const voice = pickVoice(lang);
      if (!voice && voices.length) {
        lastError = `no usable ${lang} voice (${voices.length} voices installed)`;
        return resolve(false);
      } // voices are known and none speaks this language
      try {
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = voice?.lang || lang;
        if (voice) u.voice = voice;
        u.rate = rate;
        u.onstart = () => onStart?.();
        u.onend = () => resolve(true);
        u.onerror = (e) => {
          const benign = e.error === 'interrupted' || e.error === 'canceled';
          if (!benign) lastError = `speech error: ${e.error}`;
          resolve(benign);
        };
        current = u;
        synth.speak(u);
        if (synth.paused) synth.resume(); // Chrome sometimes starts paused
      } catch (e) {
        lastError = String(e?.message || e);
        resolve(false);
      }
    });
  },

  lastError: () => lastError,
  allVoices: () => {
    if (!voices.length) refresh();
    return voices.map((v) => ({ name: v.name, lang: v.lang, offline: Boolean(v.localService) }));
  },

  stop() {
    try {
      synth?.cancel();
    } catch {
      /* ignore */
    }
    current = null;
  },
};
