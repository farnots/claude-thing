import { esc, topbar, isDestructive } from './helpers.js';
import { now } from '../clock.js';
import {
  questionsOf, currentQuestion, picksAt, isPicked, hasDoneRow, answeredLabels,
} from '../answering.js';
import { t, tn } from '../i18n.js';

// Triage, not a list of equals: the ask you would answer next owns the page and
// carries its own actions, so a permission can be allowed without ever leaving
// this screen. Everything else stacks underneath as a preview of what's coming.
var STACK_MAX = 2;

export function renderQueue(state) {
  var bar = topbar(t('bar.queue'), state.daemonConnected, state.asks.length ? String(state.asks.length) : '');

  if (!state.asks.length) {
    return '<div class="screen">' + bar +
      '<div class="qempty"><span class="qemptysprite"></span>' +
      '<div class="qemptytitle">' + t('queue.empty.title') + '</div>' +
      '<div class="qemptysub">' + t('queue.empty.sub') + '</div></div></div>';
  }

  var index = Math.min(state.queueIndex, state.asks.length - 1);
  var heroAsk = state.asks[index];
  // A question is answered in place: its option list opens inside the hero
  // rather than routing to a whole-screen prompt for one press. A timed-out
  // question opens too — it is still up in the terminal and the daemon can
  // still type into it, and a multi-question ask has nowhere else to be walked.
  var answering = !!state.queueAnswering && heroAsk.kind === 'question';

  // While the list is open the stack rows give it their room; the footer keeps
  // the queue context alive so closing the list isn't a leap of faith.
  // An intent line costs the hero ~27px, so the stack gives one row back.
  var rows = '';
  if (!answering) {
    var stackMax = heroAsk.intent ? STACK_MAX - 1 : STACK_MAX;
    var rest = [];
    for (var i = 0; i < state.asks.length && rest.length < stackMax; i++) {
      if (state.asks[i].id !== heroAsk.id) rest.push(state.asks[i]);
    }
    for (var j = 0; j < rest.length; j++) rows += stackRow(rest[j]);
  }

  var foot, hint;
  if (answering) {
    var others = state.asks.length - 1;
    foot = others > 0 ? t('queue.moreWaiting', { n: others }) : t('queue.lastOne');
    // On a multiSelect the press toggles and pressing again just untoggles, so
    // the hint has to name what actually moves you on rather than imply the
    // press does.
    if (state.queueReview) hint = t('queue.hint.review');
    else if (hasDoneRow(currentQuestion(heroAsk, state))) hint = t('queue.hint.multi');
    else hint = t('queue.hint.single');
  } else {
    var shown = 1 + Math.min(STACK_MAX, state.asks.length - 1);
    foot = t('queue.waitingOnYou', { n: state.asks.length }) +
      (state.asks.length > shown ? t('queue.showing', { n: shown }) : '');
    hint = t('queue.hint.next');
  }

  return '<div class="screen">' + bar +
    '<div class="qwrap">' + hero(heroAsk, answering, state) + rows +
    '<div class="qfoot"><span>' + esc(foot) + '</span>' +
    '<span class="qfoothint">' + esc(hint) + '</span></div>' +
    '</div></div>';
}

function hero(a, answering, state) {
  var isQuestion = a.kind === 'question';
  var kindClass = isQuestion ? ' question' : '';
  var nasty = !isQuestion && !a.expired && isDestructive(a);
  // A question hero opens its options in place, timed out or not; only a
  // permission still routes to the prompt screen on tap.
  var action = isQuestion ? 'queue-answer' : 'open-ask';
  var kind = isQuestion ? questionKind(a, state, answering)
    : t(nasty ? 'queue.permissionDestructive' : 'queue.permission');
  // A command without intent is an approval made blind: what you asked for
  // sits right under the session name, and the layout pays for the line — the
  // name steps down and the stack loses a row (see renderQueue).
  var intent = a.intent
    ? '<div class="qintent">' + esc(a.intent) + '</div>' : '';
  return '<div class="qhero' + kindClass + (a.expired ? ' expired' : '') +
    (answering ? ' answering' : '') +
    (a.intent ? ' has-intent' : '') +
    (nasty ? ' destructive' : '') +
    '" data-action="' + action + '" data-id="' + esc(a.id) + '">' +
    '<span class="qhazard"></span>' +
    '<div class="qherobody">' +
    '<div class="qheroline"><span class="qkind">' + kind + '</span>' +
    '<span class="qwait">' + esc(waitLabel(a)) + '</span></div>' +
    '<div class="qherosession">' + esc(a.sessionName || t('common.session')) + '</div>' +
    intent +
    '<div class="qherosummary">' + esc(summarize(a, state, answering)) + '</div>' +
    (answering ? heroAnswering(a, state) : heroActions(a, isQuestion, nasty, state.armed)) +
    '</div></div>';
}

