import { esc, topbar } from './helpers.js';
import { t } from '../i18n.js';

// Bluetooth management without leaving Claude mode. The daemon's bluetooth.*
// RPCs are device-local and already on our socket, so this is pure UI: a
// pairing-mode toggle, the paired-device list, and a per-device action menu.
// The list is fetched once on open and corrected by events — never polled,
// because nocturned's watchdog misreads bluetooth.devices.list during a
// session (carthing-knowledge/ui.md).

var WINDOW = 4;   // device rows visible under the toggle row

// One source of truth for the submenu, shared with main.js and the tests.
// FORGET is only reachable here: it needs two deliberate presses, because
// forgetting the only paired phone should not be one accidental button.
//
// These are tokens, not labels: main.js dispatches btAct() on the value and the
// menu marks FORGET as dangerous by comparing against it, so translating them
// would break both. menu() below draws t('bt.' + token).
export function btMenuActions(device) {
  return device && device.connected
    ? ['DISCONNECT', 'FORGET', 'CANCEL']
    : ['CONNECT', 'FORGET', 'CANCEL'];
}

export function renderBluetooth(state) {
  var devices = state.btDevices || [];
  var cursor = state.btIndex || 0;
  var bar = topbar(t('bar.bluetooth'), state.daemonConnected,
    devices.length ? String(devices.length) : '');

  var toggle =
    '<div class="btrow bttoggle' + (cursor === 0 ? ' selected' : '') +
    '" data-action="bt-toggle">' +
    '<span class="btname">' + t('bt.pairingMode') + '</span>' +
    '<span class="btpill' + (state.btDiscoverable ? ' on' : '') + '">' +
    t(state.btDiscoverable ? 'bt.discoverable' : 'bt.off') + '</span></div>';

  var body = '';
  if (!devices.length) {
    body = '<div class="btempty"><div class="btemptytitle">' + t('bt.empty.title') + '</div>' +
      '<div class="btemptysub">' + t('bt.empty.sub') + '</div></div>';
  } else {
    // cursor space: 0 = toggle, 1..n = devices. The toggle row never scrolls
    // away; the device list windows around the cursor like the question options.
    var devCursor = Math.max(0, cursor - 1);
    var start = Math.max(0, Math.min(devCursor - 1, devices.length - WINDOW));
    var shown = devices.slice(start, start + WINDOW);
    for (var i = 0; i < shown.length; i++) {
      body += deviceRow(shown[i], start + i + 1 === cursor, state.btBusy);
    }
    if (devices.length > WINDOW) {
      body += '<div class="btmore">' + (devCursor + 1) + ' / ' + devices.length +
        t('common.turnDialForMore') + '</div>';
    }
  }

  return '<div class="screen">' + bar +
    '<div class="btwrap">' + toggle + body + '</div>' +
    '<div class="bthint">' + t('bt.hint') + '</div>' +
    menu(state, devices) +
    '</div>';
}

function deviceRow(d, selected, busy) {
  var status = t(busy === d.address ? 'bt.working'
    : d.connected ? 'bt.connected' : 'bt.paired');
  return '<div class="btrow' + (selected ? ' selected' : '') +
    '" data-action="bt-device" data-id="' + esc(d.address) + '">' +
    '<span class="btlamp' + (d.connected ? ' on' : '') + '"></span>' +
    '<div class="btinfo"><div class="btname">' + esc(d.name || d.address) + '</div>' +
    '<div class="btaddr">' + esc(d.address) + '</div></div>' +
    '<span class="btstatus' + (d.connected ? ' connected' : '') + '">' +
    status + '</span></div>';
}

function menu(state, devices) {
  if (!state.btMenu) return '';
  var device = null;
  for (var i = 0; i < devices.length; i++) {
    if (devices[i].address === state.btMenu) { device = devices[i]; break; }
  }
  if (!device) return '';

  var actions = btMenuActions(device);
  var rows = '';
  for (var j = 0; j < actions.length; j++) {
    rows += '<div class="btact' + (j === state.btMenuIndex ? ' selected' : '') +
      (actions[j] === 'FORGET' ? ' danger' : '') +
      '" data-action="bt-menu-act" data-id="' + j + '">' + t('bt.' + actions[j]) + '</div>';
  }
  return '<div class="btmenuwrap"><div class="btmenu">' +
    '<div class="btmenutitle">' + esc(device.name || device.address) + '</div>' +
    rows + '</div></div>';
}

// Display-only overlay: the daemon's agent auto-accepts pairing, so there is
// no decision to make here — just show the code the phone is asking about.
export function renderBtPairing(p) {
  return '<div class="perm btpair"><span class="hazard"></span>' +
    '<div class="head"><span class="lamp attention"></span>' +
    '<span class="who">' + t('bt.pairingRequest') + '</span></div>' +
    '<div class="session">' + esc(p.name || p.address) + '</div>' +
    '<div class="btpin">' + esc(p.pin || '') + '</div>' +
    '<div class="btpairnote">' + t('bt.pairingNote') + '</div>' +
    '<div class="qhint">' + t('bt.backDismisses') + '</div></div>';
}
