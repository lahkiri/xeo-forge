---
name: one-design-language
description: Constrains UI work to the shared design token vocabulary. Use when creating or modifying any component — new CSS values local to one screen are forbidden; every visual decision comes from the existing tokens (spacing, radii, colors, type scale) in globals.css.
---

Every Xeo Forge interface change reuses the established token vocabulary: spacing steps, radii, the ink/content/line/signal color roles, and the type scale defined in app/globals.css. When a component appears to need a new color, radius, or spacing value, the agent treats that as a design-system gap to resolve first — either an existing token already covers the need (usually) or the new token is added once, centrally, with a name that describes its role rather than its appearance.

Screen-local CSS classes that duplicate token effects (a bespoke shadow here, a one-off radius there) are treated as defects, not shortcuts. The same discipline applies to icons: components/icons.tsx is the only source of glyphs, and unicode symbols standing in for icons are removed on sight. The test the agent applies: if two screens implement the same visual idea differently, one of them is wrong.
