import { redirect } from 'next/navigation';
import LoginForm from './LoginForm';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (isDesktopLocalMode()) {
    await getCurrentUser();
    redirect('/dashboard');
  }
  return <LoginForm />;
}
