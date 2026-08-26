import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserActionIsReadOnly, browserRequest } from '@/lib/agent/browser';
import { CHAT_TOOLS, PLANNING_TOOLS, schemasForMode } from '@/lib/agent/tools';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.XEO_BROWSER_TOKEN;
  delete process.env.XEO_BROWSER_PORT;
});

describe('local browser capability policy', () => {
  it('keeps inspection actions read-only', () => {
    expect(browserActionIsReadOnly('state')).toBe(true);
    expect(browserActionIsReadOnly('read_page')).toBe(true);
    expect(browserActionIsReadOnly('screenshot')).toBe(true);
    expect(browserActionIsReadOnly('navigate')).toBe(false);
    expect(browserActionIsReadOnly('click')).toBe(false);
    expect(browserActionIsReadOnly('type')).toBe(false);
  });

  it('withholds the browser from read-only modes entirely', () => {
    // The browser drives the user's real, logged-in session. That authority is
    // not the task's to exercise, so read-only modes do not get the tool at all
    // — not even for `state`/`read_page`. Chat and Planning inspect the
    // workspace; only Build can be granted the browser.
    expect(CHAT_TOOLS.has('browser')).toBe(false);
    expect(PLANNING_TOOLS.has('browser')).toBe(false);
    expect(schemasForMode('chat').some((tool) => tool.function.name === 'browser')).toBe(false);
    expect(schemasForMode('planning').some((tool) => tool.function.name === 'browser')).toBe(false);
    expect(schemasForMode('planning').some((tool) => tool.function.name === 'file_write')).toBe(false);
    // v1.20.1 (audit A1): todo_update left chat — a greeting that mutates the
    // checklist made the progress guard kill simple hellos. Planning keeps it
    // (plan checklists are its deliverable).
    expect(CHAT_TOOLS.has('todo_update')).toBe(false);
    expect(PLANNING_TOOLS.has('todo_update')).toBe(true);
  });

  it('permits a fully confirmed navigate/click/type smoke flow only on an allowlisted domain', async () => {
    process.env.XEO_BROWSER_TOKEN = 'test-token';
    process.env.XEO_BROWSER_PORT = '4321';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ browserPolicy: { interactionEnabled: true, allowedDomains: ['example.com'], allowSensitiveActions: true }, tab: { url: 'https://example.com' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { navigated: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ browserPolicy: { interactionEnabled: true, allowedDomains: ['example.com'], allowSensitiveActions: true }, tab: { url: 'https://example.com' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { clicked: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ browserPolicy: { interactionEnabled: true, allowedDomains: ['example.com'], allowSensitiveActions: true }, tab: { url: 'https://example.com' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { typed: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // navigate now carries confirmSensitive like click/type: moving the user's
    // real tab is a state change on the world, not an inspection.
    await expect(browserRequest('navigate', { url: 'https://example.com', confirmSensitive: true })).resolves.toEqual({ navigated: true });
    await expect(browserRequest('click', { selector: '#save', confirmSensitive: true })).resolves.toEqual({ clicked: true });
    await expect(browserRequest('type', { selector: '#name', text: 'Xeo', confirmSensitive: true })).resolves.toEqual({ typed: true });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('blocks an unconfirmed navigate', async () => {
    process.env.XEO_BROWSER_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ browserPolicy: { interactionEnabled: true, allowedDomains: ['example.com'], allowSensitiveActions: true }, tab: { url: 'https://example.com' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(browserRequest('navigate', { url: 'https://example.com' })).rejects.toThrow('explicit confirmation');
  });

  it('blocks interaction when the local policy is read-only', async () => {
    process.env.XEO_BROWSER_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ browserPolicy: { interactionEnabled: false, allowedDomains: ['example.com'] }, tab: { url: 'https://example.com' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(browserRequest('click', { selector: '#save', confirmSensitive: true })).rejects.toThrow('requires explicit browser interaction permission');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
