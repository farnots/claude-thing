// Everything waiting on a human, in one list: tool permissions (held by the
// permission bridge) and multiple-choice questions (AskUserQuestion).
//
// Important asymmetry, verified against Claude Code:
//   • Permissions CAN be answered programmatically — the PermissionRequest
//     hook's response carries the decision.
//   • Questions CANNOT. No hook can supply a tool result, so answering one
//     from the device means focusing that terminal and typing the choice.
//     If macOS denies Automation, we focus the window and tell the user to
//     press the key themselves.
//   • Plan approval (ExitPlanMode) fires a PermissionRequest hook but IGNORES
//     the hook's decision — the terminal dialog stays up after behavior:"allow"
//     and the session stays blocked. So plans go through the question path:
//     surface on the device, answer by focus + keypress.
//   • A plan's OPTIONS are not in any payload. The hook carries the plan text
//     and nothing else, while the dialog's rows depend on settings and on the
//     session (whether bypass permissions is available, whether auto mode is
//     gated on, whether showClearContextOnPlanAccept adds a clear-context row
//     first). They used to be hardcoded, which made the card claim "bypass
//     permissions" where the screen offered "use auto mode" — and, when the
//     clear-context row was present, made the first choice wipe the
//     conversation. So when the session is in a tmux pane we read the rows off
//     the screen instead of guessing them.
//
// One AskUserQuestion tool call carries a LIST of questions and is ONE dialog:
// the terminal walks its questions in order and ends on a "Submit answers"
// step. So it is one ask here too. Splitting it per question — which this
// used to do — left that submit step with no card, no keypress, and the
// session blocked forever on a dialog every question of which was answered.

import crypto from 'node:crypto';
import { log } from './log.js';
import { t } from './i18n.js';

// Overridable so tests can watch an ask time out without waiting ten minutes.
const QUESTION_TTL_MS = Number(process.env.CLAUDE_THING_QUESTION_TTL_MS ?? 10 * 60_000);
const MAX_EXPIRED = 32;

// Reading a plan's dialog off the pane: the PermissionRequest hook is answered
// BEFORE Claude Code draws the dialog (permission-bridge.js), so the first look
// is usually too early. Overridable so tests do not sleep.
const PLAN_READ_TRIES = Number(process.env.CLAUDE_THING_PLAN_READ_TRIES ?? 8);
const PLAN_READ_GAP_MS = Number(process.env.CLAUDE_THING_PLAN_READ_GAP_MS ?? 150);

// Not unref'd: it is awaited, and a process that exits mid-wait leaves the plan
// card unsent. Bounded by PLAN_READ_TRIES, so it can delay shutdown by about a
// second at worst.
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// The keys Claude Code's question dialog takes, in one place, because this is
// the part of the system that cannot be derived from anything in this repo —
// it is the terminal UI's contract. Read out of the CLI itself (2.1.220), not
// guessed:
//
//   • single-select question — walk the cursor DOWN to the option and press
//     Return. Not the digit: Claude Code draws a single-select two different
//     ways, and the digit means opposite things in them. A plain question uses
//     the shared list, where a digit selects and advances. A question whose
//     options carry `preview` text gets the split-pane layout instead, where a
//     digit only MOVES the cursor and Return is what selects — so a digit
//     sequence typed into one of those picks nothing, and the trailing Return
//     lands on the first question, answering it and stranding the dialog on the
//     second. Down-then-Return is the one contract both layouts share, and the
//     device cannot tell them apart: `preview` never crosses the wire, and the
//     layout also depends on terminal state the daemon does not see.
//
//     The cursor starts on the first option of every question, so the number
//     of Downs IS the option index.
//
//   • multiSelect question — each digit TOGGLES its option and the dialog
//     stays put. Return does NOT commit: inside the list it activates the row
//     under the cursor, so a Return here just toggles option 1 again. The
//     list's own move-on control is a button below the options labelled
//     "Next" (or "Submit" on the last question), reachable only by walking the
//     cursor down past every option and the "Other" row. TAB is the way out
//     that does not depend on where the cursor is: a multi-question dialog
//     draws a tab strip and hints "Tab/Arrow keys to navigate", and tabs:next
//     is bound whenever the dialog is not inside a text input.
//
//   • after the last question — the tab strip's final tab is "✓ Submit", which
//     draws a "Review your answers" screen ending in a Submit answers /
//     Cancel confirm. Return takes it. A one-question dialog hides that tab
//     entirely and must not get a trailing Return.
//
// The sequence is the FINAL answer, never a replay of how the user got there.
// The device's own toggling — on, off, on again — has no business reaching the
// terminal: each stray digit would flip an option the user had already settled,
// and the sequence has to land the dialog in the state shown on the review
// step and then finish it.
export function keySequence(questions, answers) {
  const keys = [];
  questions.forEach((q, i) => {
    if (!q.multiSelect) {
      // Down to the option, Return to take it — which also advances.
      for (let d = 0; d < answers[i][0]; d++) keys.push('down');
      keys.push('return');
      return;
    }
    // A multiSelect only ever draws the shared list, so its digits are safe.
    for (const pick of answers[i]) keys.push(String(pick + 1));
    keys.push('tab');
  });
  if (questions.length > 1) keys.push('return');
  return keys;
}

