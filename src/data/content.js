// Static content for the BhashaSetu UI.
// Tribal-language text is keyed by language code (mun = Mundari, sat = Santhali, ho = Ho) - see data/languages.js.
// NOTE: the Mundari and Santhali words below are SAMPLE text used to demonstrate the UI.
// Have native speakers verify them. Live Class sentences are translated by the on-device model.

export const CLASSES = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'];

export { LANGUAGES as LANGS } from './languages';

/** Lesson sentences: the Hindi is what the teacher says; tribal-language fields are demo fallbacks
 *  for languages that have no model yet (the model result is used when one exists). */
export const SAMPLES = [
  {
    id: 'trees',
    hi: 'बच्चों, आज हम पेड़ के बारे में सीखेंगे।',
    sat: 'ᱦᱩᱰᱤᱧ ᱠᱚ, ᱧᱤᱫᱟᱹ ᱟᱞᱮ ᱫᱟᱨᱮ ᱵᱟᱵᱚᱛ ᱥᱤᱠᱷᱟᱣ ᱟ᱾',
    romanSat: 'Hudiñ kō, ñidā āle dare bābot sikhāw-a.',
    meaning: 'Children, today we will learn about trees.',
    explainHi: 'पेड़ हमें छाया, फल और साफ़ हवा देते हैं।',
  },
  {
    id: 'water',
    hi: 'पेड़ों को पानी की ज़रूरत होती है।',
    sat: 'ᱫᱟᱨᱮ ᱠᱚ ᱫᱟᱜ ᱨᱮᱭᱟᱜ ᱪᱮᱛ ᱦᱩᱭ ᱠᱟᱱᱟ᱾',
    romanSat: 'Dare kō dak reyāk cet huy kana.',
    meaning: 'Trees need water.',
    explainHi: 'पानी से पौधे बढ़ते हैं और हरे रहते हैं।',
  },
  {
    id: 'repeat',
    hi: 'अब सब मेरे साथ दोहराइए।',
    sat: 'ᱱᱤᱛᱚᱜ ᱥᱟᱱᱟᱢ ᱤᱧ ᱥᱟᱶᱛᱮ ᱫᱚᱦᱚᱨᱟᱣ ᱢᱮ᱾',
    romanSat: 'Nitog sanam iñ sāwte dohorāw me.',
    meaning: 'Now, everyone repeat with me.',
    explainHi: 'बच्चे शिक्षक के बाद एक-एक शब्द दोहराएँगे।',
  },
];

export const WORDS = [
  { id: 'tree', en: 'Tree', hi: 'पेड़', mun: 'दारु', sat: 'ᱫᱟᱨᱮ', roman: { mun: 'daru', sat: 'dare' } },
  { id: 'leaf', en: 'Leaf', hi: 'पत्ता', mun: 'सकम', sat: 'ᱥᱟᱠᱟᱢ', roman: { mun: 'sakam', sat: 'sakam' } },
  { id: 'flower', en: 'Flower', hi: 'फूल', mun: 'बा', sat: 'ᱵᱟᱦᱟ', roman: { mun: 'baa', sat: 'baha' } },
  { id: 'water', en: 'Water', hi: 'पानी', mun: 'दाः', sat: 'ᱫᱟᱜ', roman: { mun: "da'", sat: 'dak' } },
];

export const RHYME = {
  title: 'हरा-भरा पेड़',
  lines: [
    'पेड़ हरा, पत्ता हरा,',
    'फूल खिला, पानी भरा।',
    'आओ मिलकर गाएँ हम,',
    'पेड़ लगाएँ, बढ़ाएँ हम।',
  ],
  glossary: ['tree', 'leaf', 'flower', 'water'],
};

export const TODAY_LESSON = {
  title: 'Nature Around Us',
  meta: 'Grade 1 • Lesson 04',
  desc: 'Learn about trees, plants and our environment.',
};

export const NAV = [
  { key: '/', label: 'Home', icon: 'home' },
  { key: '/live', label: 'Live Class', icon: 'mic' },
  { key: '/learn', label: 'Learn', icon: 'book' },
  { key: '/assess', label: 'Assess', icon: 'assess' },
  { key: '/progress', label: 'Progress', icon: 'progress' },
  { key: '/resources', label: 'Resources', icon: 'folder' },
  { key: '/settings', label: 'Settings', icon: 'settings' },
];

export const RESOURCES = [
  { key: 'books', title: 'Bilingual Books', desc: 'Read • Listen • Learn', tone: 'orange', to: '/learn?mode=books' },
  { key: 'rhymes', title: 'Rhymes & Poems', desc: 'Fun with Language', tone: 'teal', to: '/learn?mode=rhymes' },
  { key: 'activities', title: 'Activities', desc: 'Games • Practice', tone: 'violet', to: '/learn?mode=activities' },
  { key: 'progress', title: 'Student Progress', desc: 'Track & Support', tone: 'amber', to: '/progress' },
];

export const DOWNLOADS = [
  { id: 'b1', group: 'Bilingual Books', title: 'पेड़ और हम', sub: 'Trees and Us • 12 pages', mb: 14 },
  { id: 'b2', group: 'Bilingual Books', title: 'मेरा गाँव', sub: 'My Village • 10 pages', mb: 11 },
  { id: 'r1', group: 'Rhymes & Poems', title: 'हरा-भरा पेड़', sub: 'Rhyme with audio', mb: 6 },
  { id: 'a1', group: 'Activities', title: 'Word Match: Nature', sub: 'Picture matching game', mb: 4 },
];

export const STUDENTS = [
  { name: 'Sita Murmu', score: 86 },
  { name: 'Ravi Soren', score: 74 },
  { name: 'Mangal Hembrom', score: 92 },
  { name: 'Puja Tudu', score: 68 },
  { name: 'Sunil Kisku', score: 79 },
  { name: 'Anita Besra', score: 88 },
];

export const ANSWER_SHEET = {
  student: 'Sita Murmu',
  questions: [
    { q: 'चित्र में क्या है? (पेड़)', expected: 'पेड़', answer: { mun: 'दारु', sat: 'ᱫᱟᱨᱮ' }, answerHi: 'पेड़' },
    { q: 'चित्र में क्या है? (पत्ता)', expected: 'पत्ता', answer: { mun: 'बा', sat: 'ᱵᱟᱦᱟ' }, answerHi: 'फूल' },
    { q: 'चित्र में क्या है? (पानी)', expected: 'पानी', answer: { mun: 'दाः', sat: 'ᱫᱟᱜ' }, answerHi: 'पानी' },
    { q: 'चित्र में क्या है? (फूल)', expected: 'फूल', answer: { mun: 'बा', sat: 'ᱵᱟᱦᱟ' }, answerHi: 'फूल' },
    { q: 'चित्र में क्या है? (पेड़)', expected: 'पेड़', answer: { mun: 'सकम', sat: 'ᱥᱟᱠᱟᱢ' }, answerHi: 'पत्ता' },
  ],
};
