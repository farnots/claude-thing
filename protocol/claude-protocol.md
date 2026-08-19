# claude.* protocol

Single source of truth for the Claude Mode RPC surface. Envelope everywhere is
the nocturned JSON envelope:

```json
{"type":"request","id":"<uuid>","method":"claude.sessions.list","params":{}}
{"type":"response","id":"<uuid>","result":{}}
{"type":"error","id":"<uuid>","error":"<string>"}
{"type":"event","topic":"claude.sessions.update","data":{},"server_timestamp_ms":0}
```

Transport chain: device app ⇄ nocturned :5000 ⇄ (emulator claude-bridge | BT →
Swift Nocturne relay) ⇄ daemon `ws://127.0.0.1:8790/ws`. The Swift relay
converts MsgPack↔JSON at the BT boundary; frames are otherwise passed through
with ids preserved.

## Bridge handshake (daemon-internal, relays + webpage only)

First frame from any client of the daemon hub:

```json
{"type":"request","id":"…","method":"bridge.hello","params":{"role":"emulator|connector|webpage","info":{}}}
```

→ `{"result":{"ok":true,"daemonVersion":"…"}}`.

Connector role additionally pushes status (every 10s and on change):

```json
{"type":"request","id":"…","method":"bridge.status","params":{"bt":{"connected":true,"device":"Car Thing","address":"…","serial":"…","firmware":"…"}}}
```

Hub semantics (deliberate deviation from nocturned, daemon-internal only):
responses go **only to the requesting socket**; events broadcast to all
connected clients.

## Requests (device → daemon)

