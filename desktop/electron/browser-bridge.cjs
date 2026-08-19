'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const MAX_PROFILE_NAME_LENGTH = 80;
const MAX_BROWSER_NAME_LENGTH = 80;
const MAX_VERSION_LENGTH = 40;

function cleanLabel(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const label = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
  return label || fallback;
}

function loadPreferredBrowserId(preferencePath) {
  if (!preferencePath) return null;
  try {
    if (!existsSync(preferencePath)) return null;
    const value = JSON.parse(readFileSync(preferencePath, 'utf8'));
    return typeof value.browserId === 'string' && value.browserId.length > 0 ? value.browserId : null;
  } catch (error) {
    console.warn('[browser-bridge] could not read browser preference:', error);
    return null;
  }
}

function savePreferredBrowserId(preferencePath, browserId) {
  if (!preferencePath) return;
  try {
    mkdirSync(path.dirname(preferencePath), { recursive: true });
    writeFileSync(preferencePath, JSON.stringify({ browserId }, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error('[browser-bridge] could not persist browser preference:', error);
    throw error;
  }
}

function startBrowserBridge({ port = 4321, token, preferencePath } = {}) {
  const connections = new Map();
  const pending = new Map();
  let preferredBrowserId = loadPreferredBrowserId(preferencePath);

  const sendJson = (res, status, value) => {
    const body = JSON.stringify(value);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': 'http://127.0.0.1:3100',
    });
    res.end(body);
  };

  const isAuthorized = (req) => req.headers['x-xeo-browser-token'] === token;

  const connectionState = (connection) => ({
    browserId: connection.browserId,
    profileName: connection.profileName,
    browserName: connection.browserName,
    extensionVersion: connection.extensionVersion,
    userAgent: connection.userAgent,
    connected: connection.socket.readyState === 1,
    tab: connection.tab,
    permissions: connection.permissions,
    updatedAt: connection.updatedAt,
  });

  const state = () => {
    const profiles = [...connections.values()].map(connectionState);
    const selected = preferredBrowserId ? profiles.find((profile) => profile.browserId === preferredBrowserId) || null : null;
    return {
      connected: Boolean(selected?.connected),
      selection: selected ? 'selected' : preferredBrowserId ? 'selected_disconnected' : 'selection_required',
      selectedBrowserId: preferredBrowserId,
      selectedProfile: selected,
      profiles,
      tab: selected?.tab || null,
      permissions: selected?.permissions || [],
      updatedAt: new Date().toISOString(),
    };
  };

  const rejectPendingForBrowser = (browserId, reason) => {
    for (const [id, item] of pending.entries()) {
      if (item.browserId !== browserId) continue;
      pending.delete(id);
      clearTimeout(item.timer);
      item.reject(new Error(reason));
    }
  };

  function selectedConnection() {
    if (!preferredBrowserId) throw new Error('No browser profile is selected. Connect an extension and choose it in Control Center.');
    const connection = connections.get(preferredBrowserId);
    if (!connection || connection.socket.readyState !== 1) {
      throw new Error('The selected browser profile is disconnected. Reconnect it or choose another profile.');
    }
    return connection;
  }

  function requestExtension(action, args) {
    let connection;
    try {
      connection = selectedConnection();
    } catch (error) {
      return Promise.reject(error);
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Browser action timed out: ${action}`));
      }, 30_000);
      pending.set(id, { resolve, reject, timer, browserId: connection.browserId });
      try {
        connection.socket.send(JSON.stringify({ type: 'command', id, action, args: args || {} }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function persistAndSelect(browserId) {
    if (typeof browserId !== 'string' || !connections.has(browserId)) {
      throw new Error('That browser profile is not connected.');
    }
    preferredBrowserId = browserId;
    savePreferredBrowserId(preferencePath, browserId);
    return state();
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': 'http://127.0.0.1:3100',
        'access-control-allow-headers': 'content-type, x-xeo-browser-token',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      });
      return res.end();
    }
    if (!isAuthorized(req)) return sendJson(res, 401, { error: 'Unauthorized browser bridge request.' });
    if (req.url === '/state' && req.method === 'GET') return sendJson(res, 200, state());
    if (req.url !== '/command' || req.method !== 'POST') return sendJson(res, 404, { error: 'Not found' });

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(raw || '{}');
        if (typeof payload.action !== 'string' || !/^[a-z_]+$/.test(payload.action)) {
          return sendJson(res, 400, { error: 'Invalid browser action.' });
        }
        const result = await requestExtension(payload.action, payload.args);
        return sendJson(res, 200, { ok: true, result });
      } catch (error) {
        return sendJson(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (candidate) => {
    const connection = {
      browserId: crypto.randomUUID(),
      profileName: 'Browser profile',
      browserName: 'Chromium browser',
      extensionVersion: 'unknown',
      userAgent: '',
      socket: candidate,
      tab: null,
      permissions: [],
      updatedAt: new Date().toISOString(),
    };
    connections.set(connection.browserId, connection);
    if (!preferredBrowserId || (!connections.has(preferredBrowserId) && connections.size === 1)) {
      preferredBrowserId = connection.browserId;
      try {
        savePreferredBrowserId(preferencePath, preferredBrowserId);
      } catch (error) {
        console.error('[browser-bridge] initial browser selection failed:', error);
      }
    }

    const publishConnection = (message) => {
      if (message && typeof message === 'object') {
        const metadata = message.state && typeof message.state === 'object' ? { ...message.state, ...message } : message;
        const announcedId = typeof metadata.browserId === 'string' && metadata.browserId.length > 0
          ? metadata.browserId.slice(0, 120)
          : connection.browserId;
        if (announcedId !== connection.browserId) {
          const previousBrowserId = connection.browserId;
          const existing = connections.get(announcedId);
          if (existing && existing !== connection && existing.socket.readyState === 1) {
            existing.socket.close(1008, 'This browser profile is already connected.');
            rejectPendingForBrowser(existing.browserId, 'The browser profile reconnected from another extension instance.');
          }
          connections.delete(previousBrowserId);
          connection.browserId = announcedId;
          connections.set(connection.browserId, connection);
          if (preferredBrowserId === previousBrowserId) {
            preferredBrowserId = announcedId;
            try {
              savePreferredBrowserId(preferencePath, preferredBrowserId);
            } catch (error) {
              console.error('[browser-bridge] browser preference migration failed:', error);
            }
          }
        }
        connection.profileName = cleanLabel(metadata.profileName, 'Browser profile', MAX_PROFILE_NAME_LENGTH);
        connection.browserName = cleanLabel(metadata.browserName, 'Chromium browser', MAX_BROWSER_NAME_LENGTH);
        connection.extensionVersion = cleanLabel(metadata.extensionVersion, 'unknown', MAX_VERSION_LENGTH);
        connection.userAgent = cleanLabel(metadata.userAgent, '', 240);
        if (Array.isArray(metadata.permissions)) connection.permissions = metadata.permissions.filter((item) => typeof item === 'string').slice(0, 20);
        if (metadata.tab && typeof metadata.tab === 'object') connection.tab = metadata.tab;
        connection.updatedAt = new Date().toISOString();
      }
    };

    candidate.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'register' || message.type === 'state') {
          publishConnection(message);
          return;
        }
        if (message.type !== 'result' || typeof message.id !== 'string') return;
        const item = pending.get(message.id);
        if (!item || item.browserId !== connection.browserId) return;
        pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.ok) item.resolve(message.result);
        else item.reject(new Error(typeof message.error === 'string' ? message.error : 'Browser action failed.'));
      } catch (error) {
        console.warn('[browser-bridge] invalid extension message:', error);
      }
    });

    candidate.on('close', () => {
      if (connections.get(connection.browserId) === connection) connections.delete(connection.browserId);
      rejectPendingForBrowser(connection.browserId, 'The selected browser profile disconnected.');
    });
    candidate.on('error', (error) => console.warn('[browser-bridge] websocket error:', error));
  });

  server.on('upgrade', (req, socketStream, head) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/extension' || url.searchParams.get('token') !== token) {
      socketStream.destroy();
      return;
    }
    wss.handleUpgrade(req, socketStream, head, (client) => wss.emit('connection', client, req));
  });

  server.listen(port, '127.0.0.1');
  server.on('error', (error) => console.error('[browser-bridge] server error:', error));
  return {
    port,
    token,
    state,
    selectBrowser: persistAndSelect,
    close: () => {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('Browser bridge stopped.'));
      }
      pending.clear();
      for (const connection of connections.values()) connection.socket.close();
      connections.clear();
      wss.close();
      server.close();
    },
  };
}

module.exports = { startBrowserBridge };

if (require.main === module) {
  const token = process.env.XEO_BROWSER_TOKEN;
  if (!token) throw new Error('XEO_BROWSER_TOKEN is required');
  startBrowserBridge({
    port: Number(process.env.XEO_BROWSER_PORT || 4321),
    token,
    preferencePath: process.env.XEO_BROWSER_PREFERENCE_PATH,
  });
}
