# Visual verification — Chat surfaces

The rebuilt Chat surface was reviewed in both themes at 1280×1100.

The Dark version uses a true near-black canvas, a darker left session rail, white primary typography, and neutral gray secondary text. The Light version uses a white canvas, pale neutral rail, black primary typography, and gray secondary text. Both versions remove the previous amber/cyan treatment and do not use gradients or glow.

The visual hierarchy is now desktop-first: the left rail owns brand, Sessions, New session, and Capabilities; the header owns the current Workspace label and the Chat/Work segmented switch; the main pane owns the conversation state; and the composer remains anchored to the bottom. Starter prompts are flat rows separated by hairlines rather than three decorative cards. The composer uses one restrained framed surface and a single filled action button.

The current result is materially closer to the Hermes desktop information architecture and to Geist/Vercel principles of flat surfaces, functional color, compact labels, and typography-led hierarchy. The remaining work is to verify Work and Settings in both themes and run interaction/build checks.

## Work and Settings verification

Work Dark now uses the same neutral black canvas and white text hierarchy as Chat. The setup area is separated by hairlines and presents Project boundary, Role, and Workflow as compact working context. The setup-needed badge is monochrome, and the approval-first composer remains visually subordinate to the main work surface.

Settings Light now uses a white canvas and black primary text. The left settings index is a single outlined master panel, while the main content uses one provider surface, compact tabs, and a linear Quick setup strip. Previous colored status treatments have been reduced to neutral gray so the system stays black/white-first. Providers, Runtime, Profiles, Skills, MCP, and Memory remain visible as distinct destinations.
