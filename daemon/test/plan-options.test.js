// Reading a dialog's options off a captured pane.
//
// The fixtures in test/fixtures are `tmux capture-pane -p` output. Three are
// verbatim captures from a real Claude Code 2.1.235 session in a 96-column pane:
// the plan dialog, the trust-this-folder prompt, and a permission prompt whose
// second row wraps. The other two keep that captured frame and swap the option
// block for rows this account cannot produce — the clear-context and bypass
// variants, whose labels come out of the CLI binary's own dialog builder, and a
// pane too short to show the whole list.
//
// This is the part of the feature that has to be right: the answer is keyed by
// position, so a misread list types the wrong choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDialogOptions, planOptionsFrom, matchOptionIndex } from '../src/queue.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pane = (name) => fs.readFileSync(path.join(FIXTURES, `${name}.txt`), 'utf8');

test('the real plan dialog reads as its three rows', () => {
  assert.deepEqual(parseDialogOptions(pane('pane-plan-dialog')), [
    { index: 0, label: 'Yes, auto-accept edits' },
    { index: 1, label: 'Yes, manually approve edits' },
    { index: 2, label: 'Tell Claude what to change shift+tab to approve with this feedback' },
  ]);
});

test('prose above the dialog does not join the list', () => {
  // The screen holds the whole conversation, and a plan is full of numbered
  // steps. Only the last run counting from 1 is the dialog.
  const screen = [
    '  1. lire le pane',
    '  2. taper la touche',
    '',
    '   ❯ 1. Yes, auto-accept edits',
    '     2. Yes, manually approve edits',
  ].join('\n');
  assert.deepEqual(parseDialogOptions(screen).map((r) => r.label), [
    'Yes, auto-accept edits',
    'Yes, manually approve edits',
  ]);
});

test('a numbered list that is not a dialog reads as none', () => {
  assert.equal(parseDialogOptions('rien de coché ici\n  1. juste une liste'), null);
  assert.equal(parseDialogOptions(''), null);
  assert.equal(parseDialogOptions(null), null);
});

test('a wrapped label is joined, a hint line under it is not', () => {
  const rows = parseDialogOptions(pane('pane-permission-wrapped'));
  assert.equal(rows[1].label,
    'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)');
  assert.equal(rows[2].label, 'No');
});

test('a list whose first row scrolled off is refused, not renumbered', () => {
  // Trusting it would key every answer one row short of where it belongs.
  assert.equal(parseDialogOptions(pane('pane-plan-scrolled')), null);
});

test('plan options keep the approve rows and drop the decline paths', () => {
  assert.deepEqual(planOptionsFrom(parseDialogOptions(pane('pane-plan-dialog'))).map((o) => o.label), [
    'Yes, auto-accept edits',
    'Yes, manually approve edits',
  ]);
});

test('the clear-context row keeps its index and says what it costs', () => {
  const options = planOptionsFrom(parseDialogOptions(pane('pane-plan-clear-context')));
  assert.deepEqual(options.map((o) => o.label), [
    'Yes, clear context (14% used) and bypass permissions',
    'Yes, and switch to bypass permissions for this session',
    'Yes, manually approve edits',
  ]);
  // The whole point of reading the screen: index 0 is not "approve", it wipes
  // the conversation, and the card has to say so.
  assert.match(options[0].description, /clear the conversation context/);
});

test('a dialog that is not the plan one is refused', () => {
  // The trust-this-folder prompt is also a numbered list of "Yes…" rows.
  const rows = parseDialogOptions(pane('pane-trust-dialog'));
  assert.deepEqual(rows.map((r) => r.label), ['Yes, I trust this folder', 'No, exit']);
  assert.equal(planOptionsFrom(rows), null);
  assert.equal(planOptionsFrom(parseDialogOptions(pane('pane-permission-wrapped'))), null);
});

test('a chosen label is found where it really sits', () => {
  const rows = parseDialogOptions(pane('pane-plan-clear-context'));
  assert.equal(matchOptionIndex(rows, 'Yes, manually approve edits'), 2);
  assert.equal(matchOptionIndex(rows, 'Yes, and switch to bypass permissions for this session'), 1);
});

test('a label the screen does not carry matches nothing', () => {
  // The label the daemon used to hardcode. Never on any screen.
  const rows = parseDialogOptions(pane('pane-plan-dialog'));
  assert.equal(matchOptionIndex(rows, 'Yes, bypass permissions'), -1);
  assert.equal(matchOptionIndex(rows, ''), -1);
});

test('truncation on either side still matches', () => {
  const rows = parseDialogOptions(pane('pane-plan-clear-context'));
  // The device truncates a label to 60 characters before it ever comes back.
  assert.equal(matchOptionIndex(rows, 'Yes, and switch to bypass permissions for this sessio'), 1);
  // The terminal truncates to the pane width and marks it with an ellipsis.
  assert.equal(matchOptionIndex([{ index: 0, label: 'Yes, clear context (14% used) and by…' }],
    'Yes, clear context (14% used) and bypass permissions'), 0);
});
