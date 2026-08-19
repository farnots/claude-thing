// The Bluetooth relay cannot split a synchronous response across its 2000-byte
// chunks, so a claude.sessions.list response at BT_SAFE_SESSION_LIMIT must fit
// one chunk with headroom. Measured against JSON, which is a pessimistic proxy
// for the MsgPack actually on the wire (MsgPack drops the quotes and colons of
// this string-keyed shape), so passing the JSON budget guarantees the MsgPack
// one. Budget 1800 of the 2000 cap, leaving slack for fields this test didn't
// foresee growing by a few characters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/sessions/store.js';
import { BT_SAFE_SESSION_LIMIT } from '../src/config.js';

const BUDGET_BYTES = 1800;

test(`a ${BT_SAFE_SESSION_LIMIT}-session worst-case list response fits the BT chunk budget`, () => {
  const store = createStore();
  for (let i = 0; i < BT_SAFE_SESSION_LIMIT; i++) {
    store.touch(`f47ac10b-58cc-4372-a567-0e02b2c3d4${String(i).padStart(2, '0')}`, {
      name: 'x'.repeat(32),                          // summary() caps at 32
      model: 'us.anthropic.claude-opus-4-1-20250805-v1:0', // longest realistic id
      contextTokens: 999_999,                        // long context fraction float
      tokensIn: 999_999_999,
      tokensOut: 999_999_999,
      pendingPermission: true,
      permissionMode: 'bypassPermissions',           // longest mode string
      effort: 'ultrathink',                          // longest effort string
    });
  }

  const envelope = {
    type: 'response',
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    result: store.snapshot(BT_SAFE_SESSION_LIMIT),
  };
  const bytes = Buffer.byteLength(JSON.stringify(envelope));
  assert.ok(
    bytes < BUDGET_BYTES,
    `response is ${bytes} bytes; over the ${BUDGET_BYTES}-byte budget — ` +
    'either lower BT_SAFE_SESSION_LIMIT or shrink SessionSummary'
  );
});

// ---- usage ------------------------------------------------------------------
//
// Same constraint, same budget: claude.usage.get answers synchronously, so its
// result must fit one chunk. Two accounts do not fit alongside the flat mirror,
// which is why the array is opt-in (`accounts:1`) and why relay roles are capped
// at BT_SAFE_USAGE_ACCOUNTS with the remainder arriving on the event.

import { parseUsage, slimUsage, multiUsage } from '../src/usage.js';
import { BT_SAFE_USAGE_ACCOUNTS } from '../src/config.js';

// The fattest reading `claude -p /usage` can realistically print: three limits
// with the longest labels the parser produces, reset clauses on all of them, and
// a window carrying three skills and three subagents with long names.
const WORST_TEXT = [
  'You are currently using your subscription to power your Claude Code usage',
  'Current session: 47% used · resets Aug 24 at 11:59pm (America/Argentina/ComodRivadavia)',
  'Current week (all models): 62% used · resets Aug 24 at 11:59pm (America/Argentina/ComodRivadavia)',
  'Current week (claude-opus-4-1-20250805): 88% used · resets Aug 24 at 11:59pm (America/Argentina/ComodRivadavia)',
  'Last 24h · 999,999 requests · 999,999 sessions',
  '  Top skills: /webapp-testing-and-verification 48%, /frontend-design-system 31%, /deploy-to-dev-emulator 12%',
  '  Top subagents: general-purpose-explorer 48%, migration-kit:module-migrator 31%, pr-review-toolkit:reviewer 12%',
].join('\n');

// An account that failed carries a 120-char error (the cap in usage.js) on top of
// its last known figures — the worst of both, which is what a real degraded
// account looks like.
function worstAccount(i) {
  const u = parseUsage(WORST_TEXT, 1_787_146_492_760);
  return {
    account: { id: `account-name-${i}`.slice(0, 16), label: 'WWWWWWWWWWWW', configDir: null, enabled: true },
    reading: { ...u, stale: true, error: 'x'.repeat(120) },
  };
}

function envelope(result) {
  return Buffer.byteLength(JSON.stringify({
    type: 'response', id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', result,
  }));
}

function worstState(n) {
  const built = Array.from({ length: n }, (_, i) => worstAccount(i));
  return {
    accounts: built.map((b) => b.account),
    states: new Map(built.map((b) => [b.account.id, b.reading])),
  };
}

test(`a ${BT_SAFE_USAGE_ACCOUNTS}-account usage response fits the BT chunk budget`, () => {
  const { accounts, states } = worstState(BT_SAFE_USAGE_ACCOUNTS);
  const result = multiUsage(accounts, states, { cap: BT_SAFE_USAGE_ACCOUNTS, withMirror: false });
  assert.equal(result.accounts.length, BT_SAFE_USAGE_ACCOUNTS);
  const bytes = envelope(result);
  assert.ok(
    bytes < BUDGET_BYTES,
    `response is ${bytes} bytes; over the ${BUDGET_BYTES}-byte budget — ` +
    'either lower BT_SAFE_USAGE_ACCOUNTS or shrink UsageAccount'
  );
});

test('the cap is the largest number of accounts that still fits', () => {
  // Guards the constant against drifting away from the measurement that set it:
  // one more account than the cap must genuinely not fit, or the cap is costing
  // the device a round trip for nothing.
  const { accounts, states } = worstState(BT_SAFE_USAGE_ACCOUNTS + 1);
  const over = multiUsage(accounts, states, { withMirror: false });
  assert.ok(
    envelope(over) >= BUDGET_BYTES,
    `${BT_SAFE_USAGE_ACCOUNTS + 1} accounts fit in ${envelope(over)} bytes — raise BT_SAFE_USAGE_ACCOUNTS`
  );
});

test('the default response keeps the pre-accounts shape, and its size', () => {
  // What a device app that predates accounts asks for, and still gets: the flat
  // mirror. Both halves of the promise are asserted here — that it fits, and
  // that limits/windows are still at the root where renderUsage reads them.
  const { accounts, states } = worstState(BT_SAFE_USAGE_ACCOUNTS);
  const result = multiUsage(accounts, states, { withAccounts: false });
  assert.ok(Array.isArray(result.limits) && result.limits.length, 'limits stay at the root');
  assert.ok(Array.isArray(result.windows), 'and so do the windows');
  assert.equal(result.accounts, undefined, 'the array is opt-in, never volunteered');
  const bytes = envelope(result);
  assert.ok(bytes < BUDGET_BYTES, `mirror-only response is ${bytes} bytes`);
});

test('the event carries mirror and accounts together, and is allowed to be big', () => {
  // Events chunk, so this one is not budgeted — the test states the shape the
  // device and the relay rely on, and that it stays a single complete snapshot.
  const { accounts, states } = worstState(4);
  const event = multiUsage(accounts, states);
  assert.equal(event.accounts.length, 4, 'every account, every time');
  assert.equal(event.accountCount, 4);
  assert.ok(event.limits, 'mirror included, for clients that only read the root');
  assert.equal(event.accountId, accounts[0].id);
});
