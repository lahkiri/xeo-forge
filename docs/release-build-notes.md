# Release build notes

## Windows CI v1.1.0

Source: [GitHub Actions run 31993057727](https://github.com/lahkiri/xeo-forge/actions/runs/31993057727)

The workflow reached electron-builder successfully. The failure occurred during Windows packaging because electron-builder reported:

> image D:\\a\\xeo-forge\\xeo-forge\\desktop\\assets\\icon.ico must be at least 256x256

The run also emitted non-blocking warnings about forced Node.js 24 for actions targeting Node.js 20 and an unavailable Go cache file. The blocking issue is the ICO dimensions. The icon must be regenerated with a 256x256 image entry or larger before rerunning the workflow and creating the Release.

The run was triggered by tag `v1.1.0` at commit `9fcd04d`.

## Official release workflow

Workflow source: [windows-desktop.yml](https://github.com/lahkiri/xeo-forge/blob/master/.github/workflows/windows-desktop.yml)

Expected artifact: `dist/*.exe` uploaded as `xeo-forge-windows-installer`.

## Languages and boundaries

- TypeScript/React/Next.js: product UI, App Router pages, API routes, auth, database queries, agent orchestration, context compiler, SSE, and CRUD flows.
- Go: local runtime broker with health/contract endpoints and cross-platform native process boundary.
- JavaScript/CommonJS/ESM: Electron desktop shell and packaging preparation scripts.
- CSS/Tailwind: visual system and responsive presentation layer.
- YAML: GitHub Actions Windows build workflow.
- Python: development utility that generates the Windows ICO asset; not a runtime dependency.
