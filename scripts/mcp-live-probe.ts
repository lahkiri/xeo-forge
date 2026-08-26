// Live MCP probe (TS): spawn the real memory server via the project's own client,
// handshake, list tools, call one tool. No mocks. Run: npx tsx scripts/mcp-live-probe.ts
import { McpConnection } from '../lib/mcp/client';

async function main(): Promise<void> {
  const connection = new McpConnection({
  command: 'cmd',
  args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory'],
  env: {},
});
connection.spawnProcess();

try {
  const info = await connection.initialize(60000);
  console.log('INITIALIZED:', JSON.stringify(info));
  const tools = await connection.listTools();
  console.log('TOOLS RAW:', JSON.stringify(tools).slice(0, 600));
  const target = tools.find((tl) => tl.slug === 'create_entities') ?? tools[0];
  const args = target.slug === 'create_entities'
    ? { entities: [{ name: 'Xeo Probe', entityType: 'test', observations: ['live mcp probe from xeo forge'] }] }
    : {};
  const out = await connection.callTool(target.rawName ?? target.slug, args, 'memory-test');
  console.log('CALL RESULT:', JSON.stringify(out).slice(0, 400));
  console.log('MCP-LIVE: PASS');
} catch (err) {
  console.error('MCP-LIVE: FAIL —', (err as Error)?.message || err);
  process.exitCode = 1;
} finally {
    try { connection.close(); } catch {}
}
}
main().catch((err) => {
  console.error('MCP-LIVE: FAIL —', err?.message || err);
  process.exitCode = 1;
});
