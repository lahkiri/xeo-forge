# Hermes Desktop — Code Reading Notes

## Scope actually read

تم تحميل المستودع كاملًا من `https://github.com/NousResearch/hermes-agent` إلى `/home/ubuntu/hermes-agent`، وتمت قراءة كود `apps/desktop` فعليًا، وليس الاكتفاء بصفحة GitHub. شملت القراءة:

- `apps/desktop/DESIGN.md`
- `apps/desktop/src/app/index.tsx`
- `apps/desktop/src/app/routes.ts`
- `apps/desktop/src/app/chat/index.tsx`
- `apps/desktop/src/app/chat/composer/index.tsx`
- `apps/desktop/src/app/settings/index.tsx`
- `apps/desktop/src/app/settings/providers-settings.tsx`
- `apps/desktop/src/app/settings/primitives.tsx`
- `apps/desktop/src/app/overlays/overlay-split-layout.tsx`
- `apps/desktop/src/app/skills/mcp-tab.tsx` (master-detail region)
- `apps/desktop/src/components/onboarding/providers.tsx`

## Architectural findings

### 1. Chat is the home surface

Hermes explicitly treats Chat as the home surface. The transcript and composer stay primary, while previews, files, review, terminal, and other tools complement the current conversation. The app does not make the user leave the conversation to access every capability.

In code, `src/app/chat/index.tsx` composes `Thread`, `ChatRuntimeBoundary`, and `ChatBar` inside the primary pane. The `ChatRuntimeBoundary` owns the external-store runtime and transcript windowing, while `ChatViewContent` avoids subscribing the entire shell to every streaming token. This is an important performance pattern: streaming updates are isolated to the runtime/message layer instead of re-rendering header, composer, and chrome on every delta.

### 2. Pages versus overlays are deliberate

`src/app/routes.ts` defines durable pages such as `/` for new chat, `/skills`, `/messaging`, `/artifacts`, and `/settings`. Settings, Profiles, Cron, Agents, Command Center, Starmap, and Webhooks are classified as overlay views in `OVERLAY_VIEWS`. The route changes the visible destination, but Settings can float over the current workspace and return the user to the same conversation.

This preserves context: opening Settings does not destroy or replace the active Chat session. The same route model also distinguishes full workspace pages from overlays using `isWorkspacePageRoute()` and synchronizes the workspace pane without stealing the foreground transcript.

### 3. Settings are data-driven and hierarchical

`src/app/settings/index.tsx` builds a data-driven `navGroups` model. It supports top-level sections, nested sub-links, separators, deep-linkable query parameters, and a responsive dropdown on narrow widths. Provider navigation is explicitly split into Accounts, API keys, and Custom endpoints. API keys have their own nested Tools/Settings split.

`src/app/overlays/overlay-split-layout.tsx` implements the layout: a 13rem left rail on wide screens, a single dropdown bar below the narrow breakpoint, a scrollable main pane, and flat rows. It does not stack a long sidebar into the content; it swaps the rail for a compact selector.

### 4. Providers use shared onboarding components

`src/app/settings/providers-settings.tsx` deliberately reuses the same provider rows as first-run onboarding. The code comments state that the onboarding picker and Settings stay visually identical by using shared components from `src/components/onboarding/providers.tsx`.

The provider view leads with a featured/recommended provider, then connected providers, then an expandable list of other providers. The API-key path groups environment variables by provider, supports searching, and exposes a Local/custom endpoint row. Connected rows include status, description, and a clear/disconnect action where ownership permits it.

### 5. MCP is a capabilities workspace, not a small form

`src/app/skills/mcp-tab.tsx` uses a master-detail layout from `src/app/master-detail.tsx`. The left column combines configured servers and an installable catalog, with live enabled/status/probe information and an add row. The right side provides a JSON `mcp.json` editor and a pinned logs pane underneath. Selecting a server changes the left detail pane, while the overall capability context remains visible.

This is more scalable than a vertical form because it separates fleet discovery, configuration detail, raw config, status, and logs without hiding everything behind modal steps.

### 6. Settings primitives follow flat, row-based design

