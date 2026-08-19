// The catalog, and the two things about it that can silently rot: a French entry
// nobody added, and a French label that breaks something built out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { t, tn, setLang, currentLang, resetI18n } from '../src/i18n.js';
import { en } from '../src/locales/en.js';
import { fr } from '../src/locales/fr.js';
import { fmtDuration, stateLabel, modeLabel, effortLabel } from '../src/screens/helpers.js';
import { renderList } from '../src/screens/session-list.js';
import { renderQueue } from '../src/screens/queue.js';
import { renderAmbient } from '../src/screens/ambient.js';
import { renderBluetooth } from '../src/screens/bluetooth.js';

function baseState(over = {}) {
  return {
    sessions: [], stats: { active: 0, attention: 0 }, details: {}, asks: [],
    usage: null, daemonConnected: true, selectedIndex: 0, queueIndex: 0,
    queueAnswering: false, queueChoice: 0, queueQIndex: 0, queueAnswers: [],
    queueReview: false, btDevices: [], btDiscoverable: false, btIndex: 0,
    btMenu: null, btMenuIndex: 0, btBusy: null, btPairing: null, usageCol: 0, ...over,
  };
}

// Without this a key added to one catalog and not the other shows up as English
// on a French screen, and nothing anywhere fails.
test('the two catalogs carry exactly the same keys', () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.ok(Object.keys(en).length > 100, 'a near-empty catalog would pass vacuously');
});

// Every key the code reaches through a computed name — t('state.' + token) and
// friends. These are the ones a rename cannot be caught doing.
test('every token the helpers return has an entry', () => {
  const states = ['idle', 'busy', 'attention', 'celebrate'];
  for (const s of states) {
    for (const ended of [false, true]) {
      const key = 'state.' + stateLabel(s, ended);
      assert.ok(key in en, `${key} is missing`);
    }
  }
  for (const mode of ['plan', 'bypassPermissions', 'acceptEdits', 'auto', 'default']) {
    assert.ok('mode.' + modeLabel(mode) in en, `mode.${modeLabel(mode)} is missing`);
  }
  for (const e of ['low', 'medium', 'high', 'xhigh', 'max', 'ultrathink']) {
    assert.ok('effort.' + effortLabel(e) in en, `effort.${effortLabel(e)} is missing`);
  }
  for (const a of ['CONNECT', 'DISCONNECT', 'FORGET', 'CANCEL']) {
    assert.ok('bt.' + a in en, `bt.${a} is missing`);
  }
});

test('placeholders are filled, and an unfilled one is left visible', () => {
  resetI18n();
  assert.equal(t('list.finishedAgo', { d: '5m' }), 'finished 5m ago');
  setLang('fr');
  assert.equal(t('list.finishedAgo', { d: '5 min' }), 'terminé il y a 5 min');
  assert.equal(t('list.finishedAgo', {}), 'terminé il y a {d}', 'not the string "undefined"');
  resetI18n();
});

// English 0 is plural, French 0 is singular. One rule would have been wrong in
// one of the two languages.
test('the plural form follows the language, not the number alone', () => {
  resetI18n();
  assert.equal(tn('queue.optionsHint', 1), '1 option · press dial');
  assert.equal(tn('queue.optionsHint', 0), '0 options · press dial');
  assert.equal(tn('queue.optionsHint', 3), '3 options · press dial');

  setLang('fr');
  assert.equal(tn('queue.optionsHint', 1), '1 option · appuyez');
  assert.equal(tn('queue.optionsHint', 0), '0 option · appuyez', 'zero is singular in French');
  assert.equal(tn('queue.optionsHint', 3), '3 options · appuyez');
  resetI18n();
});

test('an unknown language is english, and an unknown key is itself', () => {
  setLang('de');
  assert.equal(currentLang(), 'en', 'a catalog we do not ship is not a language');
  assert.equal(t('queue.done'), 'DONE');
  assert.equal(t('nothing.here'), 'nothing.here');
  resetI18n();
});

// The whole reason the helpers return tokens: these class names are built by
// lower-casing them, and styles.css only knows the ASCII ones.
test('french labels never reach a class name', () => {
  setLang('fr');
  const html = renderList(baseState({
    sessions: [{
      id: 'a', name: 'proj', state: 'busy', ended: false, effort: 'high',
      permissionMode: 'plan', tokens: { in: 1, out: 2 }, context: 0.5,
      lastActivityTs: null, pendingPermission: false,
    }],
  }));
  assert.match(html, /class="mode m-plan"/, 'the mode class is built from the token');
  assert.match(html, /\be-high\b/, 'the effort class is built from the token');
  assert.match(html, /ÉDITION|PLAN/, 'and the drawn word came from the catalog');
  assert.ok(!/m-planification|e-haut/.test(html), 'a translated token leaked into a class');
  resetI18n();
});

test('the screens draw french when the snapshot says french', () => {
  setLang('fr');
  assert.match(renderList(baseState()), /AUCUNE SESSION/);
  assert.match(renderQueue(baseState()), /RIEN NE VOUS ATTEND/);
  assert.match(renderAmbient(baseState()), /RIEN EN ATTENTE/);
  assert.match(renderBluetooth(baseState()), /AUCUN APPAREIL APPAIRÉ/);
  assert.match(renderBluetooth(baseState()), /MODE APPAIRAGE/);
  resetI18n();
  assert.match(renderList(baseState()), /NO SESSIONS/, 'and english again on reset');
});

// French writes "35 min" and "1 h 35", not "35m" and "1h 35m" — the unit is part
// of the catalog entry, not a suffix glued on after the number.
test('durations are assembled per language', () => {
  resetI18n();
  assert.equal(fmtDuration(30 * 60_000), '30m');
  assert.equal(fmtDuration(95 * 60_000), '1h 35m');
  setLang('fr');
  assert.equal(fmtDuration(30 * 60_000), '30 min');
  assert.equal(fmtDuration(95 * 60_000), '1 h 35');
  resetI18n();
});

// One accented capital from each catalog family, because a translation that lost
// its accents is the failure mode nobody notices in review.
test('french capitals keep their accents', () => {
  setLang('fr');
  for (const key of ['state.ENDED', 'queue.timedOutOpen', 'usage.moodOut', 'toast.failed']) {
    assert.match(t(key), /[ÀÂÇÉÈÊËÎÏÔÙÛÜŒ]/, `${key} lost its accents: ${t(key)}`);
  }
  resetI18n();
});
