export {};

declare global {
  type DesktopBrowserState = {
    connected: boolean;
    tab: { id?: number; url?: string; title?: string } | null;
    permissions: string[];
    port: number;
    token: string | null;
    updatedAt?: string;
  };

  type DesktopUpdateState = {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'success' | 'error';
    currentVersion: string;
    version: string | null;
    previousVersion?: string;
    percent: number;
    message: string;
    size?: number | null;
    releaseDate?: string;
    transferred?: number;
    total?: number;
  };

  interface Window {
    xeoDesktop?: {
      isDesktop: true;
      getProject: () => Promise<{ path: string | null }>;
      chooseProject: () => Promise<{ path: string | null; error?: string }>;
      setProject: (projectPath: string) => Promise<{ path: string | null; error?: string }>;
      getUpdateState: () => Promise<DesktopUpdateState>;
      checkForUpdate: () => Promise<DesktopUpdateState>;
      downloadUpdate: () => Promise<DesktopUpdateState>;
      installUpdate: () => Promise<DesktopUpdateState>;
      getBrowserState: () => Promise<DesktopBrowserState>;
      openBrowserExtension: () => Promise<string>;
    };
    xeoDesktopEvents?: {
      onProjectChanged: (callback: (project: { path: string | null }) => void) => () => void;
      onUpdateStatus: (callback: (state: DesktopUpdateState) => void) => () => void;
    };
  }
}