| Method | Params | Result |
|---|---|---|
| `claude.ping` | `{}` | `{daemonVersion, sessions:<n>}` |
| `claude.sessions.list` | `{limit?}` | `{sessions:[SessionSummary], stats:Stats, serverNowMs, tzOffsetMin, clock24, lang, intProbe}` — unbounded unless `limit` given, except for `connector`/`emulator` roles, which are capped at 4 (`BT_SAFE_SESSION_LIMIT`) even without `limit`: their synchronous responses must fit one Bluetooth chunk. When the cap trims the list, the daemon follows up with a full `claude.sessions.update` push, which chunks fine. `stats` always counts every session, not the returned slice |
| `claude.session.get` | `{id}` | `SessionDetail` (error `"unknown session"` if gone) |
| `claude.session.watch` | `{id: string\|null}` | `{ok:true}` — this socket now receives `claude.session.update` only for that session (`null` = none). Opt-in per socket: a client that never sends it gets every detail, as before. Handled inside the hub (it is per-socket state, which registered methods can't see) — `claude.`-prefixed anyway, because the relays forward only that prefix. Watch dies with the socket; a restarted daemon reverts to broadcast-all until the client re-asserts (the device re-sends on `claude.queue.sync`, which fires on every client hello). Known limit: the connector multiplexes all paired devices onto one socket, so the last watch wins |
| `claude.permission.answer` | `{requestId, decision:"allow"\|"deny"}` | `{accepted:bool}` — idempotent; `false` when already resolved |
| `claude.queue.list` | `{}` | `{asks:[Ask]}` — everything waiting on a human, oldest first |
| `claude.question.answer` | `{id, answers}` — `answers` is `number[][]`, one entry per question of the ask, each the option indices picked for it (`optionIndex` still accepted for a lone single-select question) | `{accepted, viaKeyboard, option, keys?, focused?, reason?}` (see below) |
| `claude.session.focus` | `{id}` | `{focused, app?, exact?, reason?}` — raises that session's terminal window |
| `claude.usage.get` | `{slim?, accounts?, account?}` | `Usage`. Three shapes, because the multi-account reading does not fit one Bluetooth chunk and a synchronous response cannot span them: **`{slim}`** returns the flat mirror of the primary account only — byte for byte what this method returned before accounts existed, so an older device app is unaffected; **`{slim, account:"poly"}`** returns that one account in the same flat shape; **`{slim, accounts:1}`** returns the `accounts` array *without* the mirror. Opting in is what makes the default backwards compatible. `connector`/`emulator` roles are capped at 2 accounts (`BT_SAFE_USAGE_ACCOUNTS`) exactly as `claude.sessions.list` is capped at 4, and when the cap trims the list the daemon follows up with a full `claude.usage.update` push. Without `slim`, the full reading is returned (notes, MCP servers, every window) |

## Events (daemon → everyone)

| Topic | Data | Notes |
|---|---|---|
| `claude.sessions.update` | `{sessions:[SessionSummary], stats:Stats, serverNowMs, tzOffsetMin, clock24, lang, intProbe}` | full idempotent snapshot of ALL sessions, debounced 500 ms. The device's clock is wrong in both axes — no RTC battery, no NTP, no timezone data — so it takes both from here: `serverNowMs` = the Mac's `Date.now()`, the epoch every device-side duration and countdown is measured against; `tzOffsetMin` = the Mac's `Date.getTimezoneOffset()`, which renders it as local time. Not the frame's `server_timestamp_ms` — nocturned re-stamps relayed frames with the device clock. `clock24` and `lang` are the other two things the device cannot work out for itself, and they are preferences rather than measurements: the Mac settles the user's Auto/12/24 and Auto/English/Français choices against System Settings and sends only the answers — a boolean, and `en` or `fr`. The device never sees `auto`. A daemon too old to send either field leaves the device on 12-hour and English, which is what it has always drawn |
| `claude.session.update` | `SessionDetail` | pushed on change for any live session — unless the receiving socket narrowed itself with `claude.session.watch`, in which case only the watched session's details arrive. The only topic watch ever filters |
| `claude.permission.request` | `{requestId, sessionId, tool, summary, intent, createdTs, timeoutMs, destructive}` | timeoutMs = 55000; `intent` = "you asked: …" from the session's last prompt, "" when unknown; `destructive` = classified daemon-side against the full command (the device's own regex only ever saw the 200-char summary) — clients fall back to their regex when the field is absent |
| `claude.permission.resolved` | `{requestId, resolution:"allow"\|"deny"\|"timeout"}` | closes prompt everywhere; terminal-answered too |
| `claude.question.request` | `Ask` (kind `question`) | a multiple-choice question is on screen in some session |
| `claude.question.resolved` | `{id, resolution:"answered"\|"timeout"}` | the question is gone, however it was answered |
| `claude.usage.update` | `Usage` (slim, mirror **and** `accounts`) | one frame per account refresh — with two accounts that is every 30s, since polls are staggered across the refresh window. Carries only the device-rendered subset: no `subscription`, no `notes`, no `mcp`, first window only, top lists capped at 3, and from two accounts on no `skills`/`subagents` either (a column does not draw them). **Never one event per account, and never a per-account topic.** The Mac connector coalesces this topic by name alone (`coalesceKey` in `ClaudeRelayService.swift`), so two frames inside its 200 ms window supersede each other — which is lossless only because every frame is a complete snapshot of every account. Splitting it would need a new `case` in the Swift relay, so a DMG rebuild and a Mac-app update for everyone. `claude.usage.get` returns the full reading |
| `claude.daemon.status` | `{connected:bool}` | synthesized by relays on daemon link up/down — never sent by the daemon itself |

## Shapes

