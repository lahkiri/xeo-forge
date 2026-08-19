export {};

declare global {
  type DesktopBrowserTab = { id?: number; url?: string; title?: string } | null;

  type DesktopBrowserProfile = {
    browserId: string;
    profileName: string;
    browserName: string;
    extensionVersion: string;
    userAgent: string;
    connected: boolean;
    tab: DesktopBrowserTab;
    permissions: string[];
    updatedAt?: string;
  };

  type DesktopBrowserState = {
    connected: boolean;
    selection: 'selected' | 'selected_disconnected' | 'selection_required';
    selectedBrowserId: string | null;
    selectedProfile: DesktopBrowserProfile | null;
    profiles: DesktopBrowserProfile[];
    tab: DesktopBrowserTab;
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
      selectBrowser: (browserId: string) => Promise<DesktopBrowserState>;
      openBrowserExtension: () => Promise<string>;
    };
    xeoDesktopEvents?: {
      onProjectChanged: (callback: (project: { path: string | null }) => void) => () => void;
      onUpdateStatus: (callback: (state: DesktopUpdateState) => void) => () => void;
    };
  }
}
