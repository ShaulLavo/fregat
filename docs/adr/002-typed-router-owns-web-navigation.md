# 002. Let TanStack Router own navigation in the web app

Status: accepted
Date: 2026-09-11

## Context

The web app needed typed navigation, several kinds of copy-link, and a path to opening a workspace from a link. The first design kept the browser's native history and mirrored the app's selection into the address bar with a custom controller. That design was the smallest patch, but it meant owning route matching, history policy and the relationship between callers and destinations indefinitely.

## Decision

TanStack Router owns browser navigation. A registered route tree and validated search parameters describe every destination. The app's runtimes apply the destination the router accepts. The router is created in `apps/web/src/state/router.ts`, and [workspace navigation](../workspace-navigation.md) describes the current ownership rules.

## Alternatives considered

- **Keep a native controller with typed actions.** It is the smallest change and still typed. It lost because the team would keep maintaining route matching, notifications and history policy.
- **Put `@tanstack/history` under the existing controller.** It replaces a few native calls and nothing else, because route and search types stay uninferred. It lost because it delivers almost none of the benefit and leaves two owners.
- **Install the router under the existing controller and keep passing preformatted `href` strings.** It lost because the router and the controller would both own navigation and callers would bypass the types.

## Consequences

- A renamed route or a changed search schema fails the build at every caller.
- Restore policy stays app-specific: the router decides the destination, and the app decides which retained editor or chat to show for it.
- The router version is a dependency to track. A history-only halfway state is the failure to avoid when upgrading.