```ts
SessionSummary = {
  id: string,            // session id
  name: string,          // project dir basename, ≤32 chars
  state: "busy"|"attention"|"celebrate"|"idle",
  lastActivityTs: number,      // epoch ms
  tokens: { in: number, out: number },
  pendingPermission: boolean,
  ended: boolean,       // idle-and-over vs idle-and-quiet
  context: number|null, // 0..1 of the model's context window; null when the
                        // model is unknown, so the device draws no meter
                        // rather than a meter against a guess
  permissionMode: string|null, // "plan"|"bypassPermissions"|"acceptEdits"|
                        // "auto"|"default"; null until a hook or transcript
                        // record says — the device draws no badge for null
                        // or anything it can't name
  effort: string|null,  // reasoning effort of the newest turn, off the
                        // transcript's assistant records ("low"…"max",
                        // "ultrathink"); null until one says — the device
                        // then draws no effort label and keeps the plain
                        // working sprite
  project: string,      // 8 hex chars keying the session's working directory,
                        // or "" when no source has named one. Sessions sharing
                        // a directory share the key; the device derives a hue
                        // from it and tints them alike, which is the only thing
                        // that separates three tiles all named after the same
                        // basename. The path itself never travels here — it
                        // costs more than the per-session margin of the chunk
                        // budget below — and SessionDetail already carries cwd
}
// ~300 B each measured (~350 worst case), unbounded count — the device grid
// scrolls sideways through them. Over Bluetooth an async event snapshot spans
// multiple chunks, which the chunking layer handles; a *synchronous* response
// cannot, so a constrained client should pass `limit` on claude.sessions.list
// and rely on the event stream for the full set. The daemon also enforces this
// for relay roles that forget: see claude.sessions.list above.
//
// intProbe is wire hygiene, not data: the daemon always sends the integer 1,
// and clients must ignore its value except as a transport check. The Mac
// connector's MsgPack packer historically coerced NSNumber 0/1 to booleans; a
// client that receives intProbe === true knows the link still coerces and
// should repair numeric fields (the device's unbool walk), one that receives
// 1 knows the link is clean and can skip the repair.

SessionDetail = SessionSummary & {
  contextTokens: number, // what the newest turn sent — the raw numerator
  cwd: string,
  model: string,
  startedTs: number,
  currentTool: string|null,
  lastMessage: string,   // ≤200 chars
  permission: { requestId, tool, summary, createdTs, timeoutMs } | null,
}

Stats = { active: number, attention: number }

Ask =
  | { kind:"permission", id, sessionId, sessionName, tool, summary, intent, createdTs, timeoutMs, destructive? }
  | { kind:"question", id, sessionId, sessionName, intent, createdTs,
      questions: [{ header, question, options:[{label, description}], multiSelect }],
      // mirrors of questions[0] — the card's summary line, and what a client
      // that predates grouping reads
      header, question, options, multiSelect }
// One AskUserQuestion call is ONE dialog and one ask, however many questions it
// carries: the terminal walks them in order and ends on a "Submit answers"
// step. Splitting it per question leaves that step with no card and no
// keypress, and the session blocked on a dialog every question of which was
// answered.
// intent: "you asked: " + the session's last user prompt (≤120 chars,
// whitespace-collapsed), or "" when no prompt has been seen — the device
// omits the hero's intent line rather than inventing one

Usage = {
  // The flat mirror: the primary account, in exactly the shape this had before
  // accounts existed. Present in the event and in the {slim} response; absent
  // from a {slim, accounts:1} response, where the array carries everything.
  updatedTs, updatedLabel, subscription?, stale?, error?,
  limits: [{ key, label, used /* 0..1 */, detail /* "resets Jul 30 at 5:19am" */ }],
  windows: [{
    window /* "Last 24h" */, requests, sessions,
    notes: [string],                        // every bullet, verbatim
    // "Top skills: /x 4%, /y 1%" is a table wearing a sentence; split so the
    // device renders rows. Empty when that bullet is absent.
    skills:    [{ name, pct }],
    subagents: [{ name, pct }],
    mcp:       [{ name, pct }],
  }],
  accountId: string,        // which account the mirror above speaks for
  accountCount: number,     // how many are declared and enabled, so a client
                            // knows when it is looking at a capped slice.
                            // 1 on a single-account Mac, which is the value the
                            // connector coerces to `true` — hence its entry in
                            // the device's NUMERIC table (numbers.js)
  accounts?: [UsageAccount],
}

UsageAccount = Usage's mirror fields, per account, plus:
{
  id: string,      // stable slug, /^[a-z0-9][a-z0-9-]{0,15}$/. The key {account}
                   // addresses and the key the reading is persisted under. Never
                   // derived from the email, which changes
  label: string,   // <=12 chars, what the device draws as the column header
}
// From two accounts on, each entry's window carries only {window, requests,
// sessions}: the screen is two columns then, and a column has no room for the
// contributing tables. Sending them is ~330 bytes per account of an 1800-byte
// chunk spent on rows nobody renders, and dropping them is the difference
// between two accounts fitting one synchronous response (1449 bytes worst case)
// and not (2101). A single account keeps the full layout, so nothing is dropped.
//
// A failing account is never dropped from the array — it appears with its
// `error`, its last known limits and `stale: true`. An absent account would be
// indistinguishable from one that was never declared.
```

