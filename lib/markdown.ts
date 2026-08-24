/**
 * Markdown → HTML for assistant output. No dependencies.
 *
 * SECURITY MODEL (unchanged, load-bearing): HTML entities are escaped BEFORE
 * any markdown transformation, so model output — or untrusted MCP tool output
 * that reached a summary — can never inject markup. Every attribute value this
 * module writes (an href) is additionally quote-escaped and scheme-checked, and
 * link URLs are stripped of control characters BEFORE the scheme is inspected,
 * because URL parsers ignore embedded tabs/newlines (`java\tscript:`).
 *
 * The renderer is deliberately total: unknown constructs fall through as
 * escaped text, never as an exception inside a React tree.
 */

/** Sentinel-wrapped placeholders for protected inline-code spans. */
const CODE_PLACEHOLDER_START = '\u0001';
const CODE_PLACEHOLDER_END = '\u0002';

const MAX_TABLE_COLUMNS = 24;

export function renderMarkdown(text: string): string {
  if (!text) return '';

  // NUL would become U+FFFD in the DOM. \u0001/\u0002 are the placeholder
  // namespace below — stripping all three at entry makes a forged placeholder
  // structurally impossible, whatever the input contains.
  let src = text.replace(/[\u0000-\u0002]/g, '');

  // ESCAPE FIRST. Everything downstream operates on already-escaped text.
  src = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = src.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks: ``` or ~~~, optionally with a language tag. The
    // language tag is matched strictly (\w+ and a small extension set) so it
    // can never smuggle an attribute into the <code> element.
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (or EOF — an unclosed block still renders)
      out.push(`<pre class="code-block"><code${lang ? ` data-lang="${lang}"` : ''}>${body.join('\n')}</code></pre>`);
      continue;
    }

    // Headings.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      const inline = renderInline(heading[2]);
      // h4–h6 are rendered as h3 to keep the heading scale honest with the
      // product's typography.
      out.push(`<h${level}>${inline}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr/>');
      i++;
      continue;
    }

    // Table: a header row, then a |---|---| separator, then body rows.
    const table = parseTable(lines, i);
    if (table) {
      out.push(table.html);
      i = table.next;
      continue;
    }

    // Blockquote: consecutive `>` lines, rendered as one <blockquote>.
    // NOTE: on ESCAPED text the marker is `&gt;`. The quoted content is
    // rendered with the INLINE pass only — recursing into renderMarkdown would
    // double-escape the already-escaped inner text.
    if (/^\s*&gt;/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*&gt;/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(quoted.join('\n')).replace(/\n/g, '<br/>')}</blockquote>`);
      continue;
    }

    // Lists (ordered / unordered / one nesting level).
    const list = parseList(lines, i);
    if (list) {
      out.push(list.html);
      i = list.next;
      continue;
    }

    // Blank line.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: consecutive lines that are none of the above.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*&gt;/.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i]) &&
      !parseTable(lines, i)
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      out.push(`<p>${renderInline(para.join('\n')).replace(/\n/g, '<br/>')}</p>`);
    } else {
      i++; // defensive: always advance
    }
  }

  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Blocks                                                             */
/* ------------------------------------------------------------------ */

const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;

interface ParsedBlock {
  html: string;
  next: number;
}

/**
 * Parse a list block starting at `start`. Supports one level of nesting: an
 * item indented by 2+ spaces opens a nested list that closes when the
 * indentation returns. Deeper indentation collapses into the same nested level
 * — two visible levels are what the product renders, and inventing deeper
 * structure from whitespace would be guesswork presented as intent.
 */
function parseList(lines: string[], start: number): ParsedBlock | null {
  const first = lines[start].match(LIST_ITEM_RE);
  if (!first) return null;

  const ordered = /^\d/.test(lines[start].trim());
  const tag = ordered ? 'ol' : 'ul';
  const items: Array<{ text: string[]; nested: string[] }> = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM_RE);
    if (!m) {
      // A continuation line of the current item (no blank line before it).
      if (items.length > 0 && lines[i].trim() !== '' && !/^\s*(```|~~~)/.test(lines[i]) && !/^\s*&gt;/.test(lines[i])) {
        items[items.length - 1].text.push(lines[i].trim());
        i++;
        continue;
      }
      break;
    }
    const indent = m[1].replace(/\t/g, '  ').length;
    const content = m[2];
    if (indent >= 2 && items.length > 0) {
      items[items.length - 1].nested.push(content);
    } else {
      items.push({ text: [content], nested: [] });
    }
    i++;
  }

  if (items.length === 0) return null;

  const html = items
    .map((item) => {
      // Nested lists always render as <ul>: the nesting depth is the signal,
      // not the marker style, and preserving a nested <ol> numbering would
      // require trusting whitespace to encode intent.
      const nested =
        item.nested.length > 0
          ? `<ul>${item.nested.map((n) => `<li>${renderInline(n)}</li>`).join('')}</ul>`
          : '';
      return `<li>${renderInline(item.text.join('\n')).replace(/\n/g, '<br/>')}${nested}</li>`;
    })
    .join('');

  return { html: `<${tag}>${html}</${tag}>`, next: i };
}

