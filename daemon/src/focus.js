// Point the keyboard at a session's terminal, as if the user had clicked it.
//
// Two routes, and tmux is the good one:
//
//   • tmux — session_id → registry → pid → tty → the pane with that pane_tty.
//     Keys go in with `send-keys`, which writes to the pane's pty: no macOS
//     Automation permission, no window brought forward, and it works on a
//     detached session. See tmux.js.
//
//   • no tmux — session_id → pid → tty → Terminal.app tab. Terminal.app is the
//     only mainstream emulator that exposes `tty` on its tabs, so other
//     emulators fall back to raising the app and the human presses the key.
//
// Permissions, on that second route only: raising Terminal needs Automation →
// Terminal. Typing a keystroke additionally needs Automation → System Events,
// which macOS may deny. When it is denied we say so and stop — the window is
// focused, and the user finishes on the keyboard. We never try to work around a
// denied permission.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { CLAUDE_DIR } from './config.js';
import { tmux as realTmux } from './tmux.js';
import { log } from './log.js';

const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');

// Pause between keys of a typed sequence, in seconds. Long enough for Claude
// Code's dialog to advance to the next question before the next key lands.
const KEY_GAP_S = 0.15;

// The non-printing keys a question dialog needs, as System Events key codes.
const KEY_CODES = { return: 36, tab: 48, down: 125 };

function osa(script, timeout = 5000) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout }, (err, stdout, stderr) => {
      const text = String(stderr || '');
      if (err) {
        const denied = text.includes('-1743') || text.includes('Not authorized');
        resolve({ ok: false, denied, error: text.trim().split('\n')[0] || err.message });
      } else {
        resolve({ ok: true, out: String(stdout).trim() });
      }
    });
  });
}

function ps(args) {
  return new Promise((resolve) => {
    execFile('ps', args, { timeout: 4000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout).trim());
    });
  });
}

function readRegistry(dir = SESSIONS_DIR) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
    } catch {}
  }
  return out;
}

// session_id -> {pid, cwd, kind, name} from Claude Code's own registry
export function lookupSession(sessionId, dir = SESSIONS_DIR) {
  for (const rec of readRegistry(dir)) {
    if (rec.sessionId === sessionId) return rec;
  }
  return null;
}

// A background job is not always windowless. When an interactive session hands
// its turn to one it writes `parkedJobId` into its own registry file, and while
// parked that window *is* the job's UI — the question the device is answering is
// on screen there. So before declaring a background agent unfocusable, look for
// the window parked on it and raise that instead.
//
// The job id is the short form of the background session's id, carried as
// `jobId`; older records only have the sessionId, hence the prefix match.
export function hostWindowFor(rec, dir = SESSIONS_DIR) {
  if (!rec) return null;
  const jobId = String(rec.jobId || '');
  const sid = String(rec.sessionId || '');
  if (!jobId && !sid) return null;
  for (const other of readRegistry(dir)) {
    if (other.kind !== 'interactive' || !other.parkedJobId) continue;
    const parked = String(other.parkedJobId);
    if (parked === jobId || parked === sid || (parked && sid.startsWith(parked))) return other;
  }
  return null;
}

async function ttyFor(pid) {
  const out = await ps(['-o', 'tty=', '-p', String(pid)]);
  const t = out.trim();
  if (!t || t === '??') return null;
  return t.startsWith('/dev/') ? t : `/dev/${t}`;
}

// walk up the process tree to whichever app owns the terminal
async function ownerApp(pid) {
  let current = pid;
  for (let i = 0; i < 8; i++) {
    const out = await ps(['-o', 'ppid=,comm=', '-p', String(current)]);
    if (!out) return null;
    const [ppidStr, ...commParts] = out.trim().split(/\s+/);
    const comm = commParts.join(' ');
    if (/Terminal\.app/.test(comm)) return 'Terminal';
    if (/iTerm/.test(comm)) return 'iTerm2';
    if (/Ghostty/.test(comm)) return 'Ghostty';
    if (/WezTerm/.test(comm)) return 'WezTerm';
    if (/Code Helper|Visual Studio Code/.test(comm)) return 'Code';
    const ppid = Number(ppidStr);
    if (!ppid || ppid <= 1) return null;
    current = ppid;
  }
  return null;
}

const TERMINAL_RAISE = (tty) => `
tell application "Terminal"
  set matched to false
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${tty}" then
        set selected of t to true
        set frontmost of w to true
        set matched to true
      end if
    end repeat
  end repeat
  if matched then activate
  return matched
end tell`;

