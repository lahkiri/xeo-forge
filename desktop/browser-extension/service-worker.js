let socket;
let reconnectTimer;

async function config() {
  const stored = await chrome.storage.local.get({ port: 4321, token: '', browserId: '', profileName: '' });
  let browserId = stored.browserId;
  if (typeof browserId !== 'string' || browserId.length < 16) {
    browserId = crypto.randomUUID();
    await chrome.storage.local.set({ browserId });
  }
  return {
    port: Number(stored.port) || 4321,
    token: typeof stored.token === 'string' ? stored.token : '',
    browserId,
    profileName: typeof stored.profileName === 'string' && stored.profileName.trim() ? stored.profileName.trim().slice(0, 80) : 'Browser profile',
  };
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error('No active browser tab is available.');
  return tab;
}

function browserName() {
  const agent = navigator.userAgent;
  if (/Edg\//i.test(agent)) return 'Microsoft Edge';
  if (/OPR\//i.test(agent)) return 'Opera';
  if (/Brave/i.test(agent)) return 'Brave';
  if (/Chrome\//i.test(agent)) return 'Google Chrome';
  if (/Chromium\//i.test(agent)) return 'Chromium';
  return 'Chromium browser';
}

async function sendState(type = 'state') {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const settings = await config();
  const tab = await activeTab().catch(() => null);
  socket.send(JSON.stringify({
    type,
    browserId: settings.browserId,
    profileName: settings.profileName,
    browserName: browserName(),
    extensionVersion: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
    permissions: ['state', 'read_page', 'screenshot'],
  }));
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 2000);
}

async function connect() {
  const settings = await config();
  if (!settings.token) return;
  try {
    socket?.close();
    socket = new WebSocket(`ws://127.0.0.1:${settings.port}/extension?token=${encodeURIComponent(settings.token)}`);
    socket.addEventListener('open', () => sendState('register'));
    socket.addEventListener('message', (event) => handleCommand(JSON.parse(event.data)));
    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', scheduleReconnect);
  } catch (error) {
    console.warn('[xeo-browser] connection failed:', error);
    scheduleReconnect();
  }
}

async function readPage(tabId, policy = {}) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [policy.redactSensitiveData !== false],
    func: (redact) => {
      const clean = (value) => {
        const text = String(value || '');
        if (!redact) return text;
        return text
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
          .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD]')
          .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, '[REDACTED_PHONE]')
          .replace(/\b(?:sk|pk|api|token|secret)[_-]?[a-z0-9]{12,}\b/gi, '[REDACTED_SECRET]');
      };
      return {
        url: location.href,
        title: clean(document.title),
        text: clean(document.body?.innerText || '').slice(0, 30000),
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({
          text: clean(link.textContent || '').slice(0, 200),
          href: redact ? new URL(link.href).origin + new URL(link.href).pathname : link.href,
        })),
      };
    },
  });
  return result;
}

async function clickElement(tabId, selector) {
  if (typeof selector !== 'string' || !selector.trim()) throw new Error('A CSS selector is required for click.');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [selector],
    func: (value) => {
      const element = document.querySelector(value);
      if (!element) return { clicked: false, reason: 'Element not found.' };
      element.click();
      return { clicked: true, tag: element.tagName, text: (element.textContent || '').trim().slice(0, 160) };
    },
  });
  return result;
}

async function typeIntoElement(tabId, selector, text) {
  if (typeof selector !== 'string' || !selector.trim()) throw new Error('A CSS selector is required for type.');
  if (typeof text !== 'string') throw new Error('Text is required for type.');
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [selector, text],
    func: (value, nextText) => {
      const element = document.querySelector(value);
      if (!element) return { typed: false, reason: 'Element not found.' };
      if (!('value' in element)) return { typed: false, reason: 'Element is not an editable control.' };
      element.focus();
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
      descriptor?.set?.call(element, nextText);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true, tag: element.tagName };
    },
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
    const policy = message.policy && typeof message.policy === 'object' ? message.policy : {};
    if (message.action === 'state') {
      result = { tab: { id: tab.id, url: tab.url, title: tab.title } };
    } else if (message.action === 'read_page') {
      result = await readPage(tab.id, policy);
    } else if (message.action === 'screenshot') {
      result = await screenshot(tab.id);
    } else if (message.action === 'navigate') {
      const url = message.args?.url;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only http(s) navigation is allowed.');
      await chrome.tabs.update(tab.id, { url });
      result = { navigated: true, url };
    } else if (message.action === 'click') {
      result = await clickElement(tab.id, message.args?.selector);
    } else if (message.action === 'type') {
      result = await typeIntoElement(tab.id, message.args?.selector, message.args?.text);
    } else {
      throw new Error('Unknown browser action.');
    }
    socket.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result }));
  } catch (error) {
    socket?.send(JSON.stringify({ type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.tabs.onActivated.addListener(() => sendState());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) sendState();
});
chrome.alarms?.create('xeo-browser-heartbeat', { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === 'xeo-browser-heartbeat') { connect(); sendState(); } });
connect();
