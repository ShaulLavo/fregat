# TypeScript scripts migration

Status: Approved

Convert first-party executable JavaScript scripts to TypeScript while keeping their behavior and
entry points runnable. Include operational scripts, browser verification tools, fixtures and editor
benchmarks. Keep generated JavaScript, browser runtime assets and externally managed skill payloads
in the format their runtime requires.

## Execution

- [x] Inventory repository scripts and global skill helpers; establish runtime and ownership constraints.
- [x] Install frozen dependencies with the package store and cache on `/work`.
- [x] Convert root tooling, release checks and fixtures, with strict types and updated callers.
- [x] Convert web verification scripts; transpile TypeScript before injecting code into a browser.
- [x] Convert editor and terminal tooling and benchmarks, following their local instructions.
- [x] Audit shared skills: personal helpers already use TypeScript; preserve the two Codex-managed JS helpers.
- [x] Run strict typechecks, targeted script tests, repository gates and actual CLI entry points.
- [x] Audit stale references and review the decision trail.
- [x] Commit changed paths, push the branch and deploy the verified build to the mesh.

## Completion checks

Every eligible tracked JavaScript script has a TypeScript replacement; every active caller points to
it. TypeScript checks cover migrated scripts. Existing behavior checks pass, including the runtime
used by process fixtures and browser-injected code. No unrelated or managed data is removed.

The decision trail is `plans/typescript-scripts-decisions.tsv`.

## Observed limits

The main migrated `agent:browser look --doctor` passes and its screenshot was inspected.
Two historical standalone chat proofs have drifted: the scroll proof renders without page errors,
then waits for the old “Scroll to latest message” selector; the review proof imports a server-only
connection fixture into its browser bundle. These are separate from the migration’s strict checks
and the maintained browser runner; neither historical proof is claimed as passing.

## Verification

- All 155 removed JavaScript files have TypeScript successors. The remaining JavaScript is the
  browser service worker and the upstream xterm reference payload.
- Full workspace typechecking, lint, formatting, generated-file checks and repository gates pass.
- Repository script suite: 308 tests passed after integrating current main. Stress suite: 245 tests passed. Cache and ownership
  checks: 79 tests passed. Copied CLI fixture tests and seven real Node CLI probes pass.
- The six native input smoke scenarios and the 200-cycle reclamation browser probe pass; these
  checks make no performance claim.
- Independent review: `typescript-scripts-review.md`. Historical captures and old decision rows
  retain their original bytes.

The migration was committed as `c47bd174` and deployed with a passing live check. Current main
(`3293142d2`) was then merged to retain newer Mermaid and document-publication changes. The combined
tree passes full typechecking, repository gates and all 308 script tests; the only merge conflict was
the script entry list in `knip.json`, resolved by retaining both entries.
