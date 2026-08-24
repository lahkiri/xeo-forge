'use client';

import { useRef, useState } from 'react';
import type { Upload } from '@/lib/types';

/* Single source of truth for the file-upload affordance, shared by every
   chat composer (task view + new-task/home composer). One component, one
   handler, one accept list, one backend route. No per-page divergence. */

export const UPLOAD_ACCEPT =
  '.txt,.log,.md,.markdown,.mdx,.json,.jsonl,.ndjson,.csv,.tsv,.yaml,.yml,.xml,.html,.css,.sql,.toml,.ini,.cfg,.conf,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.cpp,.h,.sh,.rb,.php,.vue,.svelte,.zip,.tar,.tar.gz,.tgz';

export interface UploadResult {
  ok: boolean;
  upload?: Upload;
  error?: string;
}

/** The single shared upload handler — posts a file to the existing
    task-scoped upload route. Used everywhere uploads happen. */
export async function uploadToTask(taskId: string, file: File): Promise<UploadResult> {
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/tasks/${taskId}/uploads`, { method: 'POST', body: form });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: d.error || `Upload rejected (${res.status})` };
    return { ok: true, upload: d.upload };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

function Paperclip({ size }: { size: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  );
}

function Spinner({ size }: { size: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  return <span className={`${cls} inline-block rounded-full border-2 border-gray-500 border-t-transparent animate-spin`} />;
}

/**
 * Shared upload button.
 * - When `taskId` is set, picking a file uploads immediately via `uploadToTask`
 *   and calls `onUploaded` with the resulting Upload.
 * - When `taskId` is null (no task exists yet, e.g. the new-task composer),
 *   picking a file calls `onStaged` so the caller can upload it once a task is
 *   created — reusing the exact same handler/route. No separate pipeline.
 * - `label` switches to the labeled variant; omit it for the icon-only variant.
 */
export function UploadButton({
  taskId,
  onUploaded,
  onStaged,
  disabled,
  label,
  title = 'Attach a file or archive (analyzed as untrusted data)',
}: {
  taskId: string | null;
  onUploaded?: (upload: Upload) => void;
  onStaged?: (file: File) => void;
  disabled?: boolean;
  label?: string;
  title?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting the same file
    if (!taskId) {
      onStaged?.(file);
      return;
    }
    setUploading(true);
    const result = await uploadToTask(taskId, file);
    setUploading(false);
    if (!result.ok) alert(result.error || 'Upload failed');
    else if (result.upload) onUploaded?.(result.upload);
  }

  const size = label ? 'sm' : 'md';

  return (
    <>
      <input ref={inputRef} type="file" className="hidden" onChange={handleChange} accept={UPLOAD_ACCEPT} />
      {label ? (
        <button
          type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading}
          title={title}
          className="inline-flex items-center gap-2 rounded-control border border-line bg-ink-700/60 px-3 py-2 text-meta text-content-secondary hover:text-content-primary hover:border-line-strong transition disabled:opacity-40"
        >
          {uploading ? <Spinner size={size} /> : <Paperclip size={size} />}
          {uploading ? 'uploading…' : label}
        </button>
      ) : (
        <button
          type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading}
          title={title}
          className="rounded-control border border-line bg-ink-700/60 px-3 py-2.5 text-content-secondary hover:text-content-primary hover:border-line-strong transition disabled:opacity-40"
        >
          {uploading ? <Spinner size={size} /> : <Paperclip size={size} />}
        </button>
      )}
    </>
  );
}
