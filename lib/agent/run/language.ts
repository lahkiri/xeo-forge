/**
 * Language detection — the LANGUAGE AFFINITY contract's input signal.
 *
 * Extracted from loop.ts (v1.24 structural rework) VERBATIM. Thresholds are
 * pinned by test/v118-hardening.test.ts (F4), now reading THIS module's
 * source — the definition lives here, the call site stays in loop.ts.
 */

/**
 * Detect the dominant language from a text string using Unicode ranges.
 * Returns a BCP-47 language tag. Falls back to 'en' if detection is uncertain.
 * This is a lightweight heuristic — no external library needed.
 */
export function detectLanguage(text: string): string {
  const sample = text.slice(0, 500);
  // Arabic: Unicode range 0600-06FF
  const arabicChars = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  // French/Spanish/Portuguese/Italian detection via common diacritics + word patterns
  const frenchIndicators = (sample.match(/[àâäéèêëïîôùûüÿçœæ]/gi) || []).length;
  // CJK ranges
  const cjkChars = (sample.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  // Cyrillic
  const cyrillicChars = (sample.match(/[\u0400-\u04FF]/g) || []).length;

  const total = sample.length || 1;
  // Thresholds: Arabic/CJK/Cyrillic are distinct Unicode blocks — a small
  // fraction of their characters is already conclusive. Latin-script
  // diacritics are weaker evidence (an English goal quoting a French word,
  // or code comments, trips them), so that threshold stays deliberately low.
  // Lowered from 0.15 to 0.08 (v1.18): a real Arabic goal mixed with English
  // identifiers/paths commonly lands at 8-15% Arabic characters and was being
  // misclassified as English, breaking the LANGUAGE AFFINITY contract.
  if (arabicChars / total > 0.08) return 'ar';
  if (cjkChars / total > 0.08) return 'zh';
  if (cyrillicChars / total > 0.08) return 'ru';
  if (frenchIndicators / total > 0.03) return 'fr';
  return 'en';
}
