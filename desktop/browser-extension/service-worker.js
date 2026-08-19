let socket;
let reconnectTimer;

async function config() {
  return chrome.storage.local.get({ port: 4321, token: '' });
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error('No active browser tab is available.');
  return tab;
}

async function sendState() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const tab = await activeTab().catch(() => null);
  socket.send(JSON.stringify({
    type: 'state',
    state: {
      connected: true,
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      permissions: ['read_page', 'screenshot'],
    },
  }));
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 2000);
}

async function connect() {
  const { port, token } = await config();
  if (!token) return;
  try {
    socket?.close();
    socket = new WebSocket(`ws://127.0.0.1:${Number(port) || 4321}/extension?token=${encodeURIComponent(token)}`);
    socket.addEventListener('open', sendState);
    socket.addEventListener('message', (event) => handleCommand(JSON.parse(event.data)));
    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', scheduleReconnect);
  } catch {
    scheduleReconnect();
  }
}

async function readPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || '').slice(0, 30000),
      links: Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({
        text: (link.textContent || '').trim().slice(0, 200),
        href: link.href,
      })),
    }),
  });
  return result;
}

async function screenshot(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }), url: tab.url, title: tab.title };
}

async function handleCommand(message) {
  if (!message || message.type !== 'command' || typeof message.id !== 'string') return;
  try {
    const tab = await activeTab();
    let result;
    if (message.action === 'state') {
      result = { tab: { id: tab.id, url: tab.url, title: tab.title } };
    } else if (message.action === 'read_page') {
      result = await readPage(tab.id);
    } else if (message.action === 'screenshot') {
      result = await screenshot(tab.id);
    } else {
      throw new Error('This browser action is disabled until the user grants interaction permission.');
    }
    socket.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result }));
  } catch (error) {
    socket?.send(JSON.stringify({ type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.alarms?.create('xeo-browser-heartbeat', { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === 'xeo-browser-heartbeat') { connect(); sendState(); } });
connect();
