// The reset clause is prose with no year and sometimes no zone. These cover the
// shapes `/usage` actually prints, the two ways a year can be inferred wrong,
// and the promise that anything unrecognised costs the countdown rather than
// inventing a date.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseResetAt } from '../src/usage-reset.js';

const NY = 'America/New_York';
// A fixed "now" for the dated cases: 19 Aug 2026, mid-afternoon in New York.
const NOW_NY = Date.parse('2026-08-19T15:20:00-04:00');

// The local-time cases build their expectation the same way the code does, so
// they hold in whatever zone the machine running the tests is set to.
const local = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi, 0, 0).getTime();

test('a dated clause in a stated zone resolves to that zone, not the Mac', () => {
  assert.equal(
    parseResetAt('Aug 19 at 9:09pm', NY, NOW_NY),
    Date.parse('2026-08-19T21:09:00-04:00')
  );
  // An hour with no minutes is real output, not a defensive case.
  assert.equal(
    parseResetAt('Aug 24 at 5pm', NY, NOW_NY),
    Date.parse('2026-08-24T17:00:00-04:00')
  );
  // The clause as stored on the limit, "resets " and all, is accepted too.
  assert.equal(
    parseResetAt('resets Aug 19 at 9:09pm', NY, NOW_NY),
    Date.parse('2026-08-19T21:09:00-04:00')
  );
});

test('with no zone printed — this machine\'s case — the clause is Mac local time', () => {
  assert.equal(
    parseResetAt('Aug 19 at 9:09pm', undefined, local(2026, 7, 19, 15, 20)),
    local(2026, 7, 19, 21, 9)
  );
  assert.equal(
    parseResetAt('Aug 19 at 12am', '', local(2026, 7, 18, 23, 0)),
    local(2026, 7, 19, 0, 0)
  );
  assert.equal(
    parseResetAt('Aug 19 at 12pm', '', local(2026, 7, 19, 9, 0)),
    local(2026, 7, 19, 12, 0)
  );
});

test('the missing year is taken from whichever side of it the clause sits', () => {
  // New Year's Eve: "Jan 1" is tomorrow, not eleven months ago.
  assert.equal(
    parseResetAt('Jan 1 at 2am', undefined, local(2026, 11, 31, 23, 0)),
    local(2027, 0, 1, 2, 0)
  );
  // And the mirror: read just after midnight, "Dec 31" is last night.
  assert.equal(
    parseResetAt('Dec 31 at 11:59pm', undefined, local(2027, 0, 1, 0, 30)),
    local(2026, 11, 31, 23, 59)
  );
});

test('a reset across the spring-forward boundary lands on the new offset', () => {
  // 2026-03-08 is when US clocks jump: 3am that morning is EDT (UTC-4), and a
  // single-pass offset probe would have read EST and answered an hour late.
  assert.equal(
    parseResetAt('Mar 8 at 3am', NY, Date.parse('2026-03-08T01:00:00-05:00')),
    Date.parse('2026-03-08T03:00:00-04:00')
  );
});

test('a bare time means the next time it comes round', () => {
  assert.equal(
    parseResetAt('9:09pm', undefined, local(2026, 7, 19, 15, 0)),
    local(2026, 7, 19, 21, 9)
  );
  assert.equal(
    parseResetAt('9:09pm', undefined, local(2026, 7, 19, 22, 0)),
    local(2026, 7, 20, 21, 9)
  );
  assert.equal(
    parseResetAt('tomorrow at 5pm', undefined, local(2026, 7, 19, 15, 0)),
    local(2026, 7, 20, 17, 0)
  );
});

test('an unresolvable clause costs the countdown and nothing else', () => {
  for (const clause of ['', null, undefined, 'soon', 'resets', 'when it feels like it',
    'Foo 4 at 5pm', 'Aug 40 at 5pm', 'Aug 4 at 13pm', 'Aug 4 at 5:75pm', 'Aug 4 at 25']) {
    assert.equal(parseResetAt(clause, NY, NOW_NY), 0, `${clause} must not resolve`);
  }
});

test('a zone name the runtime does not know falls back instead of throwing', () => {
  assert.equal(
    parseResetAt('Aug 19 at 9:09pm', 'Mars/Olympus_Mons', local(2026, 7, 19, 15, 0)),
    local(2026, 7, 19, 21, 9)
  );
});
