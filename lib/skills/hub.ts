import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAgentSkill } from '@/lib/db/queries';
import type { AgentSkill, AgentSkillKind, SkillHubFile } from '@/lib/types';

const SKILLS_SH_API = 'https://skills.sh/api';
const GITHUB_API = 'https://api.github.com';
const MAX_FILES = 80;
const MAX_FILE_BYTES = 512_000;
const MAX_TOTAL_BYTES = 4_000_000;
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export interface SkillHubSearchResult {
  id: string;
  skillId: string;
  name: string;
  source: string;
  installs: number;
  sourceType: string;
  installUrl?: string;
  url?: string;
}

interface GitHubEntry {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  path: string;
  name: string;
  download_url?: string | null;
  url: string;
}

interface ImportedFile {
  path: string;
  bytes: Buffer;
}

function assertSafeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SAFE_SEGMENT.test(trimmed)) throw new Error(`Invalid ${label}.`);
  return trimmed;
}

function normalizeRelativePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error('Skill contains an unsafe file path.');
  }
  return normalized;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Xeo-Forge-Skill-Hub' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Remote skill source returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

function parseSkillMarkdown(markdown: string): { name: string; description: string; kind: AgentSkillKind; instructions: string } {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md must contain YAML frontmatter.');
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!field) continue;
    fields[field[1].toLowerCase()] = field[2].trim().replace(/^['"]|['"]$/g, '');
  }
  const name = fields.name?.trim();
  const description = fields.description?.trim();
  if (!name || !description) throw new Error('SKILL.md frontmatter must include name and description.');
  const rawKind = (fields.kind || fields.category || 'custom').toLowerCase();
  const kind: AgentSkillKind = ['build', 'research', 'analysis', 'operations', 'content'].includes(rawKind) ? rawKind as AgentSkillKind : 'custom';
  return { name: name.slice(0, 100), description: description.slice(0, 500), kind, instructions: markdown.slice(0, 12000) };
}

function sourceParts(source: string): { owner: string; repo: string } {
  const parts = source.split('/');
  if (parts.length !== 2) throw new Error('Only public GitHub skill sources are supported for import.');
  return { owner: assertSafeSegment(parts[0], 'source owner'), repo: assertSafeSegment(parts[1], 'source repository') };
}

async function listGitHubRoot(owner: string, repo: string, skillSlug: string, ref?: string): Promise<GitHubEntry[]> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const candidates = [`${GITHUB_API}/repos/${owner}/${repo}/contents/skills/${encodeURIComponent(skillSlug)}${query}`, `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(skillSlug)}${query}`];
  for (const url of candidates) {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Xeo-Forge-Skill-Hub' }, cache: 'no-store' });
    if (response.ok) {
      const body = await response.json() as GitHubEntry | GitHubEntry[];
      if (Array.isArray(body)) return body;
    }
    if (response.status !== 404) throw new Error(`GitHub source returned HTTP ${response.status}.`);
  }
  throw new Error('Skill folder was not found in the GitHub repository.');
}

