import { redirect } from 'next/navigation';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';
import { getTasksByUser, getCredits } from '@/lib/db/queries';
import AppShell from '@/components/AppShell';
import ChatClient from './ChatClient';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const localMode = isDesktopLocalMode();
  const [tasks, credits] = await Promise.all([
    getTasksByUser(user.id),
    localMode ? Promise.resolve(null) : getCredits(user.id),
  ]);

  const threads = tasks
    .filter((task) => task.mode === 'chat')
    .map((task) => ({ id: task.id, goal: task.goal, status: task.status, updated_at: task.updated_at }));

  return (
    <AppShell user={user} balance={localMode ? undefined : credits?.balance ?? 0} localMode={localMode} flush>
      <ChatClient threads={threads} activeTask={null} initialMessages={[]} initialEvents={[]} />
    </AppShell>
  );
}
