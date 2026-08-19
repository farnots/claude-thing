// The daemon's share of the interface text.
//
// Almost everything the device draws it draws from its own catalog. These
// strings are the exception: they are built where the data is — a reading parsed
// off `claude /usage`, an approve row read off a tmux screen — and shipped as
// finished text, so the device has nothing left to translate them from.
// Translating them here is the only thing keeping the usage screen and the plan
// cards from staying English inside a French interface.
//
// `lang` is a parameter, never module state. Every function in usage.js that
// formats a label is pure and tested as such; a module-level current language
// would make all of them depend on an invisible global and their tests would
// have to know about it. A default argument does not.
//
// What is deliberately NOT in here:
//   - `daemon/src/focus.js` reasons. The device matches them by English regex in
//     questionToast() to pick which toast to draw — they are error codes wearing
//     prose. Translating them would collapse every case into "COULD NOT ANSWER".
//   - Plan option *labels*. queue.js:matchOptionIndex matches the chosen label
//     against the live screen before typing, so a translated label answers
//     nothing. Only their descriptions, which are ours, are here.
//   - Anything `claude /usage` printed. A reset time like "Jul 30 at 5:19am" is
//     the CLI's output quoted back, not our copy, so a French label carries an
//     English timestamp inside it. Parsing and re-rendering it would mean owning
//     a date format the device has no clock for.

const CATALOG = {
  en: {
    'usage.session': 'SESSION',
    'usage.weekAll': 'WEEK · ALL MODELS',
    'usage.week': 'WEEK · {name}',
    'usage.resets': 'resets {at}',
    'usage.window': 'Last {win}',
    'usage.updated': 'updated {at} · from claude /usage',
    'usage.limits': 'limits {at} · from claude /usage',
    'usage.lastReading': 'last reading{at} · from claude /usage',
    'usage.notRead': 'usage not read yet',
    'usage.configMissing': 'config dir missing: {dir}',
    'usage.runFailed': 'claude /usage failed: {why}',
    'usage.noLimits': 'claude /usage printed no limits',
    'usage.parseFailed': 'could not parse /usage output',
    'usage.timedOut': 'timed out after {n}s',
    'usage.unknownError': 'unknown error',

    'plan.clearContext': 'approve the plan AND clear the conversation context',
    'plan.bypass': 'approve the plan and run without permission prompts',
    'plan.auto': 'approve the plan and let Claude edit and run without asking',
    'plan.acceptEdits': 'approve the plan and accept its edits without asking',
    'plan.manual': 'approve the plan and confirm each edit',
    'queue.question': 'QUESTION',
    'queue.plan': 'PLAN',
    'queue.readyToCode': 'Ready to code?',

    'permission.youAsked': 'you asked: {prompt}',
  },

  // Kept within the English character budget wherever the string lands in a
  // fixed-width slot on the device: `usage.resets` draws in .ureset under a bar,
  // which is why it is "réinit." and not "réinitialisation".
  fr: {
    'usage.session': 'SESSION',
    // Kept short deliberately: this label draws in a usage column beside the
    // percentage, and the literal "TOUS MODÈLES" wrapped it onto two lines.
    'usage.weekAll': 'SEMAINE · GLOBAL',
    'usage.week': 'SEMAINE · {name}',
    'usage.resets': 'réinit. {at}',
    'usage.window': 'Sur {win}',
    'usage.updated': 'mis à jour {at} · via claude /usage',
    'usage.limits': 'limites {at} · via claude /usage',
    'usage.lastReading': 'dernière lecture{at} · via claude /usage',
    'usage.notRead': 'consommation pas encore lue',
    'usage.configMissing': 'dossier de config absent : {dir}',
    'usage.runFailed': 'échec de claude /usage : {why}',
    'usage.noLimits': 'claude /usage n’affiche aucune limite',
    'usage.parseFailed': 'sortie de /usage illisible',
    'usage.timedOut': 'expiré après {n} s',
    'usage.unknownError': 'erreur inconnue',

    'plan.clearContext': 'valider le plan ET effacer le contexte de la conversation',
    'plan.bypass': 'valider le plan et exécuter sans demander de permission',
    'plan.auto': 'valider le plan et laisser Claude modifier et exécuter sans demander',
    'plan.acceptEdits': 'valider le plan et accepter ses modifications sans demander',
    'plan.manual': 'valider le plan et confirmer chaque modification',
    'queue.question': 'QUESTION',
    'queue.plan': 'PLAN',
    'queue.readyToCode': 'Prêt à coder ?',

    'permission.youAsked': 'vous avez demandé : {prompt}',
  },
};

// A missing French entry falls back to English rather than to the key: a catalog
// that drifts degrades into the other language, never into debug output on a
// user's screen. test/i18n.test.js asserts the two catalogs carry the same keys,
// so drifting is caught before it ships.
export function t(lang, key, params) {
  const table = CATALOG[lang] || CATALOG.en;
  const s = table[key] !== undefined ? table[key] : CATALOG.en[key];
  if (s === undefined) return key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
}

// Tests only: the key sets have to match, and nothing else needs the catalog.
export function catalogKeys(lang) {
  return Object.keys(CATALOG[lang] || {}).sort();
}
