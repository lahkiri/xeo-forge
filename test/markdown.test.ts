import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../lib/markdown';

/* ------------------------------------------------------------------ */
/*  Markdown renderer — feature coverage + XSS battery.               */
/*                                                                     */
/*  The invariant under test is AGENTS.md §16 in miniature: the model  */
/*  (or an untrusted MCP tool whose bytes reached a summary) controls  */
/*  the INPUT; this module alone controls the OUTPUT HTML. Every       */
/*  adversarial case below must render as inert text.                  */
/* ------------------------------------------------------------------ */

describe('renderMarkdown features', () => {
  it('renders headings h1–h3 and collapses h4–h6 to h3', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>');
    expect(renderMarkdown('## Sub')).toContain('<h2>Sub</h2>');
    expect(renderMarkdown('### Deep')).toContain('<h3>Deep</h3>');
    expect(renderMarkdown('#### Deeper')).toContain('<h3>Deeper</h3>');
    expect(renderMarkdown('###### Deepest')).toContain('<h3>Deepest</h3>');
  });

  it('renders bold, italic, and inline code', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
    expect(renderMarkdown('use `npm test` here')).toContain('<code class="inline-code">npm test</code>');
  });

  it('does not apply bold inside inline code', () => {
    const html = renderMarkdown('`**not bold**`');
    expect(html).toContain('<code class="inline-code">**not bold**</code>');
    expect(html).not.toContain('<strong>');
  });

  it('renders fenced code blocks with ``` and ~~~ markers', () => {
    expect(renderMarkdown('```js\nconst x = 1;\n```')).toContain(
      '<pre class="code-block"><code data-lang="js">const x = 1;</code></pre>',
    );
    expect(renderMarkdown('~~~\nplain fence\n~~~')).toContain('<pre class="code-block"><code>plain fence</code></pre>');
  });

  it('does not transform markdown inside fenced code blocks', () => {
    const html = renderMarkdown('```\n**bold** [link](http://x)\n```');
    expect(html).toContain('<pre class="code-block"><code>**bold** [link](http://x)</code></pre>');
  });

  it('renders an unclosed fence as a code block (total renderer)', () => {
    const html = renderMarkdown('```\nopen ended');
    expect(html).toContain('<pre class="code-block"><code>open ended</code></pre>');
  });

  it('renders unordered lists', () => {
    const html = renderMarkdown('- one\n- two\n- three');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>three</li>');
  });

  it('renders ordered lists', () => {
    const html = renderMarkdown('1. first\n2. second\n3. third');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>third</li>');
  });

  it('renders one level of list nesting', () => {
    const html = renderMarkdown('- parent\n  - child\n- parent two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>parent<ul><li>child</li></ul></li>');
    expect(html).toContain('<li>parent two</li>');
  });

  it('renders a table with header and body rows', () => {
    const html = renderMarkdown('| Name | Value |\n|---|---|\n| a | 1 |\n| b | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<td>2</td>');
  });

  it('pads ragged table rows instead of dropping them', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| only-one |');
    expect(html).toContain('<td>only-one</td>');
    expect(html).toContain('<td></td>');
  });

  it('does not treat a lone pipe line as a table', () => {
    const html = renderMarkdown('a | b');
    expect(html).not.toContain('<table>');
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> quoted line');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('quoted line');
  });

  it('renders consecutive quote lines as one blockquote', () => {
    const html = renderMarkdown('> one\n> two');
    expect(html.match(/<blockquote>/g)?.length).toBe(1);
  });

  it('renders links with safe schemes as anchors with noopener', () => {
    const html = renderMarkdown('[docs](https://example.com/x?a=1)');
    expect(html).toContain('<a href="https://example.com/x?a=1" target="_blank" rel="noopener noreferrer">docs</a>');
  });

  it('renders mailto links', () => {
    expect(renderMarkdown('[mail](mailto:a@b.c)')).toContain('href="mailto:a@b.c"');
  });

  it('renders relative URLs', () => {
    expect(renderMarkdown('[home](/dashboard)')).toContain('href="/dashboard"');
    expect(renderMarkdown('[anchor](#section)')).toContain('href="#section"');
  });

  it('preserves query and hash in links', () => {
    expect(renderMarkdown('[q](https://example.com/s?a=1&b=2)')).toContain('href="https://example.com/s?a=1&amp;b=2"');
  });

  it('renders horizontal rules', () => {
    expect(renderMarkdown('---')).toContain('<hr/>');
  });

  it('renders paragraphs with line breaks', () => {
    const html = renderMarkdown('line one\nline two');
    expect(html).toContain('<p>line one<br/>line two</p>');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('is deterministic: same input, byte-identical output', () => {
    const input = '# H\n\n- a\n  - b\n| x | y |\n|---|---|\n| 1 | 2 |\n> quote\n`code` **bold** [l](https://e.com)';
    expect(renderMarkdown(input)).toBe(renderMarkdown(input));
  });
});

