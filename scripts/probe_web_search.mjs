/** Live web_search probe — proves the tool end-to-end before shipping it. */
import { runWebSearch } from '../lib/agent/web-search.ts';

const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['Next.js 15 release notes', 'أخبار الذكاء الاصطناعي اليوم'];
for (const q of queries) {
  const t0 = Date.now();
  try {
    const out = await runWebSearch(q);
    console.log(`OK (${Date.now() - t0}ms) "${q}"\n${out.slice(0, 600)}\n---`);
  } catch (err) {
    console.log(`FAIL (${Date.now() - t0}ms) "${q}"\n  ${err?.message ?? err}\n---`);
  }
}