`src/app/settings/primitives.tsx` defines `SettingsContent`, `SettingsSection`, `SectionHeading`, `ListRow`, and `ToggleRow`. The visual contract is one heading plus a run of rows, with labels/descriptions on the left and controls aligned on the right at sufficient width. The design avoids nested card-in-card surfaces and relies on shared spacing and hairline tokens.

### 7. Composer is a system, not one textarea

`src/app/chat/composer/index.tsx` shows that Hermes treats the composer as a subsystem. It owns draft persistence, undo/redo, queued prompts, attachments, voice, slash/@ completions, context actions, pop-out behavior, status stacks, dropped files, inline references, steering, and cancellation. The composer remains mounted and scoped to the active session so temporary UI changes do not lose the draft or queue.

## Implications for Xeo Forge

Xeo Forge's unified `/chat` Workspace direction is correct, but the next implementation should borrow the deeper structural patterns rather than only the visual appearance:

| Hermes pattern | Xeo Forge implication |
| --- | --- |
| Chat as home + complementary work panes | Keep `/chat` as the home and let Work begin from the same surface; keep `/work/[id]` as the governed run detail. |
| Settings as overlay/context-preserving destination | Preserve the active session when Settings opens; consider a true overlay or focused panel rather than a separate long page. |
| Data-driven grouped settings nav | Keep Providers split into Accounts/API keys/Custom endpoints and move MCP/Skills into capability-focused destinations with nested navigation. |
| Shared onboarding/provider rows | Reuse the same provider card and setup primitives in quick setup and full settings. |
| MCP master-detail | Replace the current MCP form with installed servers + catalog on the left, selected server configuration on the right, and logs/status below. |
| Flat ListRow primitives | Reduce nested rounded cards in Xeo Forge Settings and use consistent heading/row/control primitives. |
| Composer subsystem | Grow the current unified composer incrementally: attachments, context actions, queue/status, and model/provider pill should be added without making the main workspace noisy. |

## Sources

[1]: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/DESIGN.md "Hermes Desktop Design System"

[2]: https://github.com/NousResearch/hermes-agent/tree/main/apps/desktop "Hermes Desktop source directory"

[3]: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/app/chat/index.tsx "Hermes Desktop Chat source"

[4]: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/app/settings/index.tsx "Hermes Desktop Settings source"

[5]: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/app/skills/mcp-tab.tsx "Hermes Desktop MCP source"

## Live Electron run (Aug 24, 2026)

تم تشغيل Hermes Desktop فعليًا عبر Electron على Xorg، مع renderer Vite من `apps/desktop` وDevTools CDP. تعذر تشغيل background gateway في التشغيل الأول، فظهرت شاشة recovery حقيقية بعنوان **Hermes couldn't start** مع Retry وRepair install وGateway settings وOpen logs. هذا لا يعني أن renderer فشل؛ فحص DOM عبر CDP أكد أن shell نفسه كان مرسومًا ويحتوي على:

- rail ثابتة: `SESSIONS`, `BOTS`, `New session`, `Ctrl N`.
- capabilities durable: `Messaging`, `Artifacts`, `Scheduled jobs`.
- مساحة عمل تبدأ بـ `No sessions yet` و`New project`.
- حالة gateway واضحة: `Gateway offline`.
- onboarding مدمج داخل التطبيق: `Let's get you setup with Hermes Agent` و`Connect a model provider to start chatting. Most options take one click.`

الاستنتاج التصميمي الجديد: Xeo Forge يجب أن يتوقف عن تقديم شاشة hero كبيرة تشبه landing page. البداية الأنسب هي shell desktop كثيف وهادئ: rail يسارية ثابتة، session list، capability navigation، main pane واضح، setup state مرئي، وcomposer قريب من أسفل مساحة العمل. يجب أن تكون حالة provider/gateway جزءًا من shell، لا مجرد Quick setup بعيد داخل صفحة Settings.

Reference runtime screenshot captured at `/home/ubuntu/hermes-reference/hermes-desktop-main.png`, with runtime notes at `/home/ubuntu/hermes-reference/observations.md`.
