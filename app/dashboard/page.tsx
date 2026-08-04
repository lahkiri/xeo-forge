import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getTasksByUser, getCredits } from '@/lib/db/queries';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [tasks, credits] = await Promise.all([getTasksByUser(user.id), getCredits(user.id)]);

  return (
    <DashboardClient
      user={user}
      initialTasks={tasks}
      initialBalance={credits?.balance ?? 0}
    />
  );
}
