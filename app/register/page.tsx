import { redirect } from 'next/navigation';
import RegisterForm from './RegisterForm';
import { getCurrentUser, isDesktopLocalMode } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  if (isDesktopLocalMode()) {
    await getCurrentUser();
    redirect('/chat');
  }
  return <RegisterForm />;
}
