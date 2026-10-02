# Plan 288: Preview environments for feature PRs

## Status and authorization

- Status: APPROVED 2026-10-02, scheduled for later. Requested by the owner.
- Start when the owner says Fregat has left the greenfield phase. Until then the rule is to push
  fast: merge a rough version and fix it in the next PR. Small UI fixes always skip previews
  and deploy straight to the mesh.
- Depends on Mesh plan 06 (temporary apps with short URLs) and Mesh T28 (serve on demand).

## Outcome

An agent that finishes a large feature PR ends its run with a link the owner can open from a
phone or the MacBook. The link runs that PR's build, with its own server, against real state.
The owner tries the feature, then merges or replies in the thread. Opening a thread to find a
ready PR and a working link is the normal case.

## Shape

- **Scope.** Feature PRs that change behavior across the server and the web app. A PR that
  only touches styling or copy deploys normally.
- **Process.** The PR's worktree runs its own server and Vite on free ports, registered as a
  Mesh on-demand route. It starts on the first request and stops after the idle window, so an
  unopened preview costs disk only.
- **State.** Each preview gets a temp state home seeded from a small fixture workspace (a real
  git repo with a few sessions), so the preview never writes into the dev or production homes.
- **Address.** A Mesh temporary app gives the preview a short private URL. Mesh plan 06 expires
  it after 24 hours without traffic and deletes its managed files; the worktree stays.
- **Agent contract.** The agent posts the link in the thread and in the PR body, and keeps the
  preview alive until merge or close. Settling the thread removes the route.
- **Undo.** Reverting a merged change takes one command and redeploys. Measure it before
  starting this plan; if it takes more than a minute, fix that first.

## Open questions for the owner when this starts

- Which machine hosts previews, and how many may run at once (heavy-job budget).
- Whether a preview may reach live agent providers or only the mock provider adapter.

## Done when

A feature PR opened by an agent carries a working preview link, the owner merges from it without
running anything locally, and an idle preview stops and expires on its own.
