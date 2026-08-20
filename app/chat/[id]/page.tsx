import { redirect, notFound } from 'next/navigation';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';
import { getTaskById, getTasksByUser, getMessages, getTaskEvents, getCredits } from '@/lib/db/queries';
import AppShell from '@/components/AppShell';
import ChatClient from '../ChatClient';

export const dynamic = 'force-dynamic';

export default async function ChatThreadPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const task = await getTaskById(params.id);
  if (!task) notFound();
  if (task.user_id !== user.id && !user.isAdmin) notFound();

  // A governed run belongs to the Work surface, not the chat column.
  if (task.mode !== 'chat') redirect(`/work/${task.id}`);

  const localMode = isDesktopLocalMode();
  const [tasks, messages, events, credits] = await Promise.all([
    getTasksByUser(user.id),
    getMessages(params.id),
    getTaskEvents(params.id),
    localMode ? Promise.resolve(null) : getCredits(user.id),
  ]);

  const threads = tasks
    .filter((t) => t.mode === 'chat')
    .map((t) => ({ id: t.id, goal: t.goal, status: t.status, updated_at: t.updated_at }));

  // key binds client state to the thread so seq/message state cannot leak
  // across navigations.
  return (
    <AppShell user={user} balance={localMode ? undefined : credits?.balance ?? 0} localMode={localMode} flush>
      <ChatClient
        key={task.id}
        threads={threads}
        activeTask={task}
        initialMessages={messages}
        initialEvents={events}
      />
    </AppShell>
  );
}
