# Plan 173: Two devices opening one workspace

## Status and authorization

- Status: RESEARCH — found 2026-09-25, research not started. Nothing here authorizes
  implementation.
- Priority: P2. It becomes a product question once [Plan 143](143-phone-layout.md) makes the
  phone a real client.
- Planned at: Platform `9f343825`, 2026-09-25. Origin: CI work on 2026-09-25.

## Outcome

A phone and a desktop can open the same workspace, or different ones, on one server at the same
moment, and each gets a defined result.

## What exists today

- "Latest workspace open wins" is one number per server: `latestWorkspaceOpenGeneration` in
  `apps/server/src/fs/service.ts`. `claimWorkspaceOpen` rejects any generation at or below it, and
  `openWorkspaceRootObserved` answers `status: 'superseded'`.
- Each client makes its own generation: `claimWorkspaceOpenGeneration()` in
  `apps/web/src/features/workspace/state/open-generation.ts` is `max(Date.now(), last + 1)`, per
  tab. Two clients therefore race on wall-clock time, and a device whose clock runs behind loses.
- The server holds one workspace index scope (`installWorkspaceIndexScope`), so a second open of a
  different root replaces the first client's index.
- The web client carries `superseded` through `features/workspace/hooks/use-open-root.ts` into
  `features/address/state/apply-view.ts`, which logs it as the restore status.

## Research questions

1. Where else the rule reaches: routes, the index scope, watchers, and anything keyed on "the
   open workspace".
2. Should generations be per client (a connection or client id), so one client's newer open only
   supersedes its own older one?
3. Should the server hold one index scope per open root instead of one per server?
4. What the losing client sees today, and what it should see: nothing, a notice, or a normal open.

Deliverable: the rule's new shape and the executable plan, ahead of Plan 143's phone shell.