// ── Reading a dialog off a captured pane ─────────────────────────────────────
//
// `tmux capture-pane -p` gives the pane's visible screen as plain text, dialog
// included. What we want out of it is the numbered option list:
//
//   │ Ready to code?                          │
//   │ ❯ 1. Yes, and use auto mode             │
//   │   2. Yes, manually approve edits        │
//   │   3. No, keep planning                  │
//
// The screen also holds the conversation above the dialog, and prose numbers
// lists too, so a row on its own proves nothing. What identifies the dialog is
// the RUN: consecutive rows counting 1, 2, 3… with no gap, and the last such run
// on the screen is the one that is up.
//
// A run whose lowest visible number is not 1 is refused rather than trusted: it
// means the top of the list scrolled off a short pane, and every index derived
// from it would be off by however many rows are missing — worse than not
// reading the screen at all, because the answer is keyed by position.
const OPTION_RE = /^\s*(?:[❯>»▸▶]\s*)?(\d+)\.\s+(\S.*)$/;

// A wrapped label puts continuation lines between two rows; a few lines of slack
// tolerates that without letting an unrelated numbered line join the run.
const MAX_ROW_GAP = 4;

function normalizeLabel(text) {
  return String(text || '')
    .replace(/[│┃]\s*$/, '')     // right-hand box border
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:…|\.\.\.)$/, '')   // the terminal truncates to pane width
    .trim();
}

// A line that carries no label text: blank, or nothing but box drawing. Letters
// and digits of any script count — a wrapped label continuing with "économie"
// is text, and reading it as a blank would cut the label there.
function isBlank(line) {
  return !/[\p{L}\p{N}]/u.test(line);
}

// Where a line's text starts, ignoring the left box border. A wrapped label's
// continuation lines up under the label, which is how they are told apart from
// the hint lines a dialog prints under a row at a deeper indent.
function textColumn(line) {
  const m = /^[\s│┃]*/.exec(line);
  return m ? m[0].length : 0;
}

