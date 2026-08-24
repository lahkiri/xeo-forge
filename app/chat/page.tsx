import { redirect } from 'next/navigation';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';
import { getTasksByUser, getCredits, listAgentProfiles, listAgentSkills } from '@/lib/db/queries';
import AppShell from '@/components/AppShell';
import UnifiedWorkspace from './UnifiedWorkspace';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const localMode = isDesktopLocalMode();
  const [tasks, credits, profiles, skills] = await Promise.all([
    getTasksByUser(user.id),
    localMode ? Promise.resolve(null) : getCredits(user.id),
    listAgentProfiles(user.id),
    listAgentSkills(user.id),
  ]);

  const threads = tasks
    .filter((task) => task.mode === 'chat')
    .map((task) => ({ id: task.id, goal: task.goal, status: task.status, updated_at: task.updated_at }));

  const runs = tasks
    .filter((task) => task.mode !== 'chat')
    .map((task) => ({ id: task.id, goal: task.goal, status: task.status, mode: task.mode }));

  return (
    <AppShell user={user} balance={localMode ? undefined : credits?.balance ?? 0} localMode={localMode} flush>
      <UnifiedWorkspace
        threads={threads}
        runs={runs}
        profiles={profiles.filter((profile) => profile.enabled)}
        skills={skills.filter((skill) => skill.enabled)}
        balance={localMode ? undefined : credits?.balance ?? 0}
        localMode={localMode}
      />
    </AppShell>
  );
}
