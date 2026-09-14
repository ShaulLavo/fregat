# Git

Status, stage and unstage, commit, push, pull, fetch, sync, pull request creation, and file diff views.

## Sub-features

Status list with tree dots, stage/unstage single and many, discard, commit with generated message, remote actions, compare with saved.

## How to get to it (user POV)

The Git side panel. Diff opens as an editor tab.

## Driving it with agent:browser

No scenario yet. Every git action is a `useMutation` with a key under `['git', 'mutation', ...]`; `caches` lists them with status while they run. A proof reads `git status --porcelain` in the workspace after the action.

## Gotchas

Commit runs hooks; a hook rejection is an expected outcome, not a transport fault. Stage and unstage are not optimistic on purpose.
