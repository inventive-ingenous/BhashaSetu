/**
 * Language + model registry. To add a language (e.g. Ho):
 *   1. add it to LANGUAGES (script, font class, labels)
 *   2. convert its model:  python tools/convert_mt5.py <colab_model_dir> public/models/hi-ho
 *   3. add an entry to MODELS  ->  it shows up in the language picker and the engine uses it
 *   4. add its words to data/content.js (fields keyed by the language key)
 */
const BASE = import.meta.env?.BASE_URL ?? '/';

export const SOURCE = 'hi';

export const LANGUAGES = {
  // asr: speech-recognition language tag (null = cannot listen in this language yet)
  // tts: voice used to speak it (Mundari / Ho borrow a Hindi voice: same script, close pronunciation)
  hi: { key: 'hi', label: 'Hindi', native: 'हिन्दी', script: 'Devanagari', font: 'hi', asr: 'hi-IN', tts: 'hi-IN' },
  mun: { key: 'mun', label: 'Mundari', native: 'मुंडारी', script: 'Devanagari', font: 'hi', asr: null, tts: 'hi-IN' },
  sat: { key: 'sat', label: 'Santhali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', script: 'Ol Chiki', font: 'sat', asr: null, tts: null },
  ho: { key: 'ho', label: 'Ho', native: 'हो', script: 'Devanagari / Warang Citi', font: 'hi', asr: null, tts: 'hi-IN' },
};

/** Tribal languages the teacher can pick, in display order. */
export const TARGETS = ['mun', 'sat', 'ho'];
export const DEFAULT_TARGET = 'mun';

/**
 * On-device translation models, one per direction.
 * generation: decoding settings passed to the model (see services/translator/mt5.js).
 */
export const MODELS = {
  'hi-mun': {
    id: 'hi-mun',
    from: 'hi',
    to: 'mun',
    url: `${BASE}models/hi-mun/`,
    sizeMB: 68,
    base: 'mT5-small fine-tuned on ~17k Hindi–Mundari pairs',
    generation: { noRepeatNgramSize: 3, repetitionPenalty: 1.2 },
  },
  // 'hi-sat': { id: 'hi-sat', from: 'hi', to: 'sat', url: `${BASE}models/hi-sat/`, ... },
  // 'mun-hi': { id: 'mun-hi', from: 'mun', to: 'hi', url: `${BASE}models/mun-hi/`, ... },
};

export const modelFor = (from, to) => MODELS[`${from}-${to}`] || null;

/** 'ready' when a model exists for Hindi -> lang, otherwise 'planned'. */
export const languageStatus = (lang) => (modelFor(SOURCE, lang) ? 'ready' : 'planned');