// The seams exist so the routing above can be tested without a Mac in the loop:
// which route a session takes, and — the part that used to be a bug — that the
// non-tmux route never talks to Terminal unless it is really Terminal. Every one
// of them defaults to the real thing, so index.js calls createFocus() bare.
export function createFocus({
  tmux = realTmux,
  sessionsDir = SESSIONS_DIR,
  ttyFor: ttyOf = ttyFor,
  ownerApp: appOf = ownerApp,
  osa: osascript = osa,
} = {}) {
  let automationDenied = false;   // sticky: a denied TCC row never re-prompts

  // There is one keyboard and one frontmost window, so there can be one of
  // these at a time. Nothing else enforces it: the hub handles every socket
  // frame in its own task, so two answers arriving close together used to run
  // their focus-then-type concurrently and interleave keystrokes into whatever
  // window happened to be in front — digits meant for one session landing in
  // another's terminal.
  //
  // Anything that raises a window or types must run inside this, and a
  // focus-then-type pair must be ONE call to it: a bare focus slipping between
  // the two halves is the same bug.
  let chain = Promise.resolve();
  function exclusive(fn) {
    const run = chain.then(() => fn());
    // The chain must survive a failed turn, so it tracks completion, not result.
    chain = run.then(() => {}, () => {});
    return run;
  }

  // Which process's terminal a session is answered through, and the tty it is
  // on. A background job borrows the window that parked on it, if one did —
  // focusSession and paneForSession must agree on that, hence one place for it.
  async function targetFor(sessionId) {
    const rec = lookupSession(sessionId, sessionsDir);
    if (!rec) return { reason: 'no session registry entry' };

    let target = rec;
    let viaHost = false;
    if (rec.kind && rec.kind !== 'interactive') {
      const host = hostWindowFor(rec, sessionsDir);
      if (!host) return { reason: 'background agent — no window to focus' };
      target = host;
      viaHost = true;
    }

    const tty = await ttyOf(target.pid);
    if (!tty) {
      return { reason: viaHost ? 'background agent — parked window is gone' : 'session has no tty' };
    }
    return { target, viaHost, tty };
  }

  // The tmux pane a session is in, or null. Exposed because the question queue
  // reads the pane's screen to learn what a dialog is really offering, which it
  // does before any focusing happens.
  async function paneForSession(sessionId) {
    const t = await targetFor(sessionId);
    if (!t.tty) return null;
    return tmux.paneForTty(t.tty);
  }

  // `select` is what separates the two things this is asked for. Raising a
  // session because someone pressed it on the device SHOULD jump tmux to that
  // pane — that is the whole request. Answering a question should not: the keys
  // land in the pane by name, so moving what the user is looking at buys
  // nothing and interrupts whatever they were reading.
  async function focusSession(sessionId, { select = true } = {}) {
    const { target, viaHost, tty, reason } = await targetFor(sessionId);
    if (!tty) return { focused: false, reason };

    // tmux first: a pane is a strictly better target than a window. It is named
    // rather than frontmost, so nothing can drift between focusing and typing,
    // and it needs no permission macOS can deny.
    const pane = await tmux.paneForTty(tty);
    if (pane) {
      // Copy mode eats the keys — a Down would scroll the scrollback instead of
      // moving the dialog's cursor. Say so rather than typing into it.
      if (pane.inMode) {
        return { focused: false, reason: `tmux pane ${pane.label} is in copy mode` };
      }
      if (select) await tmux.selectPane(pane.id);
      log('FC', `pane ${pane.label} for ${target.name || sessionId.slice(0, 8)}${viaHost ? ' [parked host]' : ''}`);
      return { focused: true, app: 'tmux', exact: true, pane: pane.id, paneLabel: pane.label, tty, viaHost };
    }

    const app = await appOf(target.pid);
    if (app && app !== 'Terminal') {
      // Only Terminal.app exposes tty per tab; raise the app and say so.
      const r = await osascript(`tell application "${app}" to activate`);
      return r.ok
        ? { focused: true, app, exact: false, reason: `${app} raised (tab targeting unsupported)` }
        : { focused: false, reason: r.denied ? `automation denied for ${app}` : r.error };
    }

    // A terminal we could not name is not Terminal.app. Falling through to the
    // script below anyway *launched* Terminal — `tell application "Terminal"`
    // starts it — and then reported the confusing "no tab owns that tty", which
    // is how a session in a tmux pane used to open a stray empty window every
    // time the device tried to answer it.
    if (!app) return { focused: false, reason: 'could not identify the terminal app for that session' };

    const r = await osascript(TERMINAL_RAISE(tty));
    if (!r.ok) {
      if (r.denied) {
        automationDenied = true;
        return {
          focused: false,
          reason: 'macOS denied Automation for Terminal — allow it in System Settings › Privacy & Security › Automation',
        };
      }
      return { focused: false, reason: r.error };
    }
    if (r.out !== 'true') return { focused: false, reason: 'no Terminal tab owns that tty' };
    log('FC', `focused ${target.name || sessionId.slice(0, 8)} (${tty})${viaHost ? ' [parked host]' : ''}`);
    // A parked window is the job's window: whatever the job is asking is what
    // is on screen there, so the keypress belongs to it exactly as much as it
    // belongs to a session's own tab. Anything less means walking to the Mac,
    // which is the one thing the device exists to avoid.
    return { focused: true, app: 'Terminal', exact: true, tty, viaHost };
  }

  // The tmux route for both typers. Nothing about it can be denied and nothing
  // about it depends on which window is in front, so there is no permission
  // state to carry and no focus to re-check.
  async function sendToPane(pane, keys) {
    const r = await tmux.sendKeys(pane, keys);
    return r.sent ? { typed: true, via: 'tmux' } : { typed: false, reason: r.reason };
  }

  // Types a single character. A tmux target takes the pane route; anything else
  // requires Automation → System Events, and if macOS denies it we report that
  // and leave the prompt to the keyboard rather than attempting any other
  // injection route.
  async function typeKey(char, target) {
    if (target && target.pane) return sendToPane(target.pane, [char]);
    if (automationDenied) return { typed: false, reason: 'automation denied' };
    const safe = String(char).slice(0, 1).replace(/["\\]/g, '');
    if (!safe) return { typed: false, reason: 'nothing to type' };
    const r = await osascript(`tell application "System Events" to keystroke "${safe}"`);
    if (r.ok) return { typed: true };
    if (r.denied) {
      return {
        typed: false,
        reason: 'macOS denied Automation for System Events — allow it in System Settings › Privacy & Security › Automation',
      };
    }
    return { typed: false, reason: r.error };
  }

  // Types a whole sequence into the focused window in ONE osascript call.
  // One call on purpose: a multi-question dialog needs several keys landing in
  // the same window, and re-invoking osascript per key opens a gap where focus
  // can move and half the answer lands somewhere else. (The tmux route above
  // has no such gap — send-keys names its pane — so it sends key by key.)
  //
  // A key is either a single character (sent as `keystroke`) or one of the
  // named non-printing keys below. The delay between keys is what lets the TUI
  // redraw and move to the next question before the following key arrives.
  async function typeSequence(keys, target) {
    if (target && target.pane) return sendToPane(target.pane, keys);
    if (automationDenied) return { typed: false, reason: 'automation denied' };
    const lines = [];
    for (const key of keys) {
      if (lines.length) lines.push(`  delay ${KEY_GAP_S}`);
      if (KEY_CODES[key] !== undefined) {
        lines.push(`  key code ${KEY_CODES[key]}`);
        continue;
      }
      const safe = String(key).slice(0, 1).replace(/["\\]/g, '');
      if (!safe) return { typed: false, reason: 'nothing to type' };
      lines.push(`  keystroke "${safe}"`);
    }
    if (!lines.length) return { typed: false, reason: 'nothing to type' };

    const script = ['tell application "System Events"', ...lines, 'end tell'].join('\n');
    const r = await osascript(script, 3000 + keys.length * 400);
    if (r.ok) return { typed: true };
    if (r.denied) {
      return {
        typed: false,
        reason: 'macOS denied Automation for System Events — allow it in System Settings › Privacy & Security › Automation',
      };
    }
    return { typed: false, reason: r.error };
  }

  // focusSession/typeKey/typeSequence are the primitives and do NOT take the
  // lock themselves — that would deadlock the focus-then-type pair, which has
  // to hold it across both. Callers wrap them in exclusive(). paneForSession and
  // capturePane are outside it on purpose: they only read, and the plan card
  // reads a pane while another session's answer may well be typing into its own.
  return { exclusive, focusSession, paneForSession, capturePane: (id) => tmux.capturePane(id), typeKey, typeSequence, lookupSession };
}
