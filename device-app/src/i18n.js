// Which language this device draws in.
//
// Shaped exactly like clock.js next door, and for the same reason: this is not
// something the device can work out. The Mac settles the user's "auto" setting
// against its own preference and stamps every snapshot with the answer, so the
// device only ever indexes a catalog — it never sees the rule. A daemon too old
// to send the field leaves us on English, which is what the app has always been.
//
// The catalogs are plain key → string maps. No library: the target is Chrome 69,
// where Intl.PluralRules does not exist, and the whole need here is a lookup, a
// {placeholder} substitution and a two-form plural.

import { en } from './locales/en.js';
import { fr } from './locales/fr.js';

var CATALOGS = { en: en, fr: fr };

// English 0 is plural ("0 options"), French 0 is singular ("0 option"). Two
// languages, two rules, written out rather than inferred.
var PLURAL = {
  en: function (n) { return n === 1 ? 'one' : 'other'; },
  fr: function (n) { return n > -2 && n < 2 ? 'one' : 'other'; },
};

var lang = 'en';

// Anything that is not a catalog we ship means English — same defence as
// setClock24's "anything that is not a true boolean". The daemon already
// resolves to a shipped language; this is what happens when it does not.
export function setLang(code) {
  lang = CATALOGS[code] ? code : 'en';
}

export function currentLang() {
  return lang;
}

// A missing entry falls back to English, then to the key. A catalog that drifts
// degrades into the other language; it never puts a dotted key on the screen.
export function t(key, params) {
  var table = CATALOGS[lang] || en;
  var s = table[key];
  if (s === undefined) s = en[key];
  if (s === undefined) return key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, function (m, k) {
    return params[k] === undefined ? m : String(params[k]);
  });
}

// The count decides the entry: `key.one` or `key.other`, and it is always also
// available to the string as {n}.
export function tn(key, n, params) {
  var pick = (PLURAL[lang] || PLURAL.en)(n);
  var merged = { n: n };
  if (params) for (var k in params) merged[k] = params[k];
  return t(key + '.' + pick, merged);
}

// Tests only: forget what the daemon taught.
export function resetI18n() {
  lang = 'en';
}