// The kind line carries where you are in the dialog, because a multi-question
// ask is several decisions deep and a card that just says QUESTION gives no
// way to tell the second from the third.
function questionKind(a, state, answering) {
  var total = questionsOf(a).length;
  if (answering && state.queueReview) return t('queue.questionReview');
  if (total < 2) return t('queue.question');
  var at = Math.min(state.queueQIndex, total - 1) + 1;
  return answering ? t('queue.questionOf', { at: at, total: total })
    : t('queue.questionParts', { total: total });
}

function heroAnswering(a, state) {
  return state.queueReview ? heroReview(a, state) : heroOptions(a, state);
}

// A timed-out permission has nothing left to press: the hook response is spent,
// so the chips are replaced by where the decision actually went.
function heroActions(a, isQuestion, nasty, armed) {
  // A timed-out QUESTION is not spent: the dialog is still up in the terminal
  // and the daemon can still type into it. So it says where it went and keeps
  // its chip. A timed-out permission has nothing left to press.
  if (a.expired && !isQuestion) {
    return '<div class="qactions"><div class="qexpired">' + t('common.hookTimedOut') + '</div></div>';
  }
  if (isQuestion) {
    var qs = questionsOf(a);
    var hint = qs.length > 1
      ? t('queue.questionsHint', { n: qs.length })
      : tn('queue.optionsHint', qs[0].options.length);
    return '<div class="qactions">' +
      (a.expired ? '<div class="qexpired">' + t('queue.timedOutOpen') + '</div>' : '') +
      chip('answer', t('queue.answer'), hint, true) +
      '</div>';
  }
  // A destructive command must not cost the same gesture as "read that file":
  // the chip starts as an outline that says so, and the first press only arms
  // it — filled danger, PRESS AGAIN — for a 4s window.
  var isArmed = !!(armed && armed.id === a.id);
  var allow;
  if (isArmed) {
    allow = chip('allow', t('queue.pressAgain'), t('queue.cannotUndo'), true, ' armed');
  } else if (nasty) {
    allow = chip('allow', t('queue.allow'), t('queue.pressTwice'), false, ' destructive');
  } else {
    allow = chip('allow', t('queue.allow'), t('common.pressDial'), true);
  }
  return '<div class="qactions">' + allow +
    chip('deny', t('queue.deny'), t('common.preset4'), false) +
    '</div>';
}

// All options at once, no 3-wide window: the rows flex to share whatever
// height the (shrunken) name and question leave, so the whole decision is on
// screen before the first dial turn.
//
// Unselected rows stay one clipped line each; the row under the cursor grows
// and stacks its label over its description with both wrapping, so the text
// you are about to commit to is read in full, not guessed from an ellipsis.
// Every dial turn re-renders the list, so the markup can differ per row.
function heroOptions(a, state) {
  var q = currentQuestion(a, state);
  var opts = (q && q.options) || [];
  var choice = state.queueChoice;
  var multi = hasDoneRow(q);
  var qi = Math.min(state.queueQIndex, questionsOf(a).length - 1);
  var html = '<div class="qopts">';
  for (var i = 0; i < opts.length; i++) {
    // On a multiSelect question the number is a toggle, not a commit, so the
    // row has to show its own state — otherwise picking three options looks
    // identical to picking none.
    var on = multi && isPicked(state, qi, i);
    var num = '<span class="qnum' + (on ? ' on' : '') + '">' +
      (on ? '✓' : (i + 1)) + '</span>';
    var desc = opts[i].description
      ? '<span class="qdesc">' + esc(opts[i].description) + '</span>' : '';
    var cls = 'qopt' + (i === choice ? ' selected' : '') + (on ? ' picked' : '');
    if (i === choice) {
      html += '<div class="' + cls + '" data-action="queue-choice" data-id="' + i + '">' +
        num + '<div class="qtext"><span class="qlabel">' + esc(opts[i].label) + '</span>' +
        desc + '</div></div>';
    } else {
      html += '<div class="' + cls + '" data-action="queue-choice" data-id="' + i + '">' +
        num + '<span class="qlabel">' + esc(opts[i].label) + '</span>' + desc +
        '</div>';
    }
  }
  if (multi) {
    // The only row that moves you on, so it has to read as an action rather
    // than a fourth thing to tick — and it names the hardware button that does
    // the same job, because a press on an option only ever toggles it.
    var n = picksAt(state, qi).length;
    html += '<div class="qopt qstep next' + (choice === opts.length ? ' selected' : '') +
      '" data-action="queue-choice" data-id="' + opts.length + '">' +
      '<span class="qnum">›</span><span class="qlabel">' + t('queue.done') + '</span>' +
      '<span class="qdesc">' + t('queue.selected', { n: n }) + '</span></div>';
  }
  return html + '</div>';
}

