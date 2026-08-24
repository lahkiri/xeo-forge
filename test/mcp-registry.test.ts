import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  MCP registry CRUD + the agent-facing path, against a real SQLite   */
/*  database and a REAL stdio MCP server.                              */
/*                                                                     */
/*  The registry is the trust boundary between "a user decided to run  */
/*  this server" (CRUD) and "the agent may call this server"           */
/*  (listMcpToolsForUser / callMcpTool). Both halves are exercised     */
/*  here for real — no mocked db, no mocked child process.             */
/*                                                                     */
/*  Tenancy is the security property under test: every function takes  */
/*  a userId, and a wrong userId must behave exactly like a missing    */
/*  row.                                                               */
/* ------------------------------------------------------------------ */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xeo-mcp-reg-'));
process.env.DB_PATH = path.join(tempDir, 'registry.sqlite');

let createMcpServer: typeof import('../lib/mcp/registry').createMcpServer;
let listMcpServers: typeof import('../lib/mcp/registry').listMcpServers;
let updateMcpServer: typeof import('../lib/mcp/registry').updateMcpServer;
let setMcpServerEnabled: typeof import('../lib/mcp/registry').setMcpServerEnabled;
let deleteMcpServer: typeof import('../lib/mcp/registry').deleteMcpServer;
let listMcpToolsForUser: typeof import('../lib/mcp/registry').listMcpToolsForUser;
let callMcpTool: typeof import('../lib/mcp/registry').callMcpTool;
let disconnectAllMcpServers: typeof import('../lib/mcp/registry').disconnectAllMcpServers;
let initSchema: typeof import('../lib/db/schema').initSchema;
let createUser: typeof import('../lib/db/queries').createUser;
let db: typeof import('../lib/db/index').db;

/** Real user ids, assigned in beforeAll after createUser returns. */
let USER_A = '';
let USER_B = '';

/** A real stdio MCP server: initialize, tools/list (one echo tool), tools/call. */
const ECHO_SERVER = `
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
function handle(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'echo-server', version: '9.9.9' },
    }});
    return;
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      tools: [{ name: 'echo', description: 'Echo the input.', inputSchema: {
        type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
      }}],
    }});
    return;
  }
  if (msg.method === 'tools/call') {
    const value = String((msg.params.arguments || {}).value || '');
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + value }] } });
    return;
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
}
`;

const serverScript = path.join(tempDir, 'echo-server.cjs');
fs.writeFileSync(serverScript, ECHO_SERVER, 'utf8');

beforeAll(async () => {
  const registry = await import('../lib/mcp/registry');
  const schema = await import('../lib/db/schema');
  const queries = await import('../lib/db/queries');
  const database = await import('../lib/db/index');
  createMcpServer = registry.createMcpServer;
  listMcpServers = registry.listMcpServers;
  updateMcpServer = registry.updateMcpServer;
  setMcpServerEnabled = registry.setMcpServerEnabled;
  deleteMcpServer = registry.deleteMcpServer;
  listMcpToolsForUser = registry.listMcpToolsForUser;
  callMcpTool = registry.callMcpTool;
  disconnectAllMcpServers = registry.disconnectAllMcpServers;
  initSchema = schema.initSchema;
  createUser = queries.createUser;
  db = database.db;

  await initSchema();
  const userA = await createUser({ email: 'mcp-a@example.test', passwordHash: 'h', displayName: 'A' });
  const userB = await createUser({ email: 'mcp-b@example.test', passwordHash: 'h', displayName: 'B' });
  USER_A = userA.id;
  USER_B = userB.id;
});

