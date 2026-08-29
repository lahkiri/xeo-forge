import { redirect, notFound } from 'next/navigation';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';
import {
  getTaskById,
  getTasksByUser,
  getTaskEvents,
  getMessages,
  getUploadsByTask,
  getCredits,
} from '@/lib/db/queries';
import AppShell from '@/components/AppShell';
import WorkClient from '../WorkClient';

export const dynamic = 'force-dynamic';

export default async function WorkRunPage(
  { params, searchParams }: { params: { id: string }; searchParams?: { demo?: string } },
) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const task = await getTaskById(params.id);
  if (!task) notFound();
  if (task.user_id !== user.id && !user.isAdmin) notFound();

  // A conversation belongs to the Chat surface.
  if (task.mode === 'chat') redirect(`/chat/${task.id}`);

  const localMode = isDesktopLocalMode();
  const [tasks, events, messages, uploads, credits] = await Promise.all([
    getTasksByUser(user.id),
    getTaskEvents(params.id),
    getMessages(params.id),
    getUploadsByTask(params.id),
    localMode ? Promise.resolve(null) : getCredits(user.id),
  ]);

  const runs = tasks
    .filter((t) => t.mode !== 'chat')
    .map((t) => ({ id: t.id, goal: t.goal, title: t.title, status: t.status, mode: t.mode }));

  // key binds client state to the run so seq/message refs cannot leak across
  // navigations (the cross-task state-bleed bug).
  return (
    <AppShell user={user} balance={localMode ? undefined : credits?.balance ?? 0} localMode={localMode} flush>
      <WorkClient
        key={task.id}
        runs={runs}
        task={task}
        initialEvents={events}
        initialMessages={messages}
        initialUploads={uploads}
        demoMode={searchParams?.demo === '1'}
        demoSource={searchParams?.demo === '1' ? events : []}
      />
    </AppShell>
  );
}
