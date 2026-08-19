import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOST, PORT, WEBPAGE_DIST, DAEMON_VERSION, DAEMON_ROOT } from './config.js';
import { detectAccounts, mergeDetected, normalizeAccounts, saveAccounts } from './usage-accounts.js';
import { log } from './log.js';
import {
  readSettings, setClockFormat, setLanguage, resolveClock24, resolveLang,
} from './settings.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// What the Settings page needs: the stored choices plus what "auto" currently
// resolves to for each, so the page can say which format and which language auto
// is giving today.
function statusSettings() {
  const settings = readSettings();
  return {
    clockFormat: settings.clockFormat,
    clock24: resolveClock24(settings),
    language: settings.language,
    lang: resolveLang(settings),
  };
}

// One writer per setting, keyed by the field the page posts. A patch applies
// only the keys it carries, so the page can send one without restating the
// other — and an unknown value is named in the 400 rather than reported as a
// generic failure.
const WRITERS = { clockFormat: setClockFormat, language: setLanguage };

export function createHttpServer({ hub, store, permissionBridge, sources, usage }) {
  const server = http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'POST') log('IN', `${req.method} ${req.url}`);

    // Hook ingestion: PermissionRequest is held; everything else is
    // acknowledged immediately and forwarded to session sources.
    // Accepts /hook/<event> (command hooks) and bare /hook (type:"http"
    // hooks — event read from the payload's hook_event_name).
    if (req.method === 'POST' && (url === '/hook' || url.startsWith('/hook/'))) {
      let payload = {};
      try { payload = JSON.parse(await readBody(req) || '{}'); } catch {}
      const event = url === '/hook'
        ? (payload.hook_event_name || 'unknown')
        : url.slice('/hook/'.length);

      if (event === 'PermissionRequest') {
        return permissionBridge.onHookRequest(payload, res);
      }
      sources.onHookEvent(event, payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }

    // Hook install/uninstall from the webpage's Settings page
    if (req.method === 'POST' && (url === '/api/hooks/install' || url === '/api/hooks/uninstall')) {
      const script = url.endsWith('install') ? 'install-hooks.js' : 'uninstall-hooks.js';
      try {
        const output = execFileSync(process.execPath, [path.join(DAEMON_ROOT, 'scripts', script)], {
          encoding: 'utf8',
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, output: output.trim() }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, output: String(err.stderr || err.message) }));
      }
    }

    // Device settings from the webpage's Settings page. Pushing a snapshot right
    // after the write is what makes the device flip in a frame instead of
    // waiting out the heartbeat — same move as the sessions.list handler.
    if (req.method === 'POST' && url === '/api/settings') {
      let payload = {};
      try { payload = JSON.parse(await readBody(req) || '{}'); } catch {}

      const keys = Object.keys(WRITERS).filter((k) => k in payload);
      if (!keys.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'no known setting in the body' }));
      }
      for (const key of keys) {
        if (!WRITERS[key](payload[key])) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `unknown ${key}` }));
        }
      }

      // The usage screen's labels are built at poll time, not at emit time, so a
      // language change alone would leave them in the old language for up to the
      // refresh window. Re-poll rather than wait it out; nothing else on the
      // device needs it, because everything else is drawn from the snapshot this
      // line pushes.
      if (keys.includes('language')) Promise.resolve(usage.refresh()).catch(() => {});

      hub.emit('claude.sessions.update', store.snapshot());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, settings: statusSettings() }));
    }

    // Which Claude accounts the usage screen measures. The declaration is a
    // plain list, so this is a read and a whole-list write rather than a CRUD
    // surface — there is nothing to reconcile per entry.
    if (url === '/api/usage/accounts') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ accounts: usage.accounts() }));
      }
      if (req.method === 'POST') {
        let list;
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          if (!Array.isArray(body.accounts) || !body.accounts.length) {
            throw new Error('accounts must be a non-empty array');
          }
          // Normalizing first means a request that would leave nothing usable is
          // rejected here rather than silently falling back to the default
          // account, which would look like the save had worked.
          list = normalizeAccounts(body.accounts);
          const ids = new Set(list.map((a) => a.id));
          if (ids.size !== body.accounts.length) {
            throw new Error('every account needs a distinct, usable id');
          }
          if (!list.some((a) => a.enabled)) throw new Error('at least one account must be enabled');
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
        }
        saveAccounts(list, Date.now());
        // Re-read rather than hand the poller the list we just built: reload is
        // the one path that also re-stages the readings and the poll schedule.
        usage.reload();
        log('US', `accounts saved: ${list.map((a) => a.id).join(', ')}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, accounts: usage.accounts() }));
      }
    }

    // Rescan the home directory for accounts that were not there when the
    // declaration was first written — a second `claude login` into a new config
    // dir. Merged, never replaced: a renamed label and a disabled account are
    // decisions a rescan has no business undoing.
    if (req.method === 'POST' && url === '/api/usage/accounts/redetect') {
      const merged = mergeDetected(usage.accounts(), detectAccounts());
      saveAccounts(merged, Date.now());
      usage.reload();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, accounts: usage.accounts() }));
    }

    if (url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        daemonVersion: DAEMON_VERSION,
        sessions: store.count(),
        pendingPermissions: permissionBridge.pendingCount(),
        clients: hub.rolesOnline(),
        connector: hub.connectorStatus(),
        sources: sources.status(),
        hooks: sources.hooksInstalled(),
        settings: statusSettings(),
        // The first thing to check when the usage screen shows the wrong figures,
        // or one column instead of two.
        usageAccounts: usage.accounts(),
      }));
    }

    // Webpage static (built) with SPA fallback
    const root = path.resolve(WEBPAGE_DIST);
    let file = path.resolve(root, '.' + (url === '/' ? '/index.html' : decodeURIComponent(url)));
    if (file === root || file.startsWith(root + path.sep)) {
      try {
        if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        const body = fs.readFileSync(file);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        return res.end(body);
      } catch {}
      try {
        const body = fs.readFileSync(path.join(root, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        return res.end(body);
      } catch {}
    }
    res.writeHead(404);
    res.end('claude-thing daemon: webpage not built (webpage/dist missing)');
  });

  server.on('upgrade', (req, socket, head) => {
    if ((req.url || '').split('?')[0] === '/ws') {
      hub.wss.handleUpgrade(req, socket, head, (ws) => {
        hub.wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      log('--', `http+ws on http://${HOST}:${PORT}  (ws path /ws)`);
      resolve(server);
    });
  });
}