export function parseDialogOptions(captured) {
  const lines = String(captured || '').split('\n');
  const found = [];
  lines.forEach((raw, at) => {
    const m = OPTION_RE.exec(raw.replace(/^[\s│┃]+/, ' '));
    if (!m) return;
    // Column of the label itself, past the border, the cursor and the "N. ".
    const col = raw.indexOf(m[2]);
    found.push({ at, col: col < 0 ? textColumn(raw) : col, n: Number(m[1]), label: normalizeLabel(m[2]) });
  });

  for (let end = found.length - 1; end >= 1; end--) {
    let start = end;
    while (start > 0
      && found[start - 1].n === found[start].n - 1
      && found[start].at - found[start - 1].at <= MAX_ROW_GAP) start--;
    if (found[start].n !== 1 || end === start) continue;
    const run = found.slice(start, end + 1);
    // A label longer than the pane is wrapped onto the lines below it. Those
    // lines belong to the row, and without them the card shows a label cut off
    // mid-sentence — "Yes, clear context (14% used) and".
    return run.map((row, i) => {
      const stop = i + 1 < run.length ? run[i + 1].at : Math.min(lines.length, row.at + 1 + MAX_ROW_GAP);
      let label = row.label;
      for (let at = row.at + 1; at < stop; at++) {
        if (isBlank(lines[at])) break;
        // A deeper indent is a hint line the dialog prints under the row, not
        // more label — "shift+tab to approve with this feedback" is not part of
        // the choice above it.
        if (Math.abs(textColumn(lines[at]) - row.col) > 1) break;
        label = normalizeLabel(`${label} ${lines[at].trim()}`);
      }
      return { index: row.n - 1, label };
    });
  }
  return null;
}

// Where a chosen label really sits in the list on screen. Both sides truncate —
// the device to 60 characters (shapeQuestion), the terminal to the pane width —
// so an exact match is tried first and a prefix match second. -1 means the label
// is not on screen at all, which is the one case worth refusing to type for.
const MIN_PREFIX = 12;

export function matchOptionIndex(rows, label) {
  const want = normalizeLabel(label).toLowerCase();
  if (!want || !rows) return -1;
  // Normalized on both sides: a row's own label may still carry the ellipsis the
  // terminal cut it with, and comparing that against a full label fails at the
  // very character the truncation replaced.
  const have = rows.map((row) => ({ index: row.index, text: normalizeLabel(row.label).toLowerCase() }));
  for (const row of have) {
    if (row.text === want) return row.index;
  }
  for (const row of have) {
    const n = Math.min(row.text.length, want.length);
    if (n >= MIN_PREFIX && row.text.slice(0, n) === want.slice(0, n)) return row.index;
  }
  return -1;
}

// What each approve row actually does, in the device's words. Order matters:
// "clear context and use auto mode" is a clear-context row first and foremost,
// and the device must say so — it is the one choice that costs the conversation.
// A row we do not recognize gets no description rather than an invented one.
//
// The regexes match the CLI's own English rows and stay English whatever the
// user's language is — they read a screen, they are not shown to anyone. Only
// the note attached to each is ours to translate.
const PLAN_NOTES = [
  [/clear context/i, 'plan.clearContext'],
  [/bypass permissions/i, 'plan.bypass'],
  [/auto mode/i, 'plan.auto'],
  [/auto-accept edits/i, 'plan.acceptEdits'],
  [/manually approve/i, 'plan.manual'],
];

function planNote(label, lang) {
  const hit = PLAN_NOTES.find(([re]) => re.test(label));
  return hit ? t(lang, hit[1]) : '';
}

// The approve rows of a plan dialog, as the card's options. Only the leading
// run of "Yes…" rows: the decline paths ask for typed feedback, so they stay on
// the keyboard exactly as they did when the two options were hardcoded. They are
// last in the dialog, so dropping them leaves the kept indices equal to the
// on-screen ones — which is what keySequence counts Downs against.
export function planOptionsFrom(rows, lang = 'en') {
  const out = [];
  for (const row of rows || []) {
    if (!/^yes\b/i.test(row.label)) break;
    if (row.index !== out.length) return null;
    // The label is the row as the screen spells it, never translated:
    // matchOptionIndex looks it back up on that screen before typing, so a
    // translated label would answer nothing.
    out.push({ label: row.label, description: planNote(row.label, lang) });
  }
  // A numbered list of "Yes…" rows is not proof the plan dialog is the one up —
  // the trust-this-folder prompt is also one. Require at least one row we can
  // name, so an unrelated dialog is refused and the caller falls back to the
  // guessed options rather than offering someone else's choices.
  if (!out.length || !out.some((o) => o.description)) return null;
  return out;
}

