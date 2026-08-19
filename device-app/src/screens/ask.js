import { esc, isDestructive } from './helpers.js';
import { now } from '../clock.js';
import { t } from '../i18n.js';

// Fullscreen prompt view — the focused answer screen for a permission, opened
// from a session or from the queue. Unlike the queue this one keeps a
// countdown, because here you are acting against a live deadline rather than
// surveying what is waiting.
//
// Questions do not come here. One question ask is one terminal dialog and may
// hold several questions plus a review step, and that walk lives in the queue
// hero — in one place, not two (main.js sends any question route back there).
export function renderAsk(state, ask, choice) {
  return renderPermissionAsk(state, ask, choice);
}

function head(ask, label, klass) {
  var queue = state_queuePos();
  return '<span class="hazard' + (klass || '') + '"></span>' +
    countdown(ask) +
    '<div class="head"><span class="lamp attention"></span>' +
    '<span class="who">' + label + '</span>' +
    remaining(ask) +
    (queue ? '<span class="queuen">' + queue + '</span>' : '') + '</div>' +
    '<div class="session">' + esc(ask.sessionName || t('common.session')) +
    (ask.kind === 'permission' && ask.tool
      ? '<span class="stool">' + esc(ask.tool) + '</span>' : '') +
    '</div>';
}

function fractionLeft(ask) {
  if (!ask.timeoutMs || ask.expired) return null;
  var left = ask.createdTs + ask.timeoutMs - now();
  return Math.max(0, Math.min(1, left / ask.timeoutMs));
}

function countdown(ask) {
  var frac = fractionLeft(ask);
  if (frac === null) return '';
  var secs = Math.round((ask.createdTs + ask.timeoutMs - now()) / 1000);
  return '<div class="cdtrack"><span class="cdfill' + (secs <= 10 ? ' urgent' : '') +
    '" style="width:' + (frac * 100).toFixed(1) + '%"></span></div>';
}

function remaining(ask) {
  var frac = fractionLeft(ask);
  if (frac === null) return '';
  var secs = Math.max(0, Math.round((ask.createdTs + ask.timeoutMs - now()) / 1000));
  var text = secs >= 60
    ? t('ask.leftMinutes', { m: Math.round(secs / 60) })
    : t('ask.leftSeconds', { s: secs });
  return '<span class="cdtime' + (secs <= 10 ? ' urgent' : '') + '">' + text + '</span>';
}

// filled in by renderAsk callers via setQueueContext
var queueContext = { index: 0, total: 1 };
export function setQueueContext(index, total) {
  queueContext = { index: index, total: total };
}
function state_queuePos() {
  return queueContext.total > 1 ? (queueContext.index + 1) + ' / ' + queueContext.total : '';
}

function renderPermissionAsk(state, ask, choice) {
  // Nothing on the device can answer this any more: the hook's response is
  // spent, so allow/deny would write to a closed connection. Say where the
  // decision went and offer only dismissal.
  if (ask.expired) {
    return '<div class="perm expired">' + head(ask, t('queue.permission')) +
      '<div class="cmd">' + esc(ask.summary) + '</div>' +
      '<div class="expnote">' + t('common.hookTimedOut') + '</div>' +
      '<div class="actions">' +
      '<div class="pbtn dismiss selected" data-action="ask-skip">' +
      '<span class="a">' + t('ask.dismiss') + '</span><span class="h">' + t('common.back') + '</span></div>' +
      '</div></div>';
  }
  // The prompt screen honours the same two-press contract as the queue hero:
  // a destructive command names itself in the header, and its ALLOW arms on
  // the first press instead of firing.
  var nasty = isDestructive(ask);
  var armed = !!(state.armed && state.armed.id === ask.id);
  var kind = t(nasty ? 'queue.permissionDestructive' : 'queue.permission');
  var allowLabel = t(armed ? 'queue.pressAgain' : 'queue.allow');
  var allowHint = armed ? t('queue.cannotUndo')
    : nasty ? t('queue.pressTwice') : t('common.pressDial');
  return '<div class="perm' + (nasty ? ' destructive' : '') + '">' + head(ask, kind) +
    '<div class="cmd">' + esc(ask.summary) + '</div>' +
    '<div class="actions">' +
    '<div class="pbtn allow' + (choice === 0 ? ' selected' : '') + (armed ? ' armed' : '') +
    '" data-action="ask-choice" data-id="0">' +
    '<span class="a">' + allowLabel + '</span><span class="h">' + esc(allowHint) + '</span></div>' +
    '<div class="pbtn deny' + (choice === 1 ? ' selected' : '') + '" data-action="ask-choice" data-id="1">' +
    '<span class="a">' + t('queue.deny') + '</span><span class="h">' + t('common.preset4') + '</span></div>' +
    '<div class="pbtn dismiss' + (choice === 2 ? ' selected' : '') + '" data-action="ask-skip">' +
    '<span class="a">' + t('ask.skip') + '</span><span class="h">' + t('common.back') + '</span></div>' +
    '</div></div>';
}

