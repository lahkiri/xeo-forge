import { redirect } from 'next/navigation';

/** Legacy entry point. Chat is the default surface. */
export default function DashboardPage() {
  redirect('/chat');
}
