import { redirect } from 'next/navigation';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';
import { getTasksByUser, getCredits, listAgentProfiles, listAgentSkills } from '@/lib/db/queries';
import AppShell from '@/components/AppShell';
import WorkIntake from './WorkIntake';

export const dynamic = 'force-dynamic';

export default async function WorkPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const localMode = isDesktopLocalMode();
  const [tasks, credits, profiles, skills] = await Promise.all([
    getTasksByUser(user.id),
    localMode ? Promise.resolve(null) : getCredits(user.id),
    listAgentProfiles(user.id),
    listAgentSkills(user.id),
  ]);

  const runs = tasks
    .filter((task) => task.mode !== 'chat')
    .map((task) => ({ id: task.id, goal: task.goal, status: task.status, mode: task.mode }));

  const balance = localMode ? undefined : credits?.balance ?? 0;

  return (
    <AppShell user={user} balance={balance} localMode={localMode} flush>
      <WorkIntake
        runs={runs}
        profiles={profiles.filter((p) => p.enabled)}
        skills={skills.filter((s) => s.enabled)}
        balance={balance}
        localMode={localMode}
      />
    </AppShell>
  );
}
