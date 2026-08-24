# Hermes Desktop runtime observation

Hermes Desktop was cloned and its desktop dependencies were installed from the repository workspace. The renderer was launched from `apps/desktop` using the repository Vite config, and an Electron process was started on Xorg `:0` with the renderer DevTools endpoint available on port 9222.

The renderer is not a static screenshot-only shell. Its live DOM rendered these visible surfaces:

- A left sidebar with `SESSIONS`, `BOTS`, `New session`, and `Ctrl N`.
- A durable capability navigation containing `Messaging`, `Artifacts`, and `Scheduled jobs`.
- A workspace start area with `No sessions yet` and `New project`.
- A status area showing `Gateway offline`.
- A first-run onboarding panel titled `Let's get you setup with Hermes Agent` with the message `Connect a model provider to start chatting. Most options take one click.`
- A boot/progress state showing `Starting Hermes…`, a percentage, and a recoverable error surface with `Retry`, `Repair install`, `Gateway settings`, and `Open logs`.

The first screenshot attempt captured a 404 because Vite was initially started from the repository root instead of `apps/desktop`. After correcting the working directory, the live DOM rendered Hermes correctly. The current capture is being refreshed with Electron `Page.bringToFront` and `Page.captureScreenshot({fromSurface:true})`.

Important visual/interaction conclusions:

1. Hermes leads with a real desktop shell and persistent left rail, not a landing page with a centered hero.
2. Chat/session history is the primary workspace context; capabilities are durable nouns in the rail.
3. First-run setup is embedded into the app state and has explicit recovery actions rather than a generic blank/loading screen.
4. Gateway/provider connection is a first-class state in the shell, visible before composing.
5. The system is information-dense but restrained: compact rail rows, status surfaces, and a large working pane rather than multiple decorative cards.
