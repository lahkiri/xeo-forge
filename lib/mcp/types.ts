/**
 * MCP types — canonical shapes for the Model Context Protocol client.
 *
 * One definition per concept (lib/types.ts convention). Row shapes mirror the
 * `mcp_servers` table exactly, including the 0/1 integer booleans and the
 * JSON-encoded TEXT columns the rest of the schema uses.
 */

/* ----- JSON-RPC 2.0 wire shapes ----- */

/** Ids we generate are always numbers; a server may echo anything. */
export type JsonRpcId = number | string | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc?: string;
  id?: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
  /** Present on server-initiated notifications, which we ignore. */
  method?: string;
}

/* ----- MCP protocol shapes (only the parts we consume) ----- */

/** Sanitized server identity. Never rendered raw — it is server-controlled. */
export interface McpServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
}

/** A tool as the server described it, after sanitization. */
export interface McpToolDescriptor {
  /** Raw tool name as the server reported it (needed for `tools/call`). */
  rawName: string;
  /** Sanitized `[a-z0-9_-]` segment used to build the namespaced name. */
  slug: string;
  /** Sanitized, length-capped, injection-neutralized description. */
  description: string;
  /** JSON Schema for the arguments, or a permissive object schema. */
  inputSchema: Record<string, unknown>;
}

/** A tool exposed to the agent under its `mcp__<server>__<tool>` name. */
export interface McpNamespacedTool extends McpToolDescriptor {
  /** `mcp__<serverSlug>__<toolSlug>` — what the model calls. */
  name: string;
  serverId: string;
  serverSlug: string;
  /** Sanitized display name of the owning server. */
  serverLabel: string;
}

/** One entry of a `tools/call` result `content` array. */
export interface McpContentBlock {
  type?: string;
  text?: string;
  mimeType?: string;
  data?: string;
  [key: string]: unknown;
}

export interface McpToolCallResult {
  /** Rendered, sanitized text wrapped in the untrusted-data envelope. */
  rendered: string;
  /** True when the server flagged the call as an error. */
  isError: boolean;
  /** How many injection markers the sanitizer neutralized. */
  neutralized: number;
  /** True when output hit the length cap. */
  truncated: boolean;
}

/* ----- Registry / DB shapes ----- */

export type McpTransport = 'stdio';

/** Raw `mcp_servers` row. `args`/`env` are JSON TEXT; `enabled` is 0/1. */
export interface McpServerRow {
  id: string;
  user_id: string;
  name: string;
  transport: string;
  command: string;
  args: string;
  env: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** Decoded, validated server config. `slug` is derived, not stored. */
export interface McpServerConfig {
  id: string;
  userId: string;
  name: string;
  /** Collision-resolved `[a-z0-9_-]` namespace segment for this server. */
  slug: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A server that failed to connect or list tools, surfaced instead of hidden. */
export interface McpServerError {
  serverId: string;
  serverLabel: string;
  message: string;
}
