/** User-facing messages for speech-recognition failures (shared by all backends). */
export const SPEECH_ERRORS = {
  'not-allowed': 'Microphone permission was denied. Allow the microphone for this site (lock icon in the address bar) and try again.',
  'service-not-allowed': 'Microphone permission was denied. Allow the microphone for this site and try again.',
  'audio-capture': 'No microphone was found. Connect a microphone and try again.',
  network: 'Online speech recognition needs internet. Install the offline model (npm run setup:whisper) or use "Type instead".',
  'no-speech': "I didn't hear anything. Tap the mic and speak a little louder.",
  'language-not-supported': 'This browser cannot recognise Hindi speech. Try Chrome or Edge.',
  unsupported: 'Speech recognition is not available here. Install the offline model (npm run setup:whisper), open BhashaSetu in Chrome or Edge, or use "Type instead".',
  'model-failed': 'The offline speech model could not be loaded. See Settings > Speech recognition.',
};

export const speechError = (code, fallback) => SPEECH_ERRORS[code] || fallback || `Speech recognition error: ${code}`;
