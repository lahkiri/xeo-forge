# Structural rebuild visual findings

Chat was rebuilt as a desktop application surface rather than a centered landing page. The new shell has a persistent session rail, workspace switcher, New chat and Search sessions controls, capability navigation, runtime/account footer, top breadcrumb bar, session bar, mode tabs, centered empty-state transcript, flat prompt rows, and a bottom composer dock with model/context state.

Dark mode uses near-black surfaces and white primary content. Light mode inverts the hierarchy to white surfaces and black primary content. The component geometry is shared between themes rather than duplicated. The welcome state uses a small geometric brand mark and a concise task-oriented title; there are no large decorative cards, gradients, glow effects, or colored AI accents.

The new visual direction is materially closer to Codex/Hermes desktop patterns: the user can see where the current session lives, what mode is active, where capabilities are managed, and what context the composer will use. Work-specific context is reserved for Work mode rather than competing with Chat.

## Work and Settings

Work now reads as a separate execution state within the same session surface: the top bar identifies Work, the empty state asks for a build outcome, and a single working-context section contains project boundary, role, workflow, attachments, and approval semantics. It does not introduce a second app or a separate landing page.

Settings keeps the application shell and uses a focused control-plane layout with a durable left index and a provider detail surface. It remains compatible with the existing settings APIs, while the visual language is now consistent with the newly rebuilt Workspace.
