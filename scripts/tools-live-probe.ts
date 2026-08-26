// Live tool-executor probe: exercise executeTool directly for skill_view,
// http_request, file_read, file_list — the real code path the agent loop uses.
import { executeTool } from '../lib/agent/tools';

async function main(): Promise<void> {
  const { createToolContext } = await import('../lib/agent/tools');
  const ctx = createToolContext('audit-probe', process.env.XEO_PROBE_USER ?? '', 'chat', null);

  // skill_view: with no imported/selected skill, must refuse cleanly (not crash).
  try {
    const sv = await executeTool('skill_view', { path: 'references/guide.md' }, ctx);
    console.log('SKILL_VIEW:', sv.slice(0, 140).replace(/\s+/g, ' '));
  } catch (err) {
    console.log('SKILL_VIEW refused cleanly:', (err as Error).message.slice(0, 100));
  }

  // http_request (planning-only surface but executor-level test)
  try {
    const hr = await executeTool('http_request', { method: 'GET', url: 'https://example.com/' }, ctx);
    console.log('HTTP_REQUEST:', hr.slice(0, 120).replace(/\s+/g, ' '));
  } catch (err) {
    console.log('HTTP_REQUEST blocked/failed:', (err as Error).message.slice(0, 120));
  }

  // file_list
  const fl = await executeTool('file_list', {}, ctx);
  console.log('FILE_LIST:', fl.slice(0, 100).replace(/\s+/g, ' '));
}

main().catch((e) => { console.error('PROBE FAIL:', e?.message || e); process.exitCode = 1; });
