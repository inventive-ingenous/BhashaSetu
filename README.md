# BhashaSetu — classroom companion UI

Offline-first Hindi -> tribal-language classroom companion (Mundari now; Santhali and Ho next). React + Vite, no UI framework: plain CSS design tokens,
inline SVG illustrations and a fully original SVG character. Only runtime dependencies: react, react-dom, react-icons.

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # production build in dist/

The translation model needs a web server (it is loaded by a Web Worker), so use `npm run dev` or
`npm run preview` rather than opening `index.html` directly.

## Structure

    src/
      components/avatar/   AvatarCompanion + avatarConfig (the 9 expression states)
      components/scene/    ClassroomScene (SVG)
      components/          VoiceInteraction, TranslationPanel, ActionDock, OfflineStatus, QuickActions,
                           LessonCard, ResourceSection, ProgressIndicator, Sidebar, BottomNav, Header, Toaster...
      context/             AppContext (class, direction, prefs, toasts) + VoiceContext (phase + avatar state machine)
      services/engine.js   THE ONLY FILE TO CONNECT TO YOUR REAL BACKEND / ON-DEVICE MODELS
      pages/               Home, LiveClass, Learn, Assess, Progress, Resources, Settings, Lab
      styles/              tokens, layout, components, pages

## Character states

`<AvatarCompanion state="idle | listening | thinking | speaking | happy | encouraging | excited | success | confused" />`

Preview all of them at `#/lab`. Edit expressions/gestures in `components/avatar/avatarConfig.js`.
`VoiceContext` drives the state from the voice flow: idle -> listening -> thinking -> speaking -> result,
and `markResponse('correct' | 'incorrect' | 'unclear')` triggers happy / encouraging / confused.

## Translation (on-device)

Hindi -> Mundari runs fully offline in the browser: a fine-tuned mT5-small, shrunk to 68 MB
(vocabulary pruned to Devanagari + int8 weights), executed by a dependency-free JS runtime in a Web Worker.

    public/models/hi-mun/          model.int8.safetensors, vocab.json, config.json (served as static files)
    src/services/translator/       tokenizer.js (SentencePiece unigram), mt5.js (model), worker.js, client.js
    src/services/engine.js         the only file the UI talks to: translate(), preload(), nextUtterance(), speak()
    src/data/languages.js          language + model registry (Mundari ready; Santhali demo; Ho coming soon)
    tools/convert_mt5.py           converts a HuggingFace mT5 checkpoint (e.g. from Colab) - numpy only

Add a language: unzip the fine-tuned model from Colab (config.json, model.safetensors, spiece.model) anywhere
outside `public/`, then run `python tools/convert_mt5.py <that_folder> public/models/hi-ho --scripts deva`,
then add an entry to `MODELS` in `src/data/languages.js` and its words in `src/data/content.js`.
Languages without a model fall back to the sample phrases in `content.js`.
The first translation loads the model (then cached by the browser). Speech input is still simulated
(next step); use "Type instead" in the Live Class to translate any sentence.
Mundari/Santhali sample words are placeholders: have native speakers verify them.

## Speech recognition (offline)

    npm install
    npm run setup:whisper            # one time, needs internet: Whisper small (~250 MB)
    npm run setup:whisper -- --model base   # smaller/faster (~80 MB), less accurate Hindi

This downloads an ONNX Whisper model into `public/models/whisper-*/`, copies the ONNX Runtime
files into `public/ort/` and writes `public/models/asr.json`. After that the microphone works with
no internet: `src/services/speech/audio.js` records and detects when the teacher stops talking,
`whisper.worker.js` transcribes on-device. Without the model the app falls back to the browser's
online recognition (Chrome / Edge). Settings > Speech recognition shows which one is used
(Auto / Offline / Online).

The translation is spoken with an installed Hindi voice (`src/services/speech/tts.js`); Mundari is
read with the Hindi voice for now. For an offline Hindi voice on Windows:
Settings > Time & language > Speech > Add voices > Hindi (India).

## Fonts

Uses system fonts (Nirmala UI on Windows covers Devanagari and Ol Chiki). For Android / other devices,
bundle Noto Sans Devanagari and Noto Sans Ol Chiki (e.g. via @fontsource) so they work offline everywhere.

## Deploy (online prototype on Render)

The online build uses the browser's speech recognition and voice (Chrome / Edge) and the on-device
Mundari translation model. The offline Whisper files are git-ignored, so they are not deployed.

1. Push this folder to a GitHub repository (the 68 MB `public/models/hi-mun/model.int8.safetensors`
   is under GitHub's 100 MB file limit).
2. Render > New > Blueprint > select the repo (uses `render.yaml`), or New > Static Site with
   Build command `npm ci && npm run build` and Publish directory `dist`.
3. Open the `https://....onrender.com` link in Chrome or Edge and allow the microphone.

Check the production build locally first: `npm run build` then `npm run preview`
(locally `dist/` also contains the offline Whisper model if you installed it; Render's does not).

