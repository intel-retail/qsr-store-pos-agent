# Release Notes: QSR Store POS Agent

## Version 2026.3.0

**December 2026**

This release introduces the **Store Activity**, **Table Occupancy**, and **Footfall** simulator services, each with an MCP server for agents, along with security hardening and dependency upgrades.

**New**

- **Store Activity Service**: Headless simulator of a café day that produces customer, order, table, and queue events. Agents can read the live snapshot and history, mark tables as cleared, and inject events.
- **Table Occupancy Service**: Headless simulator that tracks table occupied, dirty, and cleared events, and reports utilization and dirty-duration statistics. Agents can mark tables as cleared or occupied.
- **Footfall Service**: Read-only headless simulator that produces footfall counts and zone density changes, with busy-time pattern queries for agents.
- **Durable Event Logs and Streaming**: Each service stores its events in its own database log, serves them over HTTP and server-sent events, and resumes from the last stored event after a restart without repeating or skipping events.
- **Simulated or Real Events**: Each service can run on simulated data or accept events from a real pipeline, preload days of history in one command, and run in live or replay mode with a configurable seed and speed.
- **MCP Servers**: Each service ships an MCP server, available over stdio and over HTTP in a Docker Compose sidecar, with optional API key authentication. Tools declare whether they are read-only or actions, and `describe_service` lists them for MCP clients.
- **Event Forwarding to the QSR Agent**: Events from the services can be forwarded to the QSR agent, with configurable event types, so the agent receives them regularly.
- **Container Images**: Each service has a named and tagged image, shared with its MCP sidecar, that can be built and pushed to a registry.

**Improved**

- **Security**: Required secrets for the database, MQTT broker, and agent API in Compose, authenticated MQTT, restricted CORS allowlists, constant-time API key comparison, and input validation.
- **Dependencies**: Upgraded to current versions of Angular, Node.js, PostgreSQL, Express, and fastmcp, and resolved reported dependency vulnerabilities.
- **Docker Builds**: Images now build behind a corporate proxy, including hosts that define only lowercase proxy variables, and container health checks no longer fail on IPv4-only services.
- **Documentation**: Added a store services guide with per-service documentation.