afterAll(async () => {
  await disconnectAllMcpServers();
  await db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('registry CRUD', () => {
  it('creates, lists, updates, disables, and deletes a server config', async () => {
    const created = await createMcpServer({
      userId: USER_A,
      name: 'Echo',
      command: process.execPath,
      args: [serverScript],
      env: { ECHO_TOKEN: 'abc' },
    });
    expect(created.enabled).toBe(true);
    expect(created.args).toEqual([serverScript]);
    expect(created.env).toEqual({ ECHO_TOKEN: 'abc' });

    const listed = await listMcpServers(USER_A);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Echo');

    const updated = await updateMcpServer(created.id, USER_A, { name: 'Echo Two', enabled: false });
    expect(updated?.name).toBe('Echo Two');
    expect(updated?.enabled).toBe(false);

    // listMcpServers(false) omits disabled servers — the agent path must not
    // see a disabled server's tools.
    expect(await listMcpServers(USER_A, false)).toHaveLength(0);

    expect(await setMcpServerEnabled(created.id, USER_A, true)).toBe(true);
    expect((await listMcpServers(USER_A, false)).length).toBe(1);

    expect(await deleteMcpServer(created.id, USER_A)).toBe(true);
    expect(await listMcpServers(USER_A)).toHaveLength(0);
  });

  it('enforces per-user server limits', async () => {
    // 16 is the documented ceiling; create 16 then the 17th must fail.
    for (let i = 0; i < 16; i++) {
      await createMcpServer({
        userId: USER_B,
        name: `S${i}`,
        command: process.execPath,
        args: [serverScript],
      });
    }
    await expect(
      createMcpServer({ userId: USER_B, name: 'S16', command: process.execPath, args: [serverScript] }),
    ).rejects.toThrow(/server limit reached/);
  });

  it('rejects invalid configs at the validation boundary', async () => {
    await expect(createMcpServer({ userId: USER_A, name: '', command: 'x' })).rejects.toThrow(/name is required/);
    await expect(
      createMcpServer({ userId: USER_A, name: 'x', command: 'bad\ncommand' }),
    ).rejects.toThrow(/control characters/);
    await expect(
      createMcpServer({ userId: USER_A, name: 'x', command: 'c', env: { 'BAD-KEY': 'v' } }),
    ).rejects.toThrow(/invalid env var name/);
    await expect(
      createMcpServer({ userId: USER_A, name: 'x', command: 'c', transport: 'http' } as never),
    ).rejects.toThrow(/unsupported transport/);
  });

  it('tenancy: another user cannot see, update, or delete my server', async () => {
    const mine = await createMcpServer({
      userId: USER_A,
      name: 'Private',
      command: process.execPath,
      args: [serverScript],
    });

    // Invisible in B's list.
    expect((await listMcpServers(USER_B)).find((s) => s.id === mine.id)).toBeUndefined();
    // B's update/delete behave exactly like a missing row.
    expect(await updateMcpServer(mine.id, USER_B, { name: 'Stolen' })).toBeUndefined();
    expect(await deleteMcpServer(mine.id, USER_B)).toBe(false);

    // A's own path still works.
    const still = await listMcpServers(USER_A);
    expect(still.find((s) => s.id === mine.id)?.name).toBe('Private');

    await deleteMcpServer(mine.id, USER_A);
  });
});

describe('agent-facing path over a real stdio server', () => {
  it('lists namespaced tools and calls one through the registry', async () => {
    const server = await createMcpServer({
      userId: USER_A,
      name: 'echo',
      command: process.execPath,
      args: [serverScript],
    });

    const listing = await listMcpToolsForUser(USER_A);
    expect(listing.errors).toHaveLength(0);
    expect(listing.tools).toHaveLength(1);
    expect(listing.tools[0].name).toBe('mcp__echo__echo');
    expect(listing.tools[0].serverLabel).toBe('echo-server'); // sanitized serverInfo.name

    const result = await callMcpTool(USER_A, 'mcp__echo__echo', { value: 'hello' });
    expect(result.isError).toBe(false);
    // Output arrives inside the untrusted-data envelope, never as bare text.
    expect(result.rendered).toContain('BEGIN-UNTRUSTED-MCP-DATA');
    expect(result.rendered).toContain('echo:hello');

    await deleteMcpServer(server.id, USER_A);
    await disconnectAllMcpServers();
  });

  it('a server whose command cannot start surfaces as an error, not a crash', async () => {
    const server = await createMcpServer({
      userId: USER_A,
      name: 'broken',
      command: '/nonexistent/binary/that/does/not/exist',
    });
    const listing = await listMcpToolsForUser(USER_A);
    expect(listing.tools.filter((t) => t.serverSlug === 'broken')).toHaveLength(0);
    expect(listing.errors.length).toBeGreaterThanOrEqual(1);
    expect(listing.errors[0].serverLabel).toBe('broken');
    await deleteMcpServer(server.id, USER_A);
  });

  it('callMcpTool refuses unknown and cross-user namespaced names', async () => {
    const server = await createMcpServer({
      userId: USER_A,
      name: 'echo',
      command: process.execPath,
      args: [serverScript],
    });
    // Wrong user: the slug set is built from B's rows, so it does not resolve.
    await expect(callMcpTool(USER_B, 'mcp__echo__echo', {})).rejects.toThrow(/no enabled server/i);
    // Unknown tool on a real server.
    await expect(callMcpTool(USER_A, 'mcp__echo__nope', {})).rejects.toThrow(/does not expose tool/);
    // Malformed name never reaches a process.
    await expect(callMcpTool(USER_A, 'not-a-namespaced-name', {})).rejects.toThrow(/malformed tool name/);
    await deleteMcpServer(server.id, USER_A);
    await disconnectAllMcpServers();
  });
});
