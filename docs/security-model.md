# Xeo Forge Security Model

> Status: v1.18.0 draft. This document states what each security layer
> defends, what it explicitly does NOT defend, and the known bypass classes.
> It exists so that no reader has to reverse-engineer the threat model from
> regex lists (AGENTS.md: honest boundaries are a product contract).

## Layer map

| Layer | File | Defends against | Does NOT defend against |
|---|---|---|---|
| Workspace confinement | `lib/agent/files.ts` | Path traversal, absolute escapes, symlink escape **via the file tools** | TOCTOU races where another process mutates the tree mid-operation; anything done by `code_execute` |
| Command denylist | `lib/agent/code.ts` (`DANGEROUS`) | Obvious destructive one-liners typed as command text | What a program does after it starts (see Known bypasses) |
| Env whitelist | `lib/agent/code.ts` (`buildSafeEnv`) | Secret leakage (`MODEL_API_KEY`, `DATABASE_URL`) into child processes | A child reading files inside the workspace that legitimately contain secrets the user put there |
| Approval gate | DB status machine + `build-policy.ts` | Write tools running without an immutable approved plan | Social engineering of the human approver |
| Memory sanitization | `loop.ts` `sanitizeMemoryCandidates` | Secrets/prompt-injection entering persistent memory via candidates | Content-shaped secrets not matching value patterns |
| Credits atomicity | `lib/credits/engine.ts` | Balance races; double-spend | Nothing — this one is a hard invariant |

## The boundary truth (unchanged, now with examples)

`code_execute` is **restricted host execution**, not a sandbox. The denylist
inspects the command *string*. It cannot see what a program does once it
starts. Concretely, all of these execute arbitrary behavior the patterns will
never match:

- `python3 s.py` / `bash s.sh` / `make` / `npm run x` — any interpreter given
  a file written earlier by `file_write`. The script may import `socket`,
  call `os.system`, read `/etc/passwd`, or reach the cloud metadata endpoint.
- `node -e "fetch('http://169.254.169.254/latest/meta-data/')"` — the runtime
  is installed on every dev machine; loopback/metadata curl patterns do not
  apply to it.
- `curl 127.1`, `curl 0x7f000001`, `curl [::1]` — short-form and hex IP
  encodings of loopback evade the `127\.0\.0` literal.
- Python network access without `socket`: `import urllib.request` /
  `http.client` are not in the import denylist.

Closing these requires OS-level isolation (per-task container/VM). That is
the declared `secure-isolated` runtime profile on the roadmap and is out of
scope for `local-restricted-host`.

## Symlink + code_execute interaction (known seam)

The file-tool boundary (`resolveWithin`) realpaths the closest existing
ancestor of a target path. Because `code_execute` shares the same workspace,
a build-mode agent can create symlinks itself (`ln -s /etc x`). The file
tools then refuse writes through them only while the ancestor check observes
a consistent tree. Two operations racing (tool resolve vs. shell rename) can
in principle interleave — this is a TOCTOU seam inherent to non-sandboxed
host execution. Mitigation in depth for v1.18: regression test
(`test/v118-hardening.test.ts` pins tool-level rejection of symlinked
targets created by shell); full closure deferred to the isolated profile.

## Threat-model statements (what we claim / do not claim)

1. **We claim**: planning mode cannot write or execute — enforced in code,
   defense-in-depth at the runner (`canStartAgentRun`).
2. **We claim**: file tools cannot write outside the task workspace absent a
   race; see the seam note above.
3. **We claim**: child processes never inherit platform secrets.
4. **We do NOT claim**: hostile-tenant isolation of `code_execute`.
   Semi-trusted workloads only, exactly as the README has always said.

## v1.18 changes folded into this document

- Denylist bypass examples documented verbatim (previously implicit).
- `python()` rewritten to fs-write snippets: removes the entire
  shell-quoting class of bugs, including the Windows-broken `printf '%s'`
  path, and resolves the interpreter per-platform (`py -3 || python`).
- Arabic autonomy-violation detectors added: an Arabic-language run asking
  the user questions in build mode is now nudged like its English
  counterpart (language parity for the approval-gate UX).
