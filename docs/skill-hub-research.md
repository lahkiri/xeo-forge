# Skill Hub research findings

## Hermes Agent

Hermes treats Skills as on-demand knowledge documents using progressive disclosure. The primary source of truth is `~/.hermes/skills/`; bundled, hub-installed, and agent-created skills share that directory, while external skill directories can be scanned alongside it. Installed skills are exposed as slash commands, and Hermes supports stacking up to five leading skill commands in a single message. Its documented levels are: list lightweight metadata, view a full `SKILL.md`, and view a specific reference file.

Hermes also supports `/learn`, which turns a local directory, URL, pasted procedure, or large document corpus into a reusable skill. Large sources become a lean `SKILL.md` plus on-demand files under `references/`. The dashboard exposes a Learn a skill panel, but the resulting work is still a normal agent turn and skill writes pass through the skill write-approval gate.

## Vercel skills ecosystem

The `vercel-labs/skills` repository is the open agent-skills tool behind skills.sh. Its repository structure includes a `skills/find-skills` skill, a CLI source tree, tests, and documentation. The public repo states that valid skills require a `SKILL.md` with `name` and `description` frontmatter. This supports implementing an Xeo Skill Hub around discovery, metadata preview, safe import, validation, enable/disable state, and local lifecycle management.

## User-provided skills.sh proposal

The attached notes propose discovery through `https://skills.sh/api/search?q=...`, metadata through `/api/metadata/:owner/:repo/:skill`, and raw `SKILL.md` through `/api/download/:owner/:repo/:skill`. For complete skill resources, the notes recommend resolving the GitHub source repository and recursively reading its contents rather than downloading only `SKILL.md`.

## Implementation direction

Xeo Forge should keep database metadata and imported files separate: catalog metadata in application tables, and imported files in a controlled local skills directory. Remote content must be treated as untrusted data. The importer should only accept validated GitHub owner/repository/ref/path inputs, limit file count and size, prevent path traversal, store a manifest, and never execute imported scripts automatically. Runtime should inject only the selected skill's validated instructions and expose its references to the agent through a controlled read operation.

## References

1. Hermes Skills System: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
2. Vercel skills repository: https://github.com/vercel-labs/skills
3. User-provided skills.sh and GitHub Contents API notes: `/home/ubuntu/upload/pasted_content.txt`


## Live endpoint verification

The documented `/api/v1/skills/search` and detail endpoints currently return HTTP 401 without an official token. The legacy `/api/search?q=git` endpoint remains publicly accessible and returns `{ query, searchType, searchVersion, skills }`, with result fields such as `skillId`, `name`, `installs`, and `source`. The Xeo Skill Hub therefore uses the public legacy search endpoint for discovery and the GitHub Contents API for complete file import, rather than pretending the token-protected v1 API is unauthenticated.

The local Skills page now shows the Skill Hub above the existing Skill Studio. A live search for `git` returned multiple results from `github/awesome-copilot`, `mattpocock/skills`, and `obra/superpowers`, each with an Import action and source/install metadata.


## Install flow verification

The Skill Hub discovery results now expose an explicit `Install` action. After searching `git`, the previously imported `github/awesome-copilot/git-commit` result correctly displayed `Installed`, while the remaining results displayed `Install`. Installation uses the existing full-folder GitHub importer, so SKILL.md and available references/resources are downloaded into the local skill bundle and the catalog is refreshed after completion.
