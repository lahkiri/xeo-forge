import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getTaskById } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * Legacy task URL. Routes to the surface that matches the task's mode so old
 * links, exports, and bookmarks keep working after the Chat/Work split.
 */
export default async function LegacyTaskPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const task = await getTaskById(params.id);
  if (!task) notFound();
  if (task.user_id !== user.id && !user.isAdmin) notFound();

  redirect(task.mode === 'chat' ? `/chat/${task.id}` : `/work/${task.id}`);
}
