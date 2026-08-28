/**
 * web_search — the chat surface's one tool (v1.23).
 *
 * GET-shaped reads of public result pages across a 3-engine fallback chain
 * (DuckDuckGo Lite HTML → Bing News RSS → r.jina.ai reader over DDG). No API
 * keys. The request only ever carries the query string, which is exactly what
 * the authority gate audits (`network/web_search:<query>`).
 *
 * Chain order was set by LIVE probes from a real deployment environment
 * (2026-08-28): html.duckduckgo.com connection-fails from datacenter IPs,
 * Brave 429s on the undici fetch fingerprint; lite.duckduckgo.com, Bing RSS
 * and r.jina.ai all answer 200. The chain tries in order and an engine that
 * is challenged simply yields zero rows to the next — never fabricated data.
 *
 * Fail-closed: if every engine fails, the model receives an honest error and
 * is instructed to answer from its own knowledge.
 *
 * Deliberately dependency-free (pure module): probeable directly under Node
 * type-stripping, same discipline as lib/markdown.ts.
 */

export const WEB_SEARCH_TIMEOUT_MS = 12_000;
export const WEB_SEARCH_MAX_RESULTS = 6;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

async function fetchEngine(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, ...(init?.headers as Record<string, string>) },
      signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
      ...init,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: '' };
  }
}

/** DDG wraps outbound links in /l/?uddg=<encoded>; unwrap to the real URL. */
function unwrapDdgUrl(href: string): string {
  try {
    const u = new URL(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return u.toString();
  } catch {
    return href;
  }
}

/* ---- Engine 1: DuckDuckGo Lite (table markup, href precedes class) ---- */

function parseDdgLite(html: string): WebResult[] {
  const results: WebResult[] = [];
  // Attribute order varies — capture the whole attr blob, then extract href.
  const anchor = /<a\s+([^>]*class=["']result-link["'][^>]*)>([\s\S]*?)<\/a>/g;
  const snippet = /<td[^>]*class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/g;
  const snippetList: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippet.exec(html)) !== null && snippetList.length < WEB_SEARCH_MAX_RESULTS + 4) {
    snippetList.push(stripTags(sm[1]));
  }
  let rm: RegExpExecArray | null;
  while ((rm = anchor.exec(html)) !== null && results.length < WEB_SEARCH_MAX_RESULTS) {
    const href = rm[1].match(/href=["']([^"']+)["']/)?.[1] ?? '';
    const title = stripTags(rm[2]);
    const url = unwrapDdgUrl(href);
    if (!title || !/^https?:\/\//.test(url)) continue;
    results.push({ title, url, snippet: snippetList[results.length] ?? '' });
  }
  return results;
}

/* ---- Engine 2: Bing RSS (stable XML, no bot challenge observed) ---- */

function parseBingRss(xml: string): WebResult[] {
  const results: WebResult[] = [];
  const item = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = item.exec(xml)) !== null && results.length < WEB_SEARCH_MAX_RESULTS) {
    const block = m[1];
    const title = stripTags(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const url = stripTags(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const snippet = stripTags(block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '');
    if (!title || !/^https?:\/\//.test(url)) continue;
    results.push({ title, url, snippet: snippet.slice(0, 300) });
  }
  return results;
}

/* ---- Engine 3: r.jina.ai reader over DDG (markdown output) ---- */

function parseJinaMarkdown(markdown: string): WebResult[] {
  const results: WebResult[] = [];
  const link = /\[([^\]\n]{4,150})\]\((https?:\/\/[^\)\s]+)\)/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = link.exec(markdown)) !== null && results.length < WEB_SEARCH_MAX_RESULTS) {
    const title = decodeEntities(m[1]).trim();
    const url = m[2];
    if (/duckduckgo\.com|jina\.ai|w3\.org/.test(url)) continue;
    const key = url.split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ title, url, snippet: '' });
  }
  return results;
}

/* ---- Chain ---- */

async function searchDdgLite(q: string): Promise<WebResult[]> {
  const r = await fetchEngine(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`);
  if (r.status === 202 || r.status === 403 || r.status === 429 || !r.ok) return [];
  return parseDdgLite(r.body);
}

async function searchBing(q: string): Promise<WebResult[]> {
  const r = await fetchEngine(`https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&count=${WEB_SEARCH_MAX_RESULTS}`);
  if (!r.ok) return [];
  return parseBingRss(r.body);
}

async function searchJina(q: string): Promise<WebResult[]> {
  const r = await fetchEngine(`https://r.jina.ai/https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return parseJinaMarkdown(r.body);
}

export async function runWebSearch(query: string): Promise<string> {
  const trimmed = query.trim().slice(0, 400);
  if (!trimmed) throw new Error('web_search: query is required.');

  const engines: Array<{ name: string; run: () => Promise<WebResult[]> }> = [
    { name: 'duckduckgo-lite', run: () => searchDdgLite(trimmed) },
    { name: 'bing-rss', run: () => searchBing(trimmed) },
    { name: 'jina-reader', run: () => searchJina(trimmed) },
  ];

  const failures: string[] = [];
  for (const engine of engines) {
    let results: WebResult[] = [];
    try {
      results = await engine.run();
    } catch {
      results = [];
    }
    if (results.length > 0) {
      const body = results
        .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet || '(no snippet)'}`)
        .join('\n\n');
      return `Web results for: ${trimmed} (via ${engine.name})\n\n${body}`;
    }
    failures.push(engine.name);
  }

  throw new Error(
    `web_search: all search engines failed or challenged this request (${failures.join(', ')}). ` +
      'Answer from your own knowledge and clearly tell the user the web search was unavailable.',
  );
}
