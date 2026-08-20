'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

/* ── Simple syntax highlighter (no deps) ─────────────────────────── */

function highlightLine(text: string, lang: string): string {
  // Protect strings and comments as placeholders first, then highlight
  // keywords and numbers in what remains.
  let result = text
    .replace(/&(?!amp;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Extract strings and comments as placeholders
  const placeholders: string[] = [];
  const extract = (re: RegExp) => {
    result = result.replace(re, (m) => {
      const idx = placeholders.length;
      placeholders.push(`<span class="hl-str">${m}</span>`);
      return `\x00${idx}\x00`;
    });
  };

  if (lang === 'py' || lang === 'py3') {
    extract(/#.*/g);
    extract(/"""[\s\S]*?"""/g);
    extract(/'''[\s\S]*?'''/g);
  } else {
    extract(/\/\/.*$/gm);
    extract(/\/\*[\s\S]*?\*\//g);
  }
  extract(/"[^"\\]*(\\.[^"\\]*)*"/g);
  extract(/'[^'\\]*(\\.[^'\\]*)*'/g);
  extract(/`[^`\\]*(\\.[^^\\]*)*`/g);

  // Highlight keywords
  const kwList = lang === 'py' || lang === 'py3'
    ? ['def','class','return','if','else','elif','for','while','import','from','as','try','except','finally','raise','with','yield','lambda','pass','break','continue','and','or','not','in','is','None','True','False','self','async','await','print']
    : ['const','let','var','function','return','if','else','for','while','class','import','export','from','default','async','await','try','catch','throw','new','this','typeof','instanceof','switch','case','break','continue','do','in','of','yield','void','delete','static','extends','super','finally'];
  for (const kw of kwList) {
    result = result.replace(new RegExp(`\\b${kw}\\b`, 'g'), (m) => `<span class="hl-kw">${m}</span>`);
  }

  // Highlight numbers
  result = result.replace(/\b(\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="hl-num">$1</span>');

  // Restore placeholders
  result = result.replace(/\x00(\d+)\x00/g, (_, i) => placeholders[Number(i)] || '');

  return result;
}

function langFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'py', py3: 'py',
    html: 'html', css: 'css', json: 'json', md: 'md', sh: 'sh',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', sql: 'sql',
    java: 'java', go: 'go', rs: 'rs', rb: 'rb', php: 'php',
  };
  return map[ext] || 'text';
}

function formatSize(n?: number): string {
  if (n === undefined || n === null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── File tree types ─────────────────────────────────────────────── */

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
  truncated?: boolean;
}

interface WorkspaceData {
  tree: FileNode[];
  totalFiles: number;
  totalSize: number;
}

/* ── Tree item ───────────────────────────────────────────────────── */

function TreeItem({
  node, depth, selected, onSelect, onLoadDir, loadedDirs,
}: {
  node: FileNode; depth: number; selected: string | null;
  onSelect: (path: string) => void;
  onLoadDir: (dirPath: string) => void;
  loadedDirs: Set<string>;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isDir = node.type === 'dir';
  const isSelected = selected === node.path;

  const handleClick = () => {
    if (isDir) {
      const nextOpen = !open;
      setOpen(nextOpen);
      if (nextOpen && node.children && node.children.length === 0 && !loadedDirs.has(node.path)) {
        onLoadDir(node.path);
      }
    } else {
      onSelect(node.path);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`flex w-full items-center gap-1.5 py-0.5 text-meta hover:bg-ink-700/60 transition-colors ${
          isSelected ? 'bg-indigo-500/10 text-indigo-300' : 'text-content-secondary'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isDir ? (
          <svg className={`h-3 w-3 shrink-0 text-content-muted transition-transform ${open ? 'rotate-90' : ''}`}
               fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="truncate">{node.name}{isDir ? '/' : ''}</span>
        {!isDir && node.size !== undefined && (
          <span className="ml-auto text-micro text-content-muted shrink-0">{formatSize(node.size)}</span>
        )}
      </button>
      {isDir && open && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} onLoadDir={onLoadDir} loadedDirs={loadedDirs} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Code viewer ─────────────────────────────────────────────────── */

function CodeViewer({ content, path }: { content: string; path: string }) {
  const lang = langFromPath(path);
  const lines = content.split('\n');

  return (
    <div className="overflow-auto max-h-[70vh] rounded-control bg-[#0a0c10] border border-line-subtle">
      <table className="w-full text-meta font-mono leading-relaxed">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-ink-700/60">
              <td className="sticky left-0 text-right pr-3 pl-3 text-content-muted select-none bg-[#0a0c10] w-12 border-r border-white/[0.04]">
                {i + 1}
              </td>
              <td className="px-3 text-content-secondary whitespace-pre" dangerouslySetInnerHTML={{
                __html: highlightLine(line, lang)
              }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main workspace viewer ───────────────────────────────────────── */

export function WorkspaceViewer({ taskId }: { taskId: string }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [search, setSearch] = useState('');
  const [loadedDirs, setLoadedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/workspace`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [taskId]);

  // Lazy-load a subdirectory's children into the tree
  const loadDir = useCallback(async (dirPath: string) => {
    if (!data) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}/workspace?path=${encodeURIComponent(dirPath)}`);
      if (!res.ok) return;
      const sub = await res.json();
      if (!sub.tree) return;

      // Merge subdirectory children into the tree
      const mergeTree = (nodes: FileNode[]): FileNode[] =>
        nodes.map((n) => {
          if (n.type === 'dir' && n.path === dirPath) {
            return { ...n, children: sub.tree, truncated: false };
          }
          if (n.children) {
            return { ...n, children: mergeTree(n.children) };
          }
          return n;
        });

      setData((prev) => prev ? { ...prev, tree: mergeTree(prev.tree) } : prev);
      setLoadedDirs((prev) => new Set([...prev, dirPath]));
    } catch { /* ignore */ }
  }, [taskId, data]);

  const loadFile = useCallback(async (filePath: string) => {
    setSelected(filePath);
    setLoadingFile(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/workspace/${filePath}`);
      if (res.ok) {
        const d = await res.json();
        setFileContent({ path: filePath, content: d.content });
      }
    } finally {
      setLoadingFile(false);
    }
  }, [taskId]);

  // Filter tree by search
  const filteredTree = useMemo(() => {
    if (!search || !data) return data?.tree || [];
    const q = search.toLowerCase();
    const filter = (nodes: FileNode[]): FileNode[] =>
      nodes.filter((n) => {
        if (n.name.toLowerCase().includes(q)) return true;
        if (n.children) {
          const filtered = filter(n.children);
          return filtered.length > 0;
        }
        return false;
      }).map((n) => n.children ? { ...n, children: filter(n.children) } : n);
    return filter(data.tree);
  }, [data, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-meta text-content-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-live-pulse mr-2" />
        loading workspace…
      </div>
    );
  }

  if (!data || data.totalFiles === 0) {
    return (
      <div className="text-center py-12 text-meta text-content-muted">
        workspace is empty
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-content-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="search files…"
            className="w-full rounded-control border border-line bg-ink-700/60 pl-8 pr-3 py-1.5 text-meta text-content-secondary placeholder-gray-600 outline-none focus:border-line-strong"
          />
        </div>
        <span className="text-micro text-content-muted shrink-0">
          {data.totalFiles} files · {formatSize(data.totalSize)}
        </span>
      </div>

      {/* Split: tree + viewer */}
      <div className="flex gap-3 min-h-0" style={{ height: '60vh' }}>
        {/* File tree */}
        <div className="w-48 shrink-0 overflow-y-auto rounded-control border border-line-subtle bg-ink-700/60 p-1.5">
          {filteredTree.map((node) => (
            <TreeItem key={node.path} node={node} depth={0} selected={selected} onSelect={loadFile} onLoadDir={loadDir} loadedDirs={loadedDirs} />
          ))}
        </div>

        {/* Code viewer */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {loadingFile ? (
            <div className="flex items-center justify-center h-full text-meta text-content-muted">
              loading file…
            </div>
          ) : fileContent ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-micro font-mono text-content-muted">{fileContent.path}</span>
              </div>
              <CodeViewer content={fileContent.content} path={fileContent.path} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-meta text-content-muted">
              select a file to view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