// Used when the screen cannot be read — no tmux, or no dialog visible in time.
// The wording is the CLI's own for a session with neither bypass permissions nor
// the auto-mode gate; the ask carries optionsUnverified so nothing downstream
// mistakes it for something read off a screen.
// The labels are the CLI's wording and are matched against the live screen at
// answer time, so they are English here in every language.
function fallbackPlanOptions(lang) {
  return [
    { label: 'Yes, auto-accept edits', description: t(lang, 'plan.acceptEdits') },
    { label: 'Yes, manually approve edits', description: t(lang, 'plan.manual') },
  ];
}

// Answers arrive as number[][] — one entry per question, each the option
// indices chosen for it. A pre-group client sending a bare optionIndex still
// works, as long as the ask really is one single-select question.
function normalizeAnswers(raw, questions) {
  const list = Array.isArray(raw) ? raw : [[raw]];
  if (list.length !== questions.length) return null;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const picks = Array.isArray(list[i]) ? list[i] : [list[i]];
    const q = questions[i];
    // A single-select question is exactly one option. A multiSelect may be
    // none — "none of these" is an answer, and refusing it left the device
    // with a set it could never submit.
    if (!q.multiSelect && picks.length !== 1) return null;
    for (const p of picks) {
      if (!Number.isInteger(p) || p < 0 || p >= q.options.length) return null;
    }
    // A repeated index would toggle an option off again; the device never
    // sends one, and honouring it would type a key that undoes itself.
    if (new Set(picks).size !== picks.length) return null;
    out.push(picks);
  }
  return out;
}

function shapeQuestion(q, lang) {
  const options = (q.options || []).slice(0, 8).map((o) => ({
    label: String(o.label || '').slice(0, 60),
    description: String(o.description || '').slice(0, 120),
  }));
  return {
    // A header the asker gave is theirs; only the fallback is ours to say.
    header: (q.header || t(lang, 'queue.question')).toUpperCase(),
    question: String(q.question || '').slice(0, 300),
    options,
    multiSelect: !!q.multiSelect,
  };
}

