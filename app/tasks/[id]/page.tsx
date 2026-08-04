import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getTaskById, getTaskEvents, getMessages, getUploadsByTask } from '@/lib/db/queries';
import TaskClient from './TaskClient';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const task = await getTaskById(params.id);
  if (!task) notFound();
  if (task.user_id !== user.id && !user.isAdmin) notFound();

  const events = await getTaskEvents(params.id);
  const messages = await getMessages(params.id);
  const uploads = await getUploadsByTask(params.id);

  // key={task.id} binds the client component's identity to the task. Without
  // it, navigating /tasks/A -> /tasks/B reuses the same React instance (same
  // component type at the same tree position), so useState initializers never
  // re-run and the seenSeq/maxSeq refs leak task A's state/seqs into task B —
  // the root cause of cross-task state bleed and live-stream corruption.
  return (
    <TaskClient
      key={task.id}
      initialTask={task}
      initialEvents={events}
      initialMessages={messages}
      initialUploads={uploads}
    />
  );
}
