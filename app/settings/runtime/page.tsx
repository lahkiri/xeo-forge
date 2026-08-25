import { isDesktopLocalMode } from '@/lib/auth/session';
import RuntimeSettings from '../RuntimeSettings';

export default function RuntimeSettingsPage() {
  return <RuntimeSettings localMode={isDesktopLocalMode()} />;
}