describe('renderMarkdown XSS battery', () => {
  it('escapes script tags in plain text', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes img with onerror inside code fences', () => {
    const html = renderMarkdown('```\n<img src=x onerror=alert(1)>\n```');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes raw HTML inside inline code', () => {
    const html = renderMarkdown('`<iframe src="javascript:1">`');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('&lt;iframe');
  });

  it('rejects javascript: URLs', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('<a ');
    expect(html).toContain('click (javascript:alert(1))');
  });

  it('rejects javascript: URLs with mixed case and padding', () => {
    for (const url of ['JaVaScRiPt:alert(1)', 'javascript:alert(1)   ', '  javascript:alert(1)']) {
      const html = renderMarkdown(`[x](${url})`);
      expect(html).not.toContain('<a ');
      expect(html).not.toMatch(/href="[^"]*javascript/i);
    }
  });

  it('rejects javascript: URLs with embedded control characters', () => {
    // Browsers strip tab/newline inside URLs before parsing the scheme.
    const html = renderMarkdown('[x](java\tscript:alert(1))');
    expect(html).not.toContain('<a ');
    const html2 = renderMarkdown('[x](java\nscript:alert(1))');
    expect(html2).not.toContain('<a ');
  });

  it('rejects data: URLs', () => {
    const html = renderMarkdown('[payload](data:text/html;base64,PHNjcmlwdD4=)');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href="data:');
  });

  it('rejects vbscript:, file:, and ftp: schemes', () => {
    for (const scheme of ['vbscript:msgbox', 'file:///etc/passwd', 'ftp://evil.com/x']) {
      const html = renderMarkdown(`[x](${scheme})`);
      expect(html).not.toContain('<a ');
    }
  });

  it('does not decode entity smuggled schemes', () => {
    // `&#106;avascript:` — escape-first turns & into &amp;, so this can never
    // become a live javascript: URL in an href.
    const html = renderMarkdown('[x](&#106;avascript:alert(1))');
    expect(html).not.toMatch(/href="javascript/i);
    expect(html).not.toMatch(/href="&#106;javascript/i);
  });

  it('neutralizes quotes inside link URLs (no attribute breakout)', () => {
    // A " in the URL must not terminate the href attribute early. The anchor
    // opening tag must be EXACTLY href/target/rel — nothing else can follow.
    const html = renderMarkdown('[x](https://example.com/"onmouseover="alert(1))');
    const openingTag = html.match(/<a [^>]*>/)?.[0] ?? '';
    if (openingTag) {
      // The tag must be exactly the three attributes this module emits.
      expect(openingTag).toMatch(/^<a href="[^"]*" target="_blank" rel="noopener noreferrer">$/);
    }
    // The href VALUE may contain the quote percent-encoded (data, not markup).
    const href = openingTag.match(/href="([^"]*)"/)?.[1] ?? '';
    expect(href).not.toContain('"');
  });

  it('escapes quotes in link TEXT (no element breakout)', () => {
    const html = renderMarkdown('["quoted"](https://example.com)');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).not.toMatch(/<a [^>]*"[^>]*"[^>]*on\w+=/);
  });

  it('escapes an attempt to forge markdown headings into HTML', () => {
    const html = renderMarkdown('# <b>not bold</b>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('escapes table cell content', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| <img src=x> | 1 |');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes blockquote content', () => {
    const html = renderMarkdown('> <script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('strips NUL bytes so code placeholders cannot be forged', () => {
    // \u0001\u00020 would otherwise collide with the internal code-span
    // placeholder namespace.
    const html = renderMarkdown('\u0001\u00000\u0002 and \u0000 stays out');
    expect(html).not.toContain('inline-code');
    expect(html).toContain('and');
  });

  it('does not create anchors from bare URLs (no autolinking of dangerous schemes)', () => {
    const html = renderMarkdown('see javascript:alert(1) for details');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<script');
  });

  it('handles a link inside a list item safely', () => {
    const html = renderMarkdown('- [docs](https://example.com)\n- [bad](javascript:x)');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toMatch(/href="javascript/i);
  });

  it('link text cannot contain a closing bracket that breaks out of the anchor', () => {
    const html = renderMarkdown('[a](https://e.com "title")');
    // A title segment is not a URL character — the URL ends at the space, and
    // the leftover text renders as-is. No attribute injection either way.
    expect(html).not.toMatch(/title=/);
  });
});
