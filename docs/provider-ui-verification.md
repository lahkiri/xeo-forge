# Provider UI verification

- The new `/settings/providers` route renders inside a dedicated Settings shell with six direct navigation routes.
- The Providers manager uses a left provider list and a right detail pane.
- Local verification created two providers (`OpenAI Preview`, `Anthropic Preview`) and three models, proving the API and UI support multiple providers and multiple models per provider.
- Provider and model pause/enable controls are visible in the detail view; delete actions are wired to DELETE routes.
- `/chat?mode=chat` renders the composer label as `Anthropic Preview / Claude 3.7 Preview`, not the previous fixed `Xeo model` label.
- The open picker groups enabled models under provider headings and shows a check mark on the selected model: `Anthropic Preview` → `Claude 3.7 Preview`; `OpenAI Preview` → `GPT-4o Mini Preview`, `GPT-4.1 Preview`.
- The preview was run with `NODE_ENV=development XEO_DESKTOP_LOCAL=1 XEO_LOCAL_OWNER_NAME='Xeo Preview'` on port 3002.


## Route verification

The `/settings/runtime` route renders a dedicated runtime page and correctly explains that browser/update controls are desktop-local when the Electron bridge is absent from web preview. The `/settings/profiles` route renders Profile Studio under the shared Settings navigation, confirming the legacy manager can live as an independent page.


The `/settings/memory` route renders independent instruction and persistent-memory panels with create and lifecycle controls. The `/settings/mcp` route renders the existing MCP master/detail manager in its own navigation slot and keeps the approval-boundary copy visible.
