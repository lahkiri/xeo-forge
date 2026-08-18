export {};

declare global {
  interface Window {
    xeoDesktop?: {
      isDesktop: true;
      getProject: () => Promise<{ path: string | null }>;
      chooseProject: () => Promise<{ path: string | null; error?: string }>;
      setProject: (projectPath: string) => Promise<{ path: string | null; error?: string }>;
    };
    xeoDesktopEvents?: {
      onProjectChanged: (callback: (project: { path: string | null }) => void) => () => void;
    };
  }
}
