import { redirect } from 'next/navigation';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';
import SettingsLayout from './SettingsLayout';

export const dynamic = 'force-dynamic';

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <SettingsLayout user={user} localMode={isDesktopLocalMode()}>{children}</SettingsLayout>;
}
