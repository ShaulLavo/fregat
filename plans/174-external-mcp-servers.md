# Plan 174: Managed external MCP servers

Status: **placeholder, unscheduled.** Split out of [Plan 087](087-stateless-mcp.md) on 2026-09-26.
Decided 2026-09-26: recommendation (owner deferred) — 087 keeps our own tool endpoint; managing the
user's external MCP servers moves here. Nothing here authorizes implementation.

## Scope

Plan 087's former milestones M2 and M3, as written there:

- **M2.** A managed external MCP client: HTTP and stdio definitions as machine/application
  settings, import preview, process lifecycle, OAuth, catalog discovery and refresh.
- **M3.** External tools, resources and prompts in chat through a scoped gateway for both providers.

## Before planning

Both providers already manage the user's own MCP servers natively. The research question is what
Platform adds on top of that (status, import, one place to configure both) and whether any of it
needs a second MCP manager.