## Answering questions is not symmetric with permissions

A permission is answered by the daemon: it holds the `PermissionRequest` hook's
HTTP response and replies with the decision. **A multiple-choice question cannot
be.** No Claude Code hook can supply a tool result — `PreToolUse` on
`AskUserQuestion` can only allow, deny, or rewrite the question, and
`PostToolUse` runs after the human has already answered. So the device learns
about questions from the `PreToolUse` hook and answers them the only way
available: focus that session's terminal window and type the keys.

### The keys

This is the one part of the system that cannot be derived from any code here —
it is the terminal UI's contract, read out of the Claude Code CLI itself
(2.1.220). It lives in `keySequence()` in `daemon/src/queue.js`, and the whole
set is typed in **one** osascript call so focus cannot move mid-sequence:

| Step | Keys |
|---|---|
| single-select question | the option's digit — its `onAnswer` defaults `shouldAdvance` to true, so the digit both picks and advances |
| multiSelect question | a digit per pick (each **toggles**), then **Tab** |
| end of a multi-question dialog | Return, for the "Submit answers" confirm |
| a one-question dialog | no trailing Return — it hides the Submit tab, and a stray Return would answer whatever came next |

### One answer at a time

There is one keyboard and one frontmost window, so `claude.question.answer`
serializes: focus and typing run together inside a single lock in
`daemon/src/focus.js`, and `claude.session.focus` takes the same lock. Nothing
else enforces it — the hub handles every socket frame in its own task, so two
answers arriving together would otherwise interleave their keystrokes into
whichever window was in front, which across sessions means digits landing in
the wrong terminal. A raise slipping between an answer's focus and its
keystrokes is the same bug, hence the shared lock.

Answers do arrive in bursts. The device holds each answer for its undo window,
but starting a new one flushes the previous immediately — so answering three
cards quickly sends three answers back to back, and only the last waits.

An answer that is resolved while queued behind another — the terminal answered
it, or Esc killed it — is dropped rather than typed: the dialog it was meant
for is gone, and its keys would answer whatever replaced it.

**Return does not commit a multiSelect.** Inside the list it activates the row
under the cursor, so a Return there toggles option 1 again — which is exactly
what a device answer used to do, twice, instead of submitting. The list's own
move-on control is a button below the options labelled "Next" (or "Submit" on
the last question), reachable only by walking the cursor past every option and
the "Other" row. Tab does not depend on where the cursor is: a multi-question
dialog draws a tab strip ending in a `✓ Submit` tab and hints "Tab/Arrow keys
to navigate", and that Submit tab is the "Review your answers" screen the
trailing Return confirms.

The device holds every answer locally and sends the whole set at once, so a
dialog is never left part-answered by a walk the user abandoned — and so any
answer stays editable until the last press. The daemon validates the set
(one pick per single-select question, in-range indices, no repeats) before
touching the keyboard, for the same reason.

`claude.question.answer` reports how far it got:

| Result | Meaning |
|---|---|
| `accepted:true, viaKeyboard:true` | the whole sequence was typed into the terminal; `keys` is what was sent |
| `accepted:true, viaKeyboard:false` | window focused, but macOS would not let us type — the user answers it |
| `accepted:false` | no window to focus (background agent, or no registry entry), or the answer set did not match the ask; `reason` says which |

Focus uses Claude Code's own session registry: `~/.claude/sessions/<pid>.json`
maps `sessionId → pid`, `ps` maps pid → tty, and Terminal.app's AppleScript
dictionary maps tty → tab. Other emulators can only be raised as an app.
Typing additionally needs Automation → System Events; when macOS denies it we
say so rather than looking for another way in.

## Usage comes from Claude Code itself

`claude -p "/usage"` runs the slash command locally and prints the real plan
figures — session and weekly percentages, reset times, and the "what's
contributing" breakdown. It performs no inference (zero model tokens) and with
`CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` writes no transcript, so the daemon polls it
once a minute and parses the text. Nothing is estimated and no denominator is
invented.