async function readGitHubTree(owner: string, repo: string, entries: GitHubEntry[], ref: string | undefined, output: ImportedFile[] = [], total = { bytes: 0 }, prefix = ''): Promise<ImportedFile[]> {
  for (const entry of entries) {
    if (output.length >= MAX_FILES) throw new Error(`Skill exceeds the ${MAX_FILES}-file import limit.`);
    const safePath = normalizeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name);
    if (entry.type === 'dir') {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const children = await fetchJson<GitHubEntry[]>(`${GITHUB_API}/repos/${owner}/${repo}/contents/${entry.path}${query}`);
      await readGitHubTree(owner, repo, children, ref, output, total, safePath);
      continue;
    }
    if (entry.type !== 'file' || !entry.download_url) continue;
    const response = await fetch(entry.download_url, { headers: { 'User-Agent': 'Xeo-Forge-Skill-Hub' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not download skill file ${safePath}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`Skill file ${safePath} exceeds the ${MAX_FILE_BYTES}-byte limit.`);
    total.bytes += bytes.byteLength;
    if (total.bytes > MAX_TOTAL_BYTES) throw new Error(`Skill exceeds the ${MAX_TOTAL_BYTES}-byte total import limit.`);
    output.push({ path: safePath, bytes });
  }
  return output;
}

export async function searchSkillHub(query: string, limit = 24): Promise<SkillHubSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const response = await fetch(`${SKILLS_SH_API}/search?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json', 'User-Agent': 'Xeo-Forge-Skill-Hub' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`skills.sh search returned HTTP ${response.status}.`);
  const body = await response.json() as { skills?: Array<Record<string, unknown>> };
  return (body.skills ?? []).slice(0, Math.min(Math.max(limit, 1), 50)).map((item) => ({
    id: String(item.id ?? ''),
    skillId: String(item.skillId ?? item.name ?? ''),
    name: String(item.name ?? item.skillId ?? 'Unnamed skill'),
    source: String(item.source ?? ''),
    installs: Number(item.installs ?? 0),
    sourceType: String(item.sourceType ?? 'github'),
    installUrl: item.installUrl ? String(item.installUrl) : undefined,
    url: item.url ? String(item.url) : undefined,
  })).filter((item) => item.source && item.skillId);
}

export async function importSkillFromGitHub(input: { userId: string; source: string; skillId: string; ref?: string }): Promise<AgentSkill> {
  const { owner, repo } = sourceParts(input.source);
  const skillId = assertSafeSegment(input.skillId, 'skill id');
  const ref = input.ref?.trim() ? assertSafeSegment(input.ref, 'git ref') : undefined;
  const entries = await listGitHubRoot(owner, repo, skillId, ref);
  const files = await readGitHubTree(owner, repo, entries, ref);
  const skillFile = files.find((file) => file.path === 'SKILL.md' || file.path.toLowerCase() === 'skill.md');
  if (!skillFile) throw new Error('Imported skill does not contain a root SKILL.md.');
  const markdown = skillFile.bytes.toString('utf8');
  const metadata = parseSkillMarkdown(markdown);
  const sourceId = `${input.source}/${skillId}`;
  const skillHash = createHash('sha256').update(Buffer.concat(files.map((file) => file.bytes))).digest('hex');
  const skillDbId = createHash('sha256').update(`${input.userId}:${sourceId}`).digest('hex').slice(0, 32);
  const relRoot = path.posix.join('data', 'skills', input.userId, skillDbId);
  const absoluteRoot = path.resolve(process.cwd(), relRoot);
  await mkdir(absoluteRoot, { recursive: true });
  try {
    for (const file of files) {
      const relPath = normalizeRelativePath(file.path);
      const absolutePath = path.resolve(absoluteRoot, relPath);
      if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error('Skill file escaped its import directory.');
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.bytes, { flag: 'wx' });
    }
    const manifest: SkillHubFile[] = files.map((file) => ({ path: file.path, bytes: file.bytes.byteLength, sha256: createHash('sha256').update(file.bytes).digest('hex') }));
    return await createAgentSkill({ userId: input.userId, name: metadata.name, kind: metadata.kind, description: metadata.description, instructions: metadata.instructions, sourceType: 'skills_sh', sourceId, sourceUrl: `https://skills.sh/${sourceId}`, sourcePath: relRoot, sourceRef: ref ?? 'default', sourceHash: skillHash, filesJson: JSON.stringify(manifest), importedAt: new Date().toISOString() });
  } catch (error) {
    await rm(absoluteRoot, { recursive: true, force: true });
    throw error;
  }
}


export async function readImportedSkillFile(input: { userId: string; skillId: string; relativePath: string }): Promise<string> {
  const { getAgentSkillById } = await import('@/lib/db/queries');
  const skill = await getAgentSkillById(input.skillId, input.userId);
  if (!skill || !skill.enabled || skill.source_type !== 'skills_sh' || !skill.source_path) throw new Error('The requested imported skill is not available.');
  const relativePath = normalizeRelativePath(input.relativePath);
  let manifest: SkillHubFile[];
  try { manifest = JSON.parse(skill.files_json || '[]') as SkillHubFile[]; } catch { throw new Error('Skill manifest is invalid.'); }
  if (!manifest.some((file) => file.path === relativePath)) throw new Error('That file is not part of the imported skill manifest.');
  const root = path.resolve(process.cwd(), skill.source_path);
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('Skill file escaped its import directory.');
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(absolutePath, 'utf8');
  return content.slice(0, MAX_FILE_BYTES);
}
