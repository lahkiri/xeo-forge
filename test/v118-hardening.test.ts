/**
 * v1.18 hardening regression tests.
 *
 * One file per fix family, each tied to the defect it locks out:
 *   F1 — consecutiveEmptyResponses must be CONSECUTIVE-only
 *        (loop.ts previously never reset it: 3 scattered empties across a
 *        long productive run failed the task).
 *   F2 — CodeTool.python() writes the snippet via fs and runs it with a
 *        platform-correct interpreter; no shell quoting of user code.
 *   F4 — Arabic autonomy-violation patterns in guards + detectLanguage
 *        threshold sane for mixed Arabic/English goals.
 *
 * Source-contract style (reading the module source) follows the existing
 * repo convention in test/cancellation.test.ts.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isQuestionToUser } from '../lib/agent/guards';

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('F4: Arabic question-pattern guards', () => {
  it('flags Arabic "shall I continue?" as an autonomy violation', () => {
    expect(isQuestionToUser('هل تريدني أن أتابع؟')).toBe(true);
  });

  it('flags Arabic waiting-for-confirmation phrasing', () => {
    expect(isQuestionToUser('جاهز، بانتظار تأكيدك للمتابعة.')).toBe(true);
  });

  it('flags Arabic "let me know" equivalent', () => {
    expect(isQuestionToUser('إذا أردت التعديل دعني أعرف.')).toBe(true);
  });

  it('does not flag ordinary Arabic progress narration', () => {
    expect(isQuestionToUser('تم إنشاء الملف وتشغيل الاختبارات بنجاح.')).toBe(false);
  });

  it('still flags the English patterns', () => {
    expect(isQuestionToUser('Would you like me to continue?')).toBe(true);
  });
});

describe('F4: detectLanguage threshold raised for mixed-script goals', () => {
  const loopSource = readSrc('lib/agent/loop.ts');

  it('uses the 0.08 threshold for Arabic detection', () => {
    expect(loopSource).toMatch(/arabicChars \/ total > 0\.08/);
  });

  it('documents why the threshold moved from 0.15', () => {
    expect(loopSource).toMatch(/Lowered from 0\.15 to 0\.08/);
  });

  it('keeps the French diacritic threshold unchanged', () => {
    expect(loopSource).toMatch(/frenchIndicators \/ total > 0\.03/);
  });
});

describe('F1: consecutive empty responses are bounded consecutively', () => {
  const loopSource = readSrc('lib/agent/loop.ts');

  it('contains exactly one reset statement beyond the declaration', () => {
    // The declaration (`let consecutiveEmptyResponses = 0;`) is not a reset;
    // the single assignment site is inside the productive-stream check.
    const resets = loopSource.match(/(?<!let )consecutiveEmptyResponses = 0;/g) || [];
    expect(resets.length).toBe(1);
  });

  it('reset fires on any productive stream (text, reasoning, or tool calls)', () => {
    expect(loopSource).toMatch(
      /if \(textBuf\.trim\(\) \|\| reasoningBuf\.trim\(\) \|\| toolCalls\.size > 0\) \{\s*consecutiveEmptyResponses = 0;/,
    );
  });

  it('reset sits before plan-buffer accumulation and before the empty counter increment', () => {
    const resetIdx = loopSource.indexOf('consecutiveEmptyResponses = 0;');
    const planBufIdx = loopSource.indexOf("planBuffer += (planBuffer ? '\\n\\n' : '')");
    const incrIdx = loopSource.indexOf('consecutiveEmptyResponses++;');
    expect(resetIdx).toBeGreaterThan(-1);
    expect(planBufIdx).toBeGreaterThan(resetIdx);
    expect(resetIdx).toBeLessThan(incrIdx);
  });

  it('the stale "Reset on any non-empty response" comment is gone (now true)', () => {
    // The old comment promised behavior that did not exist; v1.18 implements
    // the reset and documents it at the reset site instead.
    expect(loopSource).not.toContain('Reset on any non-empty response');
  });
});

describe('F2: python tooling shape (static contract)', () => {
  const codeSource = readSrc('lib/agent/code.ts');

  it('no longer pipes code through printf shell-quoting', () => {
    // The only permitted mention is the historical note in the doc comment;
    // the executable path must not contain it.
    const withoutComments = codeSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/printf '%s'/);
  });

  it('writes the snippet via fs.writeFileSync instead', () => {
    expect(codeSource).toContain('fs.writeFileSync(abs, code');
  });

  it('resolves the Windows interpreter explicitly (py launcher, not Store stub)', () => {
    expect(codeSource).toMatch(/py -3 \|\| python/);
  });

  it('cleans up the temp snippet when the command is rejected', () => {
    expect(codeSource).toMatch(/unlinkSync\(abs\)/);
  });
});