// `lang` is a getter for the same reason it is one in usage.js: the user can
// change it while the daemon runs, and injecting it keeps this module unaware
// of where preferences live, so its tests run in English on any Mac.
export function createQueue({ emit, store, focus, lang = () => 'en' }) {
  const questions = new Map();   // id -> ask
  const expired = new Map();     // id -> ask, timed out but still on screen

  function sessionName(sessionId) {
    const d = store.get(sessionId);
    return d ? d.name : 'session';
  }

  // What the user asked for, carried on every ask as its intent line. Empty
  // when no prompt has been seen; the device then omits the line.
  function intentFor(sessionId) {
    const s = sessionId && store.raw(sessionId);
    return s && s.lastPrompt ? t(lang(), 'permission.youAsked', { prompt: s.lastPrompt }) : '';
  }

  // One ask per dialog: every question the tool call carries rides on the same
  // card, and the device answers them all before anything is typed. A question
  // with no options can't be answered by a keypress, so it is dropped — and if
  // that leaves nothing, so is the whole ask.
  //
  // The top-level header/question/options/multiSelect mirror questions[0]. They
  // are what a client that predates grouping reads, and they keep the card's
  // summary line derivable without unwrapping the list.
  function onQuestion(payload) {
    const input = payload.tool_input || {};
    const list = (Array.isArray(input.questions) ? input.questions : [])
      .map((q) => shapeQuestion(q, lang()))
      .filter((q) => q.options.length);
    if (!list.length) return;

    const id = crypto.randomUUID();
    const ask = {
      kind: 'question',
      id,
      sessionId: payload.session_id || null,
      sessionName: sessionName(payload.session_id),
      intent: intentFor(payload.session_id),
      questions: list,
      header: list[0].header,
      question: list[0].question,
      options: list[0].options,
      multiSelect: list[0].multiSelect,
      createdTs: Date.now(),
    };
    questions.set(id, ask);
    // unref: a pending question must never be the reason the process stays up
    setTimeout(() => expire(id), QUESTION_TTL_MS).unref();
    emit('claude.question.request', ask);
    log('QQ', `question queued: ${ask.header} (${list.length} question${list.length === 1 ? '' : 's'})`);
  }

  // The approve rows the dialog is really showing, read off the pane. Null when
  // the session is not in a tmux pane, or when nothing readable turned up in
  // time — the caller then falls back to the CLI's default wording.
  async function readPlanOptions(sessionId) {
    if (!sessionId || !focus.paneForSession || !focus.capturePane) return null;
    let pane;
    try { pane = await focus.paneForSession(sessionId); } catch { return null; }
    if (!pane) return null;
    for (let i = 0; i < PLAN_READ_TRIES; i++) {
      if (i) await sleep(PLAN_READ_GAP_MS);
      let text = null;
      try { text = await focus.capturePane(pane.id); } catch {}
      const options = planOptionsFrom(parseDialogOptions(text), lang());
      if (options) return options;
    }
    log('QQ', `plan dialog not readable in pane ${pane.label || pane.id}`);
    return null;
  }

  // Called from the PermissionRequest hook when Claude presents a plan. Picking
  // an approve row is one keypress — exactly a question — so the plan rides the
  // question path. The decline paths need typed feedback and stay on the
  // keyboard, so only the leading "Yes…" rows become options.
  //
  // Async because the options come off the pane, and the dialog is not drawn
  // until after this hook has been answered. The tile flips to waiting first, so
  // the wait costs the card's arrival and nothing else.
  async function onPlanApproval(payload) {
    const plan = String((payload.tool_input || {}).plan || '');
    const heading = plan.split('\n').find((l) => l.trim());
    const sessionId = payload.session_id || null;
    const createdTs = Date.now();
    if (sessionId) store.touch(sessionId, { waitingForInput: true });

    const read = await readPlanOptions(sessionId);
    const id = crypto.randomUUID();
    const ask = {
      kind: 'question',
      id,
      sessionId,
      sessionName: sessionName(payload.session_id),
      intent: intentFor(payload.session_id),
      questions: [shapeQuestion({
        header: t(lang(), 'queue.plan'),
        // The heading is the plan's own first line; only its absence is ours.
        question: (heading || t(lang(), 'queue.readyToCode')).replace(/^#+\s*/, ''),
        options: read || fallbackPlanOptions(lang()),
      }, lang())],
      createdTs,
    };
    // Guessed options are marked as such. Nothing on the device leans on it
    // today, but a card whose choices were never seen on a screen must not be
    // indistinguishable from one that was.
    if (!read) ask.optionsUnverified = true;
    // A plan is one question, so the mirrors are the whole card — and being one
    // question is what keeps it a single digit with no trailing Return.
    ask.header = ask.questions[0].header;
    ask.question = ask.questions[0].question;
    ask.options = ask.questions[0].options;
    ask.multiSelect = false;
    questions.set(id, ask);
    setTimeout(() => expire(id), QUESTION_TTL_MS).unref();
    emit('claude.question.request', ask);
    log('QQ', `plan queued${read ? '' : ' (options unread)'}: ${ask.question.slice(0, 60)} → ${ask.options.map((o) => o.label).join(' | ')}`);
  }

  // The terminal prompt is gone once the tool returns, so drop ours too.
  function onQuestionAnswered(payload) {
    const sessionId = payload.session_id;
    for (const [id, ask] of questions) {
      if (ask.sessionId === sessionId) {
        questions.delete(id);
        emit('claude.question.resolved', { id, resolution: 'answered' });
      }
    }
    // A timed-out ask the terminal has now answered is finished for good; it
    // must not linger as something the device can still raise a window for.
    for (const [id, ask] of expired) {
      if (ask.sessionId === sessionId) {
        expired.delete(id);
        emit('claude.question.resolved', { id, resolution: 'answered' });
      }
    }
  }

  // Esc kills the terminal dialog without firing any hook — no PostToolUse, no
  // Stop — so the transcript tail's interrupt marker lands here. Unlike a
  // timeout, an interrupted ask is dead everywhere: the dialog is gone from the
  // terminal, so it leaves the expired map too — nothing to raise a window for.
  // Only asks older than the marker die: the tail replays the whole transcript
  // on catch-up, and a stale marker must not kill a fresh ask.
  function onInterrupted(sessionId, ts) {
    for (const map of [questions, expired]) {
      for (const [id, ask] of map) {
        if (ask.sessionId === sessionId && ask.createdTs <= ts) {
          map.delete(id);
          emit('claude.question.resolved', { id, resolution: 'interrupted' });
          log('QQ', `question interrupted: ${ask.header}`);
        }
      }
    }
  }

  // A timed-out question leaves the queue but stays on the device on purpose —
  // it is still up in the terminal, and the card is how you get back to it. So
  // keep the ask itself around: pressing an expired card must still raise that
  // window rather than report a generic failure. Bounded, and only until the
  // ask is twice as old as the TTL that retired it.
  function expire(id) {
    const ask = questions.get(id);
    if (!ask) return;
    questions.delete(id);
    expired.set(id, ask);
    while (expired.size > MAX_EXPIRED) expired.delete(expired.keys().next().value);
    setTimeout(() => expired.delete(id), QUESTION_TTL_MS).unref();
    emit('claude.question.resolved', { id, resolution: 'timeout' });
  }

  // The card was drawn from a screen read some time ago, and the sequence is
  // positional — an option index is a count of Downs. So before sending it into
  // a pane, read the screen again and find the chosen label where it actually
  // is. That is what makes a positional answer safe: a dialog whose rows moved
  // gets the right key, and a screen that does not carry the label at all gets
  // no keys, because typing into the wrong dialog answers the wrong question.
  //
  // Only a lone single-select question is checked. A grouped or multiSelect
  // dialog is walked with tabs through a strip that is not a plain numbered
  // list, and second-guessing that would be worse than the sequence we have.
  async function verifiedKeys(ask, answers, keys, paneId) {
    if (ask.questions.length !== 1 || ask.questions[0].multiSelect) return { keys };
    if (!focus.capturePane) return { keys };
    let text = null;
    try { text = await focus.capturePane(paneId); } catch {}
    const rows = parseDialogOptions(text);
    // Nothing numbered on screen is not proof the card is stale: a question
    // whose options carry previews draws its own layout. Trust the card, and
    // leave the reason it could not be checked in the log.
    if (!rows) {
      log('QQ', `dialog unreadable in ${paneId} — answering ${ask.header} unverified`);
      return { keys };
    }
    const want = ask.questions[0].options[answers[0][0]].label;
    const at = matchOptionIndex(rows, want);
    if (at < 0) return { reason: 'the dialog on screen does not match this card' };
    if (at === answers[0][0]) return { keys };
    log('QQ', `option moved: "${want}" is #${at + 1} on screen, card said #${answers[0][0] + 1}`);
    return { keys: keySequence(ask.questions, [[at]]) };
  }

  async function answerQuestion(id, rawAnswers) {
    const ask = questions.get(id) || expired.get(id);
    if (!ask) {
      log('QQ', `answer refused: ${id.slice(0, 8)} already resolved`);
      return { accepted: false, reason: 'already resolved' };
    }
    // Validate the whole answer set before touching the keyboard: a sequence
    // that is wrong halfway through leaves a half-answered dialog, which is
    // strictly worse than refusing it here. Refusals are immediate — only the
    // part that drives the keyboard waits its turn.
    const answers = normalizeAnswers(rawAnswers, ask.questions);
    if (!answers) return { accepted: false, reason: 'bad answer shape' };
    const chosen = ask.questions
      .map((q, i) => answers[i].map((p) => q.options[p].label).join(' + ') || 'none')
      .join(' · ');
    const keys = keySequence(ask.questions, answers);

    // One answer drives the keyboard at a time, focus and typing together. Two
    // of these running at once put their keystrokes into whichever window is
    // frontmost at that instant — which, with asks from different sessions, is
    // digits landing in the wrong terminal.
    return focus.exclusive(() => type());

    async function type() {
      // The wait may have been long. The terminal may have answered this one
      // itself, or Esc may have killed it, while it sat behind another answer —
      // and typing into a dialog that is gone answers whatever replaced it.
      if (!questions.has(id) && !expired.has(id)) {
        log('QQ', `answer dropped: ${id.slice(0, 8)} resolved while queued`);
        return { accepted: false, reason: 'already resolved' };
      }
      const timedOut = !questions.has(id);

      // Focus first so the keystrokes — or the user's own — land in the right
      // window.
      // select: false — a pane is typed into by name, so an answer must not move
      // what the user is looking at. The non-tmux route ignores it and raises the
      // window, because there it is the only way the keys reach anything.
      const f = ask.sessionId
        ? await focus.focusSession(ask.sessionId, { select: false })
        : { focused: false, reason: 'unknown session' };

      // A pane is answered by name, so the screen it is about to receive can be
      // read first — and must be, since the sequence counts positions.
      let send = keys;
      if (f.focused && f.exact && f.pane) {
        const check = await verifiedKeys(ask, answers, keys, f.pane);
        if (check.reason) {
          log('QQ', `answer refused: ${check.reason} (${ask.header} → ${chosen})`);
          return { accepted: false, viaKeyboard: false, option: chosen, focused: true, reason: check.reason };
        }
        send = check.keys;
      }

      let typed = { typed: false, reason: 'not attempted' };
      if (f.focused && f.exact) {
        typed = await focus.typeSequence(send, f);
      }

      if (typed.typed) {
        questions.delete(id);
        expired.delete(id);
        emit('claude.question.resolved', { id, resolution: 'answered' });
        log('QQ', `answered by keypress [${send.join(' ')}]${f.pane ? ` in ${f.paneLabel || f.pane}` : ''}: ${ask.header} → ${chosen}`);
        return { accepted: true, viaKeyboard: true, option: chosen, keys: send };
      }

      // Focused but could not type: the human finishes it, and the ask stays in
      // the queue until the PostToolUse hook says it was answered. The sequence
      // is logged either way — a dialog left part-typed must leave behind what
      // was typed, on the machine that typed it.
      const res = {
        accepted: f.focused,
        viaKeyboard: false,
        option: chosen,
        questionCount: ask.questions.length,
        focused: f.focused,
        timedOut,
        // when focus itself failed, that is the reason worth reporting
        reason: f.focused ? (typed.reason || 'could not type') : f.reason,
      };
      // Every outcome is logged: a device that says it could not answer must
      // leave behind the reason it could not, on the machine that decided.
      log('QQ', `answer ${f.focused ? 'focused' : 'failed'}${timedOut ? ' (timed out)' : ''} [${send.join(' ')}]: ${res.reason}`);
      return res;
    }
  }

  function list() {
    return [...questions.values()].sort((a, b) => a.createdTs - b.createdTs);
  }

  return { onQuestion, onPlanApproval, onQuestionAnswered, onInterrupted, answerQuestion, list, size: () => questions.size };
}