/** A table is a `| a | b |` header followed by a `| --- | --- |` separator. */
function parseTable(lines: string[], start: number): ParsedBlock | null {
  const header = splitTableRow(lines[start]);
  if (!header || header.length === 0) return null;
  const next = lines[start + 1];
  if (next === undefined) return null;
  const cells = splitTableRow(next);
  if (!cells || cells.length === 0) return null;
  // Every separator cell is dashes/colons (alignment markers), at least one dash.
  const isSeparator = cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
  if (!isSeparator) return null;
  if (header.length > MAX_TABLE_COLUMNS) return null;

  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length) {
    const row = splitTableRow(lines[i]);
    if (!row) break;
    // Ragged rows are padded/truncated to the header width, not dropped.
    rows.push(row.slice(0, header.length).concat(Array(Math.max(0, header.length - row.length)).fill('')));
    i++;
  }

  const head = `<tr>${header.map((c) => `<th>${renderInline(c.trim())}</th>`).join('')}</tr>`;
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c.trim())}</td>`).join('')}</tr>`)
    .join('');
  return { html: `<table><thead>${head}</thead><tbody>${body}</tbody></table>`, next: i };
}

/** Split `| a | b |` into cells, tolerating missing edge pipes. */
function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  if (trimmed.length < 2) return null;
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|');
}

/* ------------------------------------------------------------------ */
/*  Inline                                                             */
/* ------------------------------------------------------------------ */

/**
 * Inline pass: code spans are extracted FIRST (so their content gets no
 * further transformation), then links, bold, italic. Runs on ESCAPED text.
 */
function renderInline(escaped: string): string {
  // Inline code: `...` and ``...``. Non-greedy, no newline inside.
  const codeSpans: string[] = [];
  let work = escaped.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _ticks: string, content: string) => {
    codeSpans.push(content);
    return `${CODE_PLACEHOLDER_START}${codeSpans.length - 1}${CODE_PLACEHOLDER_END}`;
  });

  // Links: [text](url). The URL is scheme-checked; unsafe schemes render as
  // the link text with the URL in parentheses, never as an anchor.
  work = work.replace(/\[([^\]\n]+)\]\(([^)\n]*)\)/g, (_m, linkText: string, rawUrl: string) => {
    const href = safeHref(rawUrl.trim());
    if (!href) {
      return `${linkText} (${rawUrl.trim()})`;
    }
    const attr = href.replace(/"/g, '%22').replace(/'/g, '%27');
    return `<a href="${attr}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
  });

  // Bold and italic.
  work = work.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  work = work.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // Restore code spans. The placeholder digits sit between two control
  // characters that cannot appear in the input (NUL/controls are stripped or
  // were escaped away), so the index lookup is exact.
  work = work.replace(
    new RegExp(`${CODE_PLACEHOLDER_START}(\\d+)${CODE_PLACEHOLDER_END}`, 'g'),
    (_m, idx: string) => `<code class="inline-code">${codeSpans[Number(idx)] ?? ''}</code>`,
  );

  return work;
}

/**
 * Decide whether a raw (escaped) URL may become an href.
 *
 * CONTROL-CHARACTER STRIPPING IS THE POINT: browsers ignore embedded tabs and
 * newlines when parsing URLs, so `java\tscript:alert(1)` reaches the parser as
 * `javascript:alert(1)`. The scheme check runs on the cleaned string only.
 *
 * Allowed: http(s), mailto, and scheme-less relative URLs. Everything else —
 * javascript:, data:, vbscript:, file:, ftp:, unknown: — is refused. Entities
 * are already inert: escape-first turned `&` into `&amp;`, so `&#58;` stays
 * literal text and never decodes into a colon here.
 */
function safeHref(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\u0000-\u0020\u007f]/g, '');
  if (cleaned === '') return null;
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
    return cleaned;
  }
  // A colon before any / ? # introduces a scheme. Anything but the three above
  // is refused, whatever it calls itself.
  const firstSpecial = cleaned.search(/[:/?#]/);
  if (firstSpecial === -1) return cleaned; // plain relative text
  if (cleaned[firstSpecial] === ':') return null; // an unapproved scheme
  return cleaned; // /, ?, or # — relative
}