// The review step: every question with what it is currently answered as, and a
// SUBMIT row. This is the whole point of holding the answers locally — nothing
// has been typed into the terminal yet, so any row here is still changeable.
function heroReview(a, state) {
  var qs = questionsOf(a);
  var choice = state.queueChoice;
  var html = '<div class="qopts qreview">';
  for (var i = 0; i < qs.length; i++) {
    // "none" and "—" are different things: one is a multiSelect answered with
    // nothing ticked, the other is a question not yet reached.
    var chosen = answeredLabels(a, state, i) ||
      (qs[i].multiSelect ? t('queue.none') : '—');
    html += '<div class="qopt' + (i === choice ? ' selected' : '') +
      '" data-action="queue-review" data-id="' + i + '">' +
      '<span class="qnum">' + (i + 1) + '</span>' +
      '<div class="qtext"><span class="qlabel">' + esc(qs[i].header) + '</span>' +
      '<span class="qdesc">' + esc(chosen) + '</span></div></div>';
  }
  html += '<div class="qopt qstep submit' + (choice === qs.length ? ' selected' : '') +
    '" data-action="queue-review" data-id="' + qs.length + '">' +
    '<span class="qnum">✓</span><span class="qlabel">' + t('queue.submit') + '</span>' +
    '<span class="qdesc">' + t('queue.sendsAll', { n: qs.length }) + '</span></div>';
  return html + '</div>';
}

function chip(action, label, hint, filled, extra) {
  return '<div class="qchip ' + action + (filled ? ' filled' : '') + (extra || '') +
    '" data-action="queue-' + action + '">' +
    '<span class="qchiplabel">' + label + '</span>' +
    '<span class="qchiphint">' + esc(hint) + '</span></div>';
}

// Tapping a stack row promotes it to hero rather than opening the prompt: the
// hero is where every ask is now answerable, so that is where a tap should
// land it.
function stackRow(a) {
  var isQuestion = a.kind === 'question';
  return '<div class="qrow' + (isQuestion ? ' question' : '') +
    '" data-action="queue-promote" data-id="' + esc(a.id) + '">' +
    '<span class="qrail"></span>' +
    '<span class="qrowkind">' + t(isQuestion ? 'queue.question' : 'queue.rowPermission') + '</span>' +
    '<span class="qrowsession">' + esc(a.sessionName || t('common.session')) + '</span>' +
    '<span class="qrowsummary">' + esc(summarize(a)) + '</span>' +
    '<span class="qrowwait">' + esc(waitLabel(a)) + '</span>' +
    '</div>';
}

// While a group is being walked the summary is the question actually on
// screen, not the first one — the header line says which of them it is.
function summarize(a, state, answering) {
  if (a.kind !== 'question') return a.tool + '  ·  ' + a.summary;
  if (!answering) return a.question;
  if (state.queueReview) return t('queue.checkAnswers');
  var q = currentQuestion(a, state);
  return q ? q.question : a.question;
}

// How long it has been waiting, never how long is left. A countdown turns a
// prompt into a deadline you can lose; the prompt screen is where a live
// deadline belongs, because that is where you are acting against it.
function waitLabel(a) {
  if (a.expired) return t('queue.inTerminal');
  var secs = Math.max(0, Math.round((now() - a.createdTs) / 1000));
  var d = secs < 60
    ? t('unit.seconds', { s: secs })
    : t('unit.minutes', { m: Math.round(secs / 60) });
  return t('queue.waiting', { d: d });
}
