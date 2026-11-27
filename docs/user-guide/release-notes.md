# Release Notes: QSR Store POS Agent

## Version 2026.3.0

**November 2026**

This release introduces the **EdgeMart point-of-sale simulator** with Grocery and Café experiences, **Agent Chat powered by Hermes and MCP servers**, and **three store event services with MCP sidecars**, along with security hardening, dependency upgrades, and documentation.

**New**

- **EdgeMart POS Application**: Angular point-of-sale frontend and Node.js/Express backend with two experiences, Grocery and Café, each backed by its own PostgreSQL database, products, and visual layout. Includes product and transaction management, dark and standard themes, and a configuration page for managing MCP servers.
- **3D Floor Simulator**: WebGL floor simulator for each experience with configurable customer count and simulation speed, interactive fixture editing, and simulated vision events for table occupancy.
- **Agent Chat**: Chat tab with streaming responses that connects to the Hermes Gateway through an OpenAI-compatible API. Shows connection status, available tools, and a live table grid.
- **POS and Table-Status MCP Servers**: MCP servers that expose product, sales, and customer data as well as real-time table state received over MQTT, so an agent can answer questions and mark tables as cleared or occupied.
- **Store Event Services**: Store activity, table occupancy, and footfall services, each with its own durable event log, HTTP and server-sent-events interface, and MCP sidecar. Services run on simulated data or accept events from a real pipeline, can preload history, and resume without repeating or skipping events after a restart.
- **Event Forwarding to the QSR Agent**: Store events can be forwarded to the QSR agent, with configurable event types and simulation speed, so the agent receives events regularly.
- **MCP Tool Annotations**: Every store service tool declares whether it is read-only or an action, and `describe_service` lists read and action tools so MCP clients can classify them.
- **Docker Compose Deployment**: Single-command deployment of the frontend, backend, PostgreSQL, authenticated MQTT broker, store services, and MCP sidecars, with health checks, resource limits, and unprivileged containers. Event service images are named and tagged so they can be built and pushed to a registry.
- **System Metrics Panel**: CPU, memory, NPU, and Intel GPU metrics streamed to the UI, with GPU data collected by the qmmd daemon in a dedicated unprivileged container.
- **Agent Skills**: Skills for deploying the EdgeMart stack, working with the store services, and connecting an agent through MCP, each with example prompts and evaluations.

**Improved**

- **Security**: Required secrets for the database, MQTT broker, and Hermes API in Compose, authenticated MQTT, PostgreSQL bound to loopback, optional API key authentication with constant-time comparison for service endpoints, restricted CORS allowlists, request body and chat history limits, and input validation.
- **Dependencies**: Upgraded to Angular 22, Node.js 26, PostgreSQL 18, Express 5, and current versions of fastmcp, helmet, dotenv, express-rate-limit, and three.js, and resolved reported dependency vulnerabilities.
- **Docker Builds**: Backend, frontend, and qmmd images now build behind a corporate proxy, including hosts that define only lowercase proxy variables, and container health checks no longer fail on IPv4-only services.
- **Documentation**: Added the README, store services guide, per-service documentation, security policy, and contributing guide.
