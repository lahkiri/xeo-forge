/**
 * Minimal markdown → HTML for assistant output. No dependencies.
 *
 * Extracted from TaskClient so the Chat and Work surfaces render identically
 * instead of carrying divergent copies (AGENTS.md rule 1).
 *
 * SECURITY: HTML entities are escaped BEFORE any markdown transformation, so
 * model output can never inject markup. Everything emitted below is generated
 * by this function from already-escaped text.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  html = html
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> runs in a single <ul>.
  html = html.replace(/(<li>.*?<\/li>(<br\/>)?)+/g, (match) => `<ul>${match.replace(/<br\/>/g, '')}</ul>`);

  return html;
}