### An account is a `CLAUDE_CONFIG_DIR`, or the absence of one

There is no account name or token the daemon can see. Which account `/usage`
reports is decided entirely by `CLAUDE_CONFIG_DIR` in the poll's environment, so
that variable *is* the account — and **its absence is a distinct account, not a
synonym for `~/.claude`**. Claude Code resolves its state to
`$CLAUDE_CONFIG_DIR/.claude.json` when the variable is set and to
`$HOME/.claude.json` when it is not, and a machine whose real account lives in
the legacy `$HOME/.claude.json` answers correctly with the variable unset and
fails with `Claude configuration file not found` the moment something sets it to
`~/.claude`. `configDir: null` means that case, and the poll must `delete` the
key rather than assign `undefined` — assigning it still passes the key to the
child. This also fixes a bug that predates accounts: the poll inherited
`process.env`, so the screen reported whichever account the shell that launched
the daemon happened to be in, with nothing on screen saying so.

Accounts are declared in `${STATE_DIR}/usage-accounts.json` (`daemon/src/usage-accounts.js`),
detected once on first run and stable thereafter. Detection accepts a candidate
only if its `.claude.json` carries `oauthAccount.emailAddress`, which is what
tells a signed-in config from the stub `~/.claude/.claude.json` a legacy layout
leaves behind — no directory needs special-casing. `GET`/`POST /api/usage/accounts`
edit the list from the control page; a re-detect merges rather than replaces, so
a renamed label and a disabled account survive it.

Each account has its own reading, its own anti-flap state (`reconcileUsage`'s
`lowSeen` rides on the limits of that account's reading) and its own persisted
figure, so an account that is signed out or misconfigured can never blank the
screen for the rest. Two further consequences worth knowing:

- **Polls are staggered**, not parallel or sequential: a run takes 20-45s, so two
  back to back would overrun the 60s window, while firing them together doubles
  the number of concurrent `claude` processes rewriting the session registry the
  poller reads. Account *i* of *n* starts at `i × (60s / n)`.
- **A structurally failing account backs off** to 15 minutes after three
  consecutive `config`/`auth` failures, and a missing config dir is never polled
  at all. Otherwise a signed-out account spends a 45s `claude` boot every minute
  on a foregone conclusion. Timeouts are transient and never back off; one good
  reading restores the nominal interval.

State machine (daemon-side): `busy` while tool/response activity within 10 s;
`attention` when pending permission or waiting for user input; `celebrate` for
20 s after a Stop with no pending input, then `idle`; `idle` otherwise.

## Permission flow

1. Claude Code `PermissionRequest` hook POSTs to daemon `/hook/PermissionRequest`
   (hook timeout configured 60 s; daemon holds ≤55 s).
2. Daemon emits `claude.permission.request`; device auto-surfaces the screen.
3. Device sends `claude.permission.answer`; daemon responds to the held hook
   request with `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}`
   and emits `claude.permission.resolved`.
4. At 55 s with no answer: daemon responds `behavior:"ask"` (falls back to the
   terminal prompt — never auto-denies) and emits `resolved{timeout}`.

## Hardware note

Nocturne 4.1 ships stock: `claude.*` needs no daemon patch. The daemon owns no
method allow-list — `handle_incoming_message` answers the methods it implements
and forwards **everything else** verbatim to whichever companion the most recent
`app.ready` registered (`crates/daemon/src/http/websocket.rs`), so `claude.*`
reaches the Mac app unmodified. Phone→UI **events** are likewise passed through
untouched.

Two consequences of that registry worth knowing on hardware:

- Only one companion route is active at a time and the newest `app.ready` wins,
  so an iPhone connecting after the Mac steals the route and silences
  `claude.*`. Check this first if the device goes quiet.
- With no companion registered, unknown methods answer `"No active app
  session"` rather than `"Unknown method"` — the latter is the companion's own
  fallthrough, so seeing it means the forward path is working.

Before 4.1 this required patching the daemon's allow-list; that patch is gone.
