# UI redesign research

## Reference repositories and pages

- Hermes Agent repository: https://github.com/nousresearch/hermes-agent
- Hermes Desktop directory: https://github.com/NousResearch/hermes-agent/tree/main/apps/desktop
- Sidebar inspiration article: https://www.navbar.gallery/blog/best-side-bar-navigation-menu-design-examples

## Findings

Hermes Desktop is a native desktop surface with a dedicated `apps/desktop` package, separated renderer/electron concerns, and a design document. Its information architecture is organized around a persistent desktop workspace rather than a marketing-style landing page. The useful reference is the separation of the desktop shell, settings, provider/runtime concerns, and capability surfaces; the Xeo Forge implementation should preserve its own brand and behavior instead of copying Hermes visuals.

The sidebar reference emphasizes vertical scanning, expandable sections, icon support, responsive/collapsible behavior, context-aware navigation, and clear primary actions. The Supabase example is specifically called out for handling dense navigation using defined categories, subtle separators, restrained typography, and hierarchy that reduces cognitive load.

## Direction for Xeo Forge

Use a neutral charcoal/stone palette with one restrained warm accent for focus and status. Avoid neon cyan/green/purple gradients, glowing cards, excessive pills, and overly rounded surfaces. Keep the shell quiet, use a compact navigation rail with clear groups, and make Settings a dedicated control-plane experience with a left sub-navigation and one content pane. Group Providers, MCP, Skills, Browser, Memory, and Updates into distinct sections with visible counts/statuses. Preserve existing API behavior and safety copy while improving hierarchy and scanability.

## Local visual verification

The local `/settings` screen now renders a two-column control-plane layout: the global app rail remains narrow, while a dedicated settings index groups six areas—Providers, Runtime, Profiles, Skills, MCP, and Memory. The active Provider section uses neutral steel surfaces with a restrained amber focus accent. The page avoids cyan/purple neon cards and the settings index collapses into a horizontal scroller below the wide desktop breakpoint.

A local review account was created only for visual verification: `ui-review-2026@example.local`. No user credentials were used.

## Screenshot set

The final verification captures include a light-mode top view, a light-mode mid-page view showing Profile Studio, and a dark-mode view showing Skills, MCP, and the memory cards. The screenshots are visual evidence of the redesign and are copied into `docs/ui-screens/` for delivery.

## Unified Chat / Work direction

The new request shifts the product toward a single home surface. Hermes Desktop's documented principles are useful here: Chat is the home surface; the transcript and composer remain primary; tools, previews, files, review, and terminal complement the conversation; settings and command center behave as overlays or focused destinations; and the design should be flat rather than nested card-in-card. Source: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/DESIGN.md

Xeo Forge should therefore keep one persistent conversation workspace, place a compact Chat / Work mode switch in the surface header, and reveal Work-only controls—project boundary, profile, skill, attachments, plan review—without creating a second top-level navigation destination. The governed Work detail view can remain specialized after a run starts, while the entry experience stays unified.

## Unified workspace visual verification

The unified `/chat` route now presents a single Workspace surface. The header exposes two explicit modes: Chat / Explore and decide, and Work / Plan and execute. Chat keeps a quiet transcript-oriented composition with a simple composer and starter prompts. Work reveals a compact setup strip for project boundary, role, workflow, attachments, and approval-first behavior without opening a separate intake page.

The global rail now exposes Workspace and Settings rather than separate Chat and Work destinations. Existing `/work/[id]` remains the governed run detail surface after a Work session starts, preserving the richer plan/activity/project/preview/context/terminal/diff tooling.
