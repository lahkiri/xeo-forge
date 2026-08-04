import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { listUsersWithStats, listAdminActions } from '@/lib/db/queries';
import { getModelSafe } from '@/lib/model/config';
import AdminClient from './AdminClient';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.isAdmin) redirect('/dashboard');

  const [users, model, actions] = await Promise.all([
    listUsersWithStats(),
    getModelSafe(),
    listAdminActions(50),
  ]);

  const safeUsers = users.map(({ password_hash, ...rest }) => rest);

  return <AdminClient currentUser={user} initialUsers={safeUsers} initialModel={model} initialActions={actions} />;
}
