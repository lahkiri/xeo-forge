'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

type SkillHubSearchResult = {
  id: string;
  skillId: string;
  name: string;
  source: string;
  installs: number;
  sourceType: string;
  installUrl?: string;
  url?: string;
};

type Notice = { tone: 'ok' | 'error'; text: string } | null;

export default function SkillHub() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SkillHubSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true); setNotice(null);
    try {
      const response = await fetch(`/api/skill-hub/search?q=${encodeURIComponent(query.trim())}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Skill Hub search failed.');
      setResults(body.skills || []);
      if ((body.skills || []).length === 0) setNotice({ tone: 'error', text: 'No matching skills found.' });
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Skill Hub search failed.' }); }
    finally { setSearching(false); }
  }

  return <section className="skill-hub-panel"><div className="skill-hub-head"><div><p className="skill-hub-kicker">SKILL HUB / DISCOVERY</p><h2>Explore skills from the open directory</h2><p>Search skills.sh and inspect what is available. To add one to your workspace, use the explicit import actions in Skill Studio below.</p></div><span className="skill-hub-badge">skills.sh</span></div><form className="skill-hub-search" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills, e.g. git, research, next.js" aria-label="Search Skill Hub" /><Button type="submit" loading={searching} disabled={query.trim().length < 2}>Search</Button></form>{notice && <p className={`skill-hub-notice ${notice.tone}`}>{notice.text}</p>}{results.length > 0 && <div className="skill-hub-results" aria-live="polite">{results.map((skill) => <article className="skill-hub-result" key={skill.id}><div className="skill-hub-result-copy"><strong>{skill.name}</strong><small>{skill.source} · {skill.installs.toLocaleString()} installs</small></div>{skill.url && <a className="skill-hub-result-link" href={skill.url} target="_blank" rel="noreferrer">View source ↗</a>}</article>)}</div>}</section>;
}
