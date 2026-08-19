'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

function startBrowserBridge({ port = 4321, token }) {
  let socket = null;
  let currentState = {
    connected: false,
    tab: null,
    permissions: [],
    updatedAt: new Date().toISOString(),
  };
  const pending = new Map();

  const isAuthorized = (req) => req.headers['x-xeo-browser-token'] === token;
  const sendJson = (res, status, value) => {
    const body = JSON.stringify(value);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': 'http://127.0.0.1:3100',
    });
    res.end(body);
  };

  function publishState(next) {
    currentState = { ...currentState, ...next, updatedAt: new Date().toISOString() };
  }

  function requestExtension(action, args) {
    if (!socket || socket.readyState !== 1) {
      return Promise.reject(new Error('Browser extension is not connected.'));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Browser action timed out: ${action}`));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'command', id, action, args: args || {} }));
    });
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
    if (req.url === '/state' && req.method === 'GET') return sendJson(res, 200, currentState);
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
    if (socket && socket.readyState === 1) socket.close(1008, 'Replaced by a newer browser connection.');
    socket = candidate;
    publishState({ connected: true });
    candidate.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'state' && message.state && typeof message.state === 'object') {
          publishState(message.state);
          return;
        }
        if (message.type !== 'result' || typeof message.id !== 'string') return;
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.ok) item.resolve(message.result);
        else item.reject(new Error(typeof message.error === 'string' ? message.error : 'Browser action failed.'));
      } catch (error) {
        console.warn('[browser-bridge] invalid extension message', error);
      }
    });
    candidate.on('close', () => {
      if (socket === candidate) {
        socket = null;
        publishState({ connected: false });
      }
    });
    candidate.on('error', (error) => console.warn('[browser-bridge] websocket error', error));
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
  server.on('error', (error) => console.error('[browser-bridge] server error', error));
  return {
    port,
    token,
    state: () => currentState,
    close: () => {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('Browser bridge stopped.'));
      }
      pending.clear();
      socket?.close();
      wss.close();
      server.close();
    },
  };
}

module.exports = { startBrowserBridge };

if (require.main === module) {
  const token = process.env.XEO_BROWSER_TOKEN;
  if (!token) throw new Error('XEO_BROWSER_TOKEN is required');
  startBrowserBridge({ port: Number(process.env.XEO_BROWSER_PORT || 4321), token });
}
