export {};

declare global {
  type DesktopBrowserTab = { id?: number; url?: string; title?: string } | null;

  type DesktopBrowserPolicy = {
    interactionEnabled: boolean;
    allowedDomains: string[];
    redactSensitiveData: boolean;
    allowSensitiveActions: boolean;
  };

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

  /** v1.25: a tokenless pairing request waiting for an explicit operator yes. */
  type DesktopPairingRequest = {
    id: string;
    browserId: string;
    profileName: string;
    browserName: string;
    extensionVersion: string;
    userAgent: string;
    requestedAt: string;
  };

  type DesktopBrowserState = {
    connected: boolean;
    selection: 'selected' | 'selected_disconnected' | 'selection_required';
    selectedBrowserId: string | null;
    selectedProfile: DesktopBrowserProfile | null;
    profiles: DesktopBrowserProfile[];
    pendingPairing: DesktopPairingRequest[];
    tab: DesktopBrowserTab;
    permissions: string[];
    port: number;
    token: string | null;
    browserPolicy: DesktopBrowserPolicy | null;
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
    channel?: 'latest' | 'beta';
    lastCheckedAt?: string | null;
    lastError?: string | null;
    downloadedAt?: string;
  };

  type DesktopUpdateSettings = {
    channel: 'latest' | 'beta';
    autoCheck: boolean;
    intervalHours: number;
  };

  interface Window {
    xeoDesktop?: {
      isDesktop: true;
      getProject: () => Promise<{ path: string | null }>;
      chooseProject: () => Promise<{ path: string | null; error?: string }>;
      setProject: (projectPath: string) => Promise<{ path: string | null; error?: string }>;
      getUpdateState: () => Promise<DesktopUpdateState>;
      getUpdateSettings: () => Promise<DesktopUpdateSettings>;
      setUpdateSettings: (settings: Partial<DesktopUpdateSettings>) => Promise<DesktopUpdateSettings>;
      checkForUpdate: () => Promise<DesktopUpdateState>;
      downloadUpdate: () => Promise<DesktopUpdateState>;
      installUpdate: () => Promise<DesktopUpdateState>;
      getBrowserState: () => Promise<DesktopBrowserState>;
      selectBrowser: (browserId: string) => Promise<DesktopBrowserState>;
      approvePairing: (pairingId: string) => Promise<DesktopBrowserState>;
      denyPairing: (pairingId: string) => Promise<DesktopBrowserState>;
      getBrowserPolicy: () => Promise<DesktopBrowserPolicy | null>;
      setBrowserPolicy: (policy: Partial<DesktopBrowserPolicy>) => Promise<DesktopBrowserState>;
      openBrowserExtension: () => Promise<string>;
    };
    xeoDesktopEvents?: {
      onProjectChanged: (callback: (project: { path: string | null }) => void) => () => void;
      onUpdateStatus: (callback: (state: DesktopUpdateState) => void) => () => void;
    };
  }
}
