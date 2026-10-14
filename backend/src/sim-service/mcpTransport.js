/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared stdio/streamable-HTTP connector for all 3 MCP servers (sim-service,
// table-sim-service, footfall-sim-service) — same reuse pattern as
// hub.js/envelope.js/rng.js. Built on fastmcp (which itself wraps the
// official @modelcontextprotocol/sdk), not the low-level SDK directly — it
// supplies, out of the box, the per-request session handling that a
// stateless HTTP MCP endpoint needs (no hand-rolled "new Server+transport per
// POST"), zod-validated tool parameters, a health-check route, and the
// `authenticate` hook used below for the optional API key + rate limit.
//
// Defaults to stdio (spawned child process, as before); MCP_TRANSPORT=http
// instead exposes the server as a long-lived network endpoint (POST /mcp),
// for agent frameworks that register MCP services by URL rather than by
// spawning a stdio child (e.g. intel-retail/qsr-agent's
// agent-config/hermes/remote-mcp.yaml).
//
// http mode keeps the same contract as before (optional X-Api-Key, CORS,
// rate limit) — this turns a previously local-only stdio process into a real
// network endpoint that can call the act tools
// (mark_table_cleared/inject_event/mark_table_occupied), so it needs the
// same hardening, not none. Note: unlike the previous Express-based
// implementation, fastmcp's `/mcp` endpoint isn't served through its Hono
// app, so Express middleware like `helmet` can no longer apply to it — the
// `authenticate` hook below is the only hook point for this endpoint.

const { FastMCP } = require('fastmcp');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;

/**
 * Builds the `authenticate` hook used in http mode. This is the only
 * request-level hook fastmcp exposes for its `/mcp` endpoint, so it carries
 * both jobs the old Express middleware chain did: a per-IP rate limit
 * (always on) and the optional API-key check (X-Api-Key or a bearer token,
 * only when MCP_API_KEY is set). Returning a nullish value signals "unauthenticated"
 * and fastmcp turns that into a 401; throwing a `Response` is passed through
 * verbatim (fastmcp/mcp-proxy's documented convention), which is how the
 * rate limiter below produces its own 429 instead of a 401.
 */
function buildAuthenticate(apiKey) {
  const hits = new Map(); // ip -> { count, windowStart }

  return async (request) => {
    const ip = (request.socket && request.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      hits.set(ip, { count: 1, windowStart: now });
    } else {
      entry.count += 1;
      if (entry.count > RATE_LIMIT_MAX) {
        throw new Response(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests' }, id: null }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }
        );
      }
    }

    if (!apiKey) return {}; // auth disabled — rate limit above still applies
    // Accepts X-Api-Key or an "Authorization" header using the bearer-token
    // convention (e.g. intel-retail/qsr-agent's remote-mcp.yaml), same as
    // this contract's Express-based requireApiKey.js.
    const authHeader = request.headers['authorization'] || '';
    const bearerPrefix = 'Bearer ';
    const provided = request.headers['x-api-key'] || (authHeader.startsWith(bearerPrefix) ? authHeader.slice(bearerPrefix.length) : null);
    if (provided !== apiKey) return undefined; // -> fastmcp sends 401
    return {};
  };
}

/**
 * Wraps a per-tool-name dispatcher (`handleTool(name, args)`) into the
 * `execute()` shape fastmcp expects, preserving this contract's existing
 * behavior exactly: every result (success or "soft" `{ error }` object) comes
 * back as pretty-printed JSON text, with `isError` set whenever the result
 * looks like an error object. An unexpected throw is reported the same way —
 * fastmcp's own built-in handling of a thrown error produces a different,
 * plain-text message, so this keeps the JSON `{ error }` shape callers
 * already parse.
 */
function wrapTool(handleTool, name) {
  return async (args = {}) => {
    try {
      const result = await handleTool(name, args);
      const isError = !!(result && typeof result === 'object' && !Array.isArray(result) && 'error' in result);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
    }
  };
}

/**
 * Builds and starts a fastmcp server using MCP_TRANSPORT ('stdio', default,
 * or 'http'). `tools` is this contract's existing TOOLS array, with each
 * entry's `inputSchema` (JSON Schema) replaced by `parameters` (a zod
 * schema). `handleTool(name, args)` is the existing per-service dispatcher —
 * unchanged business logic, just called from a different front door.
 * `httpPort` is the default port when MCP_HTTP_PORT isn't set; only used in
 * http mode. Auth (MCP_API_KEY) and CORS (MCP_CORS_ORIGIN) are unset/open by
 * default, same "open unless configured" convention as the rest of this
 * contract.
 */
async function connectTransport({ name, label, httpPort, tools, handleTool }) {
  const mode = process.env.MCP_TRANSPORT || 'stdio';
  const apiKey = process.env.MCP_API_KEY || null;

  const server = new FastMCP({
    name,
    version: '1.0.0',
    // Plain-text 'ok' would also satisfy the docker-compose `wget --spider`
    // healthcheck, but a JSON body keeps `curl .../health` output unchanged.
    health: { enabled: true, path: '/health', message: JSON.stringify({ status: 'ok' }) },
    ...(mode === 'http' ? { authenticate: buildAuthenticate(apiKey) } : {}),
  });

  for (const tool of tools) {
    server.addTool({ name: tool.name, description: tool.description, parameters: tool.parameters, execute: wrapTool(handleTool, tool.name) });
  }

  if (mode !== 'http') {
    await server.start({ transportType: 'stdio' });
    console.error(`[${label}] MCP server running on stdio`);
    return;
  }

  const port = parseInt(process.env.MCP_HTTP_PORT || httpPort, 10);
  const corsOriginRaw = process.env.MCP_CORS_ORIGIN || 'http://localhost:4200';
  // '*' is special-cased to `true` (reflect request origin) — same wildcard
  // convention this contract used with the `cors` package.
  const corsOrigin = corsOriginRaw === '*' ? true : corsOriginRaw.split(',').map((s) => s.trim());

  await server.start({
    transportType: 'httpStream',
    httpStream: {
      port,
      // fastmcp's own default, when `host` is left unset, is the *string*
      // "localhost" (confirmed in its source: `host = overrides?.httpStream
      // ?.host || hostArg || envHost || "localhost"`), which Node resolves
      // via DNS to one address — IPv4-only in this environment. Binding the
      // *literal* '::' instead (no DNS lookup, true dual-stack on Linux)
      // fixes TCP connectivity on both families, but fastmcp has its own bug
      // on that path: its health/ready/custom-route fallback builds
      // `new URL(req.url, `http://${host}`)` with this same unbracketed
      // host string, and an IPv6 literal without [] brackets is an invalid
      // URL authority (confirmed: `new URL('/x','http://::')` throws
      // "Invalid URL" in plain Node) — every request down that path 500s.
      // There's no single value that is simultaneously a valid `.listen()`
      // host and a valid unbracketed URL authority for IPv6, so this stays
      // on the IPv4 literal '0.0.0.0' (valid for both) — the container's own
      // healthcheck is pointed at 127.0.0.1 explicitly in docker-compose.yml
      // instead of relying on "localhost" resolving to an IPv4 address.
      host: '0.0.0.0',
      // No multi-call session state in this contract's describe/read/act
      // tools — stateless mode also sidesteps the low-level SDK's "a
      // stateless transport cannot be reused across requests" restriction by
      // giving every request its own session internally.
      stateless: true,
      cors: { origin: corsOrigin, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'X-Api-Key', 'Authorization', 'Mcp-Session-Id'] },
    },
  });
  console.error(`[${label}] MCP server running on streamable-http :${port}/mcp`);
}

module.exports = { connectTransport };
