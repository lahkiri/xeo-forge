# Xeo Forge full UI rebuild specification

## Direction

The rebuild will use Hermes Desktop as the interaction and information-architecture reference, not as a visual clone. Chat remains the home surface. A persistent desktop shell owns sessions, capabilities, projects, status, and composer context. Settings, profiles, MCP, skills, and providers are durable capability destinations or focused overlays rather than a long marketing-style page.

## Visual system

The visual language will use a strict neutral palette: near-black surfaces and white/near-white text for Dark; white and near-white surfaces with black/near-black text for Light. Blue or colored gradients, glow, large shadows, and decorative AI-style accents are removed. Accent color is reserved for focus, active selection, links, and explicit status feedback. Borders are single-pixel hairlines and surfaces are flat. Rounded corners are limited to controls and floating surfaces.

The hierarchy follows Geist/Vercel guidance: typography, spacing, and contrast establish hierarchy; color is functional. Body and labels use compact, readable sizes, while page titles avoid oversized marketing hero treatment. Controls use a small, repeatable set of variants. Settings rows are flush-left and organized by whitespace, with a single hairline only where grouping requires it.

## Hermes-informed interaction model

The left rail will contain brand, Sessions/Bots context, New session, session search/list, and durable Capabilities. The main pane will prioritize transcript and composer. Composer controls will expose model/context/status without forcing navigation. Preview, files, terminal, and review are working-context panes that can be toggled without replacing the transcript. Settings is a focused destination/overlay with master-detail navigation. MCP and Skills use catalog/list plus detail editing instead of a stack of unrelated cards.

## References

- Geist introduction: https://vercel.com/geist/introduction
- Geist typography: https://vercel.com/geist/typography
- Hermes Desktop design contract: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/DESIGN.md
- Hermes Desktop user guide: https://hermes-agent.nousresearch.com/docs/user-guide/desktop
