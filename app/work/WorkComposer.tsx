'use client';

/**
 * Follow-up composer — the only way to talk to a run that is not live.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM.
 */

import { Button, KeyHint } from '@/components/ui';
import { UploadButton } from '@/components/UploadButton';

export function WorkComposer({
  taskId,
  draft,
  setDraft,
  onSend,
  busy,
  onUploaded,
  mod,
}: {
  taskId: string;
  draft: string;
  setDraft: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  onUploaded: (uploadId: unknown) => void;
  mod: string;
}) {
  return (
    <div className="shrink-0 border-t border-line-subtle px-4 py-3">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-panel border border-line bg-ink-900/70 transition focus-within:border-signal-run/40">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Follow up, or describe the next change…"
            aria-label="Follow-up message"
            className="block w-full resize-none bg-transparent px-3.5 py-2.5 text-body leading-6 text-content-primary outline-none placeholder:text-content-muted"
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-2">
            <UploadButton
              taskId={taskId}
              onUploaded={onUploaded}
              label="Attach"
            />
            <span className="flex items-center gap-2">
              <KeyHint keys={[mod, 'Enter']} />
              <Button size="sm" onClick={onSend} loading={busy} disabled={!draft.trim()}>
                Send
              </Button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
