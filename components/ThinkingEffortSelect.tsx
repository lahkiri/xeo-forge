'use client';

import { THINKING_LEVELS, thinkingLevel, type ThinkingEffort } from '@/lib/model/thinking';
import { Select } from './ui';

/**
 * The thinking-effort selector — the honest control.
 *
 * Shown in the Chat composer and the Work setup. Each option carries its
 * one-word honest classification (native vs hybrid) in the label so the
 * owner's "no fake differentiation" rule is visible AT CHOICE TIME, not
 * buried in docs.
 */
export function ThinkingEffortSelect({
  value,
  onChange,
  disabled,
  id,
  compact,
  label,
  hint,
}: {
  value: string;
  onChange: (level: ThinkingEffort) => void;
  disabled?: boolean;
  id?: string;
  compact?: boolean;
  /** Full-field presentation (Work intake) vs compact chip (composer). */
  label?: string;
  hint?: string;
}) {
  const spec = thinkingLevel(value);
  return (
    <Select
      id={id}
      label={label}
      hint={hint ?? `${spec.label} — ${spec.describe}`}
      value={spec.id}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ThinkingEffort)}
      aria-label="Thinking effort"
      className={compact ? 'h-7 w-auto max-w-[190px] text-micro' : 'h-8 w-full text-meta'}
    >
      {THINKING_LEVELS.map((level) => (
        <option key={level.id} value={level.id}>
          {level.label}
          {level.kind === 'hybrid' ? ' (+sim)' : ''}
        </option>
      ))}
    </Select>
  );
}

/**
 * The honest warning rendered when a run finished with a level that implies
 * visible reasoning but the model streamed none. Silence here would be the
 * misleading kind — the owner's rule: warn, never pretend.
 */
export function ThinkingAbsenceNote({ levelLabel }: { levelLabel: string }) {
  return (
    <p role="note" className="mb-2 text-micro leading-4 text-content-faint">
      {levelLabel} was selected, but this model did not stream separate thinking for that run —
      its reasoning stayed internal. Nothing was hidden; there is nothing to show.
    </p>
  );
}
