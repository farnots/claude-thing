// Reading and driving the tmux pane a Claude Code session lives in.
//
// Why this exists: focus.js finds a session's window by walking up its process
// tree until it recognizes a terminal emulator. Inside tmux that walk goes
// `claude` → shell → the tmux *server* → launchd, and the emulator is nowhere
// on it — the client that draws the pane is a different process tree entirely.
// So a session in a pane looked windowless, and answering it never worked.
//
// tmux gives us something better than a window, though. `send-keys` writes into
// the pane's pty directly, so:
//   • no macOS Automation permission is involved — no TCC prompt, nothing to
//     deny, and no keystroke that can land in the wrong app,
//   • the frontmost window never moves; answering from the device is silent,
//   • it works on a detached session, where there is no window at all.
//
// And `capture-pane` reads back what the pane is actually showing, which is the
// only honest source for a dialog's option list — see parseDialogOptions.
//
// Everything here degrades to null/false when tmux is absent. The probe result
// is cached including the negative, so a machine without tmux pays for it once.

import { execFile } from 'node:child_process';
import { log } from './log.js';

// The daemon may be started by launchd with a minimal PATH, so `tmux` is looked
// for where it actually installs before falling back to a PATH lookup.
const CANDIDATES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];

// Named keys, as tmux spells them. Anything not in here is a literal character.
const KEY_NAMES = { return: 'Enter', tab: 'Tab', down: 'Down', up: 'Up', escape: 'Escape' };

// Pause between keys of a sequence, in ms. Same purpose as focus.js's KEY_GAP_S:
// the TUI has to redraw and advance to the next question before the next key
// arrives. Unlike the AppleScript path, splitting the sequence across calls is
// safe here — send-keys names its target, so nothing depends on what is in
// front between two of them.
const KEY_GAP_MS = 150;

// NOT unref'd, unlike the queue's expiry timers: this pause is part of a
// sequence in flight, and an unref'd one lets the process exit between two keys
// of the same answer — half a dialog answered.
export function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function run(bin, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: String(stderr || err.message).trim().split('\n')[0] });
      else resolve({ ok: true, out: String(stdout) });
    });
  });
}

// One line per pane, tab-separated, in the order listPanes asks for them.
export function parsePanes(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const [id, tty, inMode, label] = line.split('\t');
    if (!id || !tty) continue;
    out.push({ id, tty, inMode: inMode === '1', label: label || id });
  }
  return out;
}

// The keys a sequence turns into, as argv tails for `send-keys -t <pane>`.
// A literal goes through `-l --` so a digit is never read as a key name.
export function sendKeyArgs(key) {
  const named = KEY_NAMES[key];
  if (named) return [named];
  const ch = String(key);
  if (!ch) return null;
  return ['-l', '--', ch];
}

export function createTmux({ exec = run, gapMs = KEY_GAP_MS } = {}) {
  let bin;   // undefined = not probed yet, null = no tmux on this machine

  async function resolveBin() {
    if (bin !== undefined) return bin;
    const override = process.env.CLAUDE_THING_TMUX;
    const tries = override ? [override] : CANDIDATES;
    for (const path of tries) {
      const r = await exec(path, ['-V'], 2000);
      if (r.ok) { bin = path; log('TX', `tmux at ${path} (${String(r.out).trim()})`); return bin; }
    }
    if (!override) {
      const which = await exec('/usr/bin/which', ['tmux'], 2000);
      const found = which.ok && String(which.out).trim().split('\n')[0];
      if (found) {
        const r = await exec(found, ['-V'], 2000);
        if (r.ok) { bin = found; log('TX', `tmux at ${found} (${String(r.out).trim()})`); return bin; }
      }
    }
    bin = null;
    return bin;
  }

  async function tmux(args, timeout) {
    const path = await resolveBin();
    if (!path) return { ok: false, error: 'no tmux' };
    return exec(path, args, timeout);
  }

  // Every pane on every session of the default server. A server that is not
  // running is not an error — it is the same answer as no matching pane.
  async function listPanes() {
    const r = await tmux(['list-panes', '-a', '-F',
      '#{pane_id}\t#{pane_tty}\t#{pane_in_mode}\t#{session_name}:#{window_index}.#{pane_index}']);
    return r.ok ? parsePanes(r.out) : [];
  }

  // The pane a tty belongs to. ps reports a session's tty as the pane's own
  // pty, so this match is exact — no process-tree walking needed.
  async function paneForTty(tty) {
    if (!tty) return null;
    const want = String(tty);
    for (const pane of await listPanes()) {
      if (pane.tty === want) return pane;
    }
    return null;
  }

  // What the pane is showing right now: the visible screen, no escape
  // sequences. The dialog we want to read is always on the visible screen —
  // scrollback would only add older copies of it.
  async function capturePane(paneId) {
    const r = await tmux(['capture-pane', '-p', '-t', paneId]);
    return r.ok ? r.out : null;
  }

  // Makes the pane the visible one inside tmux. Best effort: the keys land in
  // the pane whether or not it is the active one, so a failure here is
  // cosmetic and must not fail the answer.
  async function selectPane(paneId) {
    await tmux(['select-window', '-t', paneId]);
    await tmux(['select-pane', '-t', paneId]);
  }

  async function sendKeys(paneId, keys) {
    for (let i = 0; i < keys.length; i++) {
      const args = sendKeyArgs(keys[i]);
      if (!args) return { sent: false, reason: 'nothing to send' };
      if (i) await sleep(gapMs);
      const r = await tmux(['send-keys', '-t', paneId, ...args]);
      if (!r.ok) return { sent: false, reason: r.error || 'send-keys failed' };
    }
    return { sent: true };
  }

  return { listPanes, paneForTty, capturePane, selectPane, sendKeys, available: resolveBin };
}

export const tmux = createTmux();
