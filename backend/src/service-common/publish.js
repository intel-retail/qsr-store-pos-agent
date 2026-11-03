/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Append-then-publish path shared by HTTP ingest, HTTP action routes and MCP action tools.

/** Appends to the durable log, then fans out via the hub; returns the saved row or null for a duplicate event_id. */
async function appendAndPublish(log, hub, envelope) {
  const saved = await log.append(envelope);
  if (saved) hub.publish(envelope);
  return saved;
}

/** Envelope `source` for events created by an action or injection (a real pipeline's actions are 'real'). */
function actionSource(source) {
  return source === 'real' ? 'real' : 'sim';
}

module.exports = { appendAndPublish, actionSource };
