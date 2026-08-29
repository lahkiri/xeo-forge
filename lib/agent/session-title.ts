/**
 * Session titles (v1.25, Phase 1.2).
 *
 * The live desktop report: a whole sidebar of threads all literally titled
 * "اهلا" — the raw first message — with no way to tell them apart. Titles are
 * now derived deterministically (no extra model spend, no async surprises):
 *
 *   - a real opening message becomes a short, word-boundary-truncated title
 *     that never splits a word and never strands a bidi marker;
 *   - a greeting-only opener ("اهلا", "hello", "مرحبا") yields NO title at
 *     creation — once the first assistant answer is persisted,
 *     `refreshSessionTitle` fills the gap from that first real exchange;
 *   - old rows keep NULL titles and every display site falls back to the
 *     raw goal through the same bidi-safe truncation, so legacy threads
 *     gain readable labels without a migration.
 */

/** Pure greetings: nothing but a salutation (any punctuation attached). */
const GREETING_ONLY =
  /^(?:اهلا|أهلا|هلا|مرحبا|مرحبتين|سلام|سلام عليكم|السلام عليكم|هاي|هيه|صباح الخير|مساء الخير|أهلاين|(?:ahlan|ahla|marhaba|marhaban|salam|salaam|as[- ]?salamu[' ]?alaykum|(?:hello|hi|hey)(?:[ -]there)?|good[ -](?:morning|evening|afternoon)|yo|salut|hallo|hola|welcome)\b)[\s!.,؟?،؛~–-]*$/i;

/** Control/bidi marks that must never dangle at a cut boundary. */
const BIDI_MARKS = /[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\s!.,;:?*·\-–—|\\'"«»"()،؛؟…]+$/u;

export const SESSION_TITLE_MAX = 48;

/** Truncate on a word boundary by code points (never by UTF-16 units). */
export function truncateBidiSafe(text: string, max: number = SESSION_TITLE_MAX): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned);
  if (chars.length <= max) return cleaned;
  let cut = chars.slice(0, max).join('');
  // Walk back to the last word boundary, then drop dangling separators.
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > max * 0.5) cut = cut.slice(0, lastSpace);
  cut = cut.replace(BIDI_MARKS, '');
  if (!cut) return cleaned.slice(0, max);
  return `${cut}…`;
}

/**
 * Derive a session title from an opening user message.
 * Returns NULL for greeting-only openers — the caller falls back to the
 * first exchange instead of stamping "اهلا" on the thread.
 */
export function deriveSessionTitle(goal: string): string | null {
  const normalized = goal.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const bare = normalized.replace(/^[\s#>*\-`"«»'"]+/, '').replace(/[\s.!?،؛؟*`"'"]+$/, '');
  if (!bare || GREETING_ONLY.test(bare)) return null;
  // A message that is only a quoted greeting counts as a greeting too.
  if (GREETING_ONLY.test(bare.replace(/^["'«»]+|["'«»]+$/g, ''))) return null;
  return truncateBidiSafe(bare);
}

/**
 * Title from the first real exchange: the opener when it carries content,
 * otherwise the assistant's first answer. Both sides go through the same
 * bidi-safe truncation.
 */
export function deriveTitleFromExchange(goal: string, assistantAnswer: string | null | undefined): string | null {
  return deriveSessionTitle(goal) ?? (assistantAnswer ? truncateBidiSafe(assistantAnswer) : null);
}

/** Display label for any row: stored title, else the bidi-truncated goal. */
export function displaySessionLabel(title: string | null | undefined, goal: string): string {
  if (title && title.trim()) return title;
  const truncated = truncateBidiSafe(goal);
  return truncated || 'New session';
}

/** Small temporal discrimination: اليوم / أمس / a real date. */
export function relativeDayLabel(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '';
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) return '';
  const now = new Date();
  const then = new Date(time);
  const dayMs = 86_400_000;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(then)) / dayMs);
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'yesterday';
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
