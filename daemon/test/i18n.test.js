import { test } from 'node:test';
import assert from 'node:assert/strict';

import { t, catalogKeys } from '../src/i18n.js';

// The test that keeps the two catalogs from drifting. Without it a French entry
// nobody added shows up as English on a French screen and nothing fails.
test('the catalogs carry exactly the same keys', () => {
  assert.deepEqual(catalogKeys('fr'), catalogKeys('en'));
  assert.ok(catalogKeys('en').length > 0, 'a catalog with no keys would pass vacuously');
});

test('placeholders are filled, and an unknown one is left alone', () => {
  assert.equal(t('en', 'usage.week', { name: 'OPUS' }), 'WEEK · OPUS');
  assert.equal(t('fr', 'usage.week', { name: 'OPUS' }), 'SEMAINE · OPUS');
  assert.equal(t('fr', 'usage.week', {}), 'SEMAINE · {name}', 'a missing param is not the string "undefined"');
  assert.equal(t('fr', 'usage.session'), 'SESSION', 'no params needed, none demanded');
});

// A catalog that drifts degrades into the other language, never into a raw key
// on someone's screen.
test('an unknown language falls back to english', () => {
  assert.equal(t('de', 'usage.notRead'), t('en', 'usage.notRead'));
  assert.equal(t(undefined, 'usage.notRead'), t('en', 'usage.notRead'));
  assert.equal(t(null, 'usage.notRead'), t('en', 'usage.notRead'));
});

test('an unknown key is returned as itself rather than as empty text', () => {
  assert.equal(t('fr', 'nothing.here'), 'nothing.here');
});

// The device pulls the clock back out of this label by regex — see stamp() in
// device-app/src/screens/usage.js. A French label that dropped the HH:mm, or
// spelled it "14 h 05", would leave the usage screen with no time on it.
test('every language keeps a HH:mm the device can read back out', () => {
  for (const lang of ['en', 'fr']) {
    for (const key of ['usage.updated', 'usage.limits', 'usage.lastReading']) {
      const s = t(lang, key, { at: '14:05' });
      assert.match(s, /(\d{1,2}:\d{2})/, `${lang}/${key} lost its clock: ${s}`);
    }
  }
});
