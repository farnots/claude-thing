// The interface, in the language it was written in. This file is the reference:
// fr.js carries the same keys, and test/i18n.test.js fails if it does not.
//
// Keys are prefixed by where they are drawn. A few are shared on purpose
// (common.*), because two screens saying the same sentence differently is a
// drift waiting to happen.
//
// Uppercase is part of the string, not a CSS transform — styles.css has no
// text-transform anywhere — so a translation writes its own capitals, accents
// included.

export var en = {
  // ---- shared ----
  'common.turnDialForMore': ' · turn dial for more',
  'common.session': 'session',
  'common.back': 'back',
  'common.preset4': 'preset 4',
  'common.pressDial': 'press dial',
  'common.hookTimedOut': 'HOOK TIMED OUT — ANSWER IN TERMINAL',

  // ---- top bars ----
  'bar.sessions': 'SESSIONS',
  'bar.session': 'SESSION',
  'bar.queue': 'QUEUE',
  'bar.usage': 'USAGE',
  'bar.bluetooth': 'BLUETOOTH',

  // ---- chrome outside #app ----
  'chrome.daemonOffline': 'DAEMON OFFLINE — CHECK MAC CONNECTOR',

  // ---- units ----
  // The device has no Intl, so durations are assembled here. French writes
  // "1 h 35" and "35 min", which is why the shape is a string and not a suffix.
  'unit.minutes': '{m}m',
  'unit.hoursMinutes': '{h}h {m}m',
  'unit.seconds': '{s}s',

  // ---- session state, permission mode, effort ----
  // Display only. The class names that ride alongside these are built from the
  // stable token, never from the text — see modeChip() in session-list.js.
  'state.IDLE': 'IDLE',
  'state.ENDED': 'ENDED',
  'state.WORKING': 'WORKING',
  'state.ATTENTION': 'ATTENTION',
  'state.DONE': 'DONE',

  'mode.PLAN': 'PLAN',
  'mode.BYPASS': 'BYPASS',
  'mode.EDITS': 'EDITS',
  'mode.AUTO': 'AUTO',
  'mode.MANUAL': 'MANUAL',

  'effort.LOW': 'LOW',
  'effort.MEDIUM': 'MEDIUM',
  'effort.HIGH': 'HIGH',
  'effort.XHIGH': 'XHIGH',
  'effort.MAX': 'MAX',
  'effort.ULTRA': 'ULTRA',

  // ---- ambient ----
  'ambient.needsYou.one': '{n} NEEDS YOU',
  'ambient.needsYou.other': '{n} NEED YOU',
  'ambient.nothingBlocked': 'NOTHING BLOCKED',
  'ambient.caption': '{working} WORKING · {resting} RESTING',
  'ambient.tokensOut': '{tokens} tokens out',
  'ambient.hintAnswer': 'press dial to answer',
  'ambient.hintSessions': 'press dial for sessions',
  // The session-window strip. `ambient.session` names the row when there is
  // only one account and no account name to put there.
  'ambient.session': 'SESSION',
  'ambient.resetDue': 'RESET DUE',
  'ambient.noReading': 'NO READING',

  // ---- session list ----
  'list.empty': 'NO SESSIONS — START CLAUDE ON YOUR MAC',
  'list.context': 'CONTEXT',
  'list.needsAnswer': 'needs your answer',
  'list.finishedAgo': 'finished {d} ago',
  'list.working': 'working…',

  // ---- session detail ----
  'detail.loading': 'LOADING…',
  'detail.contextUsed': 'context used',
  'detail.toolWorking': '{tool} — working',
  'detail.noTool': 'no active tool',
  'detail.tokensOut': 'tokens out',
  'detail.tokensIn': 'tokens in',
  'detail.cacheRead': 'cache read',
  'detail.state': 'state',

  // ---- queue ----
  'queue.empty.title': 'NOTHING WAITING ON YOU',
  'queue.empty.sub': 'permissions and questions land here',
  'queue.moreWaiting': '{n} more waiting',
  'queue.lastOne': 'last one',
  'queue.hint.review': 'dial moves · press edits or submits · back returns',
  'queue.hint.multi': 'press picks · preset 4 when done',
  'queue.hint.single': 'dial moves · press answers · back closes',
  'queue.hint.next': 'turn dial or swipe for the next one',
  'queue.waitingOnYou': '{n} waiting on you',
  'queue.showing': ' · showing {n}',
  'queue.permission': 'PERMISSION REQUEST',
  'queue.permissionDestructive': 'PERMISSION REQUEST · DESTRUCTIVE',
  'queue.question': 'QUESTION',
  'queue.questionReview': 'QUESTION · REVIEW',
  'queue.questionOf': 'QUESTION · {at} OF {total}',
  'queue.questionParts': 'QUESTION · {total} PARTS',
  'queue.rowPermission': 'PERMISSION',
  'queue.timedOutOpen': 'TIMED OUT — STILL OPEN IN TERMINAL',
  'queue.questionsHint': '{n} questions · press dial',
  'queue.optionsHint.one': '{n} option · press dial',
  'queue.optionsHint.other': '{n} options · press dial',
  'queue.answer': 'ANSWER',
  'queue.allow': 'ALLOW',
  'queue.deny': 'DENY',
  'queue.pressAgain': 'PRESS AGAIN',
  'queue.cannotUndo': 'this cannot be undone',
  'queue.pressTwice': 'press twice · destructive',
  'queue.done': 'DONE',
  'queue.selected': '{n} selected · preset 4',
  'queue.submit': 'SUBMIT',
  'queue.sendsAll': 'sends all {n} answers',
  'queue.none': 'none',
  'queue.checkAnswers': 'check your answers before they go',
  'queue.inTerminal': 'in terminal',
  'queue.waiting': 'waiting {d}',

  // ---- permission prompt ----
  'ask.dismiss': 'DISMISS',
  'ask.skip': 'SKIP',
  'ask.leftMinutes': '{m}m left',
  'ask.leftSeconds': '{s}s left',

  // ---- bluetooth ----
  // The menu actions are keyed by their stable token: btMenuActions() returns
  // DISCONNECT / CONNECT / FORGET / CANCEL and main.js dispatches on them, so
  // only their drawn text lives here.
  'bt.DISCONNECT': 'DISCONNECT',
  'bt.CONNECT': 'CONNECT',
  'bt.FORGET': 'FORGET',
  'bt.CANCEL': 'CANCEL',
  'bt.pairingMode': 'PAIRING MODE',
  'bt.discoverable': 'DISCOVERABLE',
  'bt.off': 'OFF',
  'bt.empty.title': 'NO PAIRED DEVICES',
  'bt.empty.sub': 'enter pairing mode to add your phone',
  'bt.hint': 'dial moves · press for actions · back leaves',
  'bt.working': 'WORKING…',
  'bt.connected': 'CONNECTED',
  'bt.paired': 'PAIRED',
  'bt.pairingRequest': 'PAIRING REQUEST',
  'bt.pairingNote': 'confirm this code on your phone — auto-accepting',
  'bt.backDismisses': 'back dismisses',

  // ---- usage ----
  'usage.reading': 'READING USAGE…',
  'usage.stale': 'STALE',
  'usage.staleSuffix': ' · stale',
  'usage.fromClaude': 'from claude /usage',
  'usage.skills': 'SKILLS',
  'usage.subagents': 'SUBAGENTS',
  'usage.pctOfUsage': '% of usage',
  'usage.moodOut': 'OUT OF USAGE',
  'usage.moodLow': 'RUNNING OUT',
  'usage.moodClear': 'ALL CLEAR',

  // ---- the answer on its way ----
  'inflight.typing': 'TYPING ON MAC',
  'inflight.sending': 'SENDING TO MAC',
  'inflight.backToUndo': '{label} · BACK TO UNDO',
  'inflight.answered': 'ANSWERED',
  'inflight.allow': 'ALLOW',
  'inflight.deny': 'DENY',

  // ---- toasts ----
  'toast.spriteOn': 'SPRITE ON',
  'toast.spriteOff': 'SPRITE OFF',
  'toast.dismissed': 'DISMISSED',
  'toast.pairingModeOn': 'PAIRING MODE ON',
  'toast.pairingModeOff': 'PAIRING MODE OFF',
  'toast.failed': 'FAILED',
  'toast.connected': 'CONNECTED',
  'toast.waitingForPhone': 'WAITING FOR PHONE',
  'toast.connectSent': 'CONNECT SENT',
  'toast.connectFailed': 'CONNECT FAILED',
  'toast.disconnected': 'DISCONNECTED',
  'toast.forgotten': 'FORGOTTEN',
  'toast.sendFailed': 'SEND FAILED',
  'toast.alreadyAnswered': 'ALREADY ANSWERED',
  'toast.answerThisFirst': 'ANSWER THIS ONE FIRST',
  'toast.restored': 'RESTORED',
  'toast.leftForTerminal': 'LEFT FOR THE TERMINAL',
  'toast.needsYou': 'NEEDS YOU',
  'toast.paired': 'PAIRED',
  'toast.pairingCancelled': 'PAIRING CANCELLED',

  // How far an answer got, from questionToast(). The daemon's `reason` strings
  // are matched in English on purpose — they are wire codes, not copy.
  'toast.answeredOnMac': 'ANSWERED ON MAC',
  'toast.focusedPress': 'FOCUSED — PRESS {n} ON MAC',
  'toast.focusedAnswer': 'FOCUSED — ANSWER ON MAC',
  'toast.gone': 'GONE — ANSWER IN TERMINAL',
  'toast.dialogChanged': 'DIALOG CHANGED — ANSWER ON MAC',
  'toast.copyMode': 'TMUX PANE IN COPY MODE — PRESS q',
  'toast.automationDenied': 'ALLOW AUTOMATION IN MAC SETTINGS',
  'toast.backgroundAgent': 'BACKGROUND AGENT — NO WINDOW',
  'toast.noTerminalWindow': 'NO TERMINAL WINDOW FOUND',
  'toast.couldNotAnswer': 'COULD NOT ANSWER',

  // How the daemon says a card was resolved. Protocol values, drawn as words —
  // anything not listed falls back to the raw value upper-cased.
  'resolution.allow': 'ALLOWED',
  'resolution.deny': 'DENIED',
  'resolution.answered': 'ANSWERED',
  'resolution.interrupted': 'INTERRUPTED',
};
