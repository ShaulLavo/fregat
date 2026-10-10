# Plan 306: Load JSON structural syntax in Bun DOM tests

Status: APPROVED, 2026-10-03.

Owner: `ShaulLavo/fregat`, Tree-sitter worker/WASM loading and the Platform DOM-test environment. Source: [Fregat #386](https://github.com/ShaulLavo/fregat/issues/386). Inspected baseline: `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`.

Dependencies: None. The tree-sitter-x evaluation work in issues #339/#340 is separate.

## Outcome

A settings JSON editor in the Bun/happy-dom test environment reaches structural-syntax readiness and returns real JSON captures. Worker initialization errors fail the relevant verification instead of disappearing behind a passing UI assertion. The browser production path continues to load grammar assets and report real load failures.

## Evidence and current boundaries

The source issue records CI run [37053628799](https://github.com/ShaulLavo/fregat/actions/runs/37053628799), Bun `1.4.2+744846f84`, Vitest `5.0.2`, Ubuntu 24.04, and the passing `page-held-selection.test.tsx` test. Its structured event reported `languageId=json`, structural and syntax error states, and a browser-externalized `readFile` that was undefined.

The issue's source/artifact inspection attributes the expression to `web-tree-sitter`'s `Language.load` Node branch. A Bun native Worker can expose `process.versions.node` while executing a browser-built bundle whose filesystem import Vite removed. This remains a suspected environment mismatch. One CI occurrence is confirmed; recurrence and production-browser impact are unconfirmed. The later missing **Open studio** dialog assertion is a separate test with no demonstrated causal link.

Current source still has the relevant boundaries:

- [apps/web/vitest.config.ts](../apps/web/vitest.config.ts) selects [happy-dom-ssr.ts](../apps/web/test/env/happy-dom-ssr.ts), whose `viteEnvironment` is `ssr` and whose canvas setup acknowledges native Worker transfer constraints.
- [workerClient.ts](../editor/packages/tree-sitter/src/treeSitter/workerClient.ts) constructs a module Worker from `new URL('./treeSitter.worker.ts', import.meta.url)` and propagates worker responses/errors through its lifecycle owner.
- [treeSitter.worker.ts](../editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts) initializes the parser and calls `Language.load(descriptor.wasmUrl)` in `createRuntime`.
- [tree-sitter/package.json](../editor/packages/tree-sitter/package.json) pins `web-tree-sitter` to tree-sitter-x `059451d3c167443643630d471c2c2d61c13b10ff`. Recheck the pinned implementation and resolved artifact during execution.

No tests or builds ran for this plan. The Markdown dependency's filesystem warning alone does not establish the cause of a JSON failure.

## Scope and design decision

Keep the real worker, parser, JSON grammar, request protocol, cancellation, disposal, and structural-syntax readiness contract. The test must observe successful structural work, not just the absence of a console string. Avoid mocking our modules, suppressing the error, disabling syntax, or globally deleting `process` to influence dependency detection.

Begin with a small loader probe that records the worker artifact target, asset URL schemes, runtime environment, and the failing load stage. Do not log document text or private paths. Include the parser runtime WASM and a JSON grammar because both must initialize before readiness is meaningful.

Prefer an explicit grammar-byte loading boundary if the probe confirms the supported browser/Bun asset URLs can resolve there. Passing bytes to `Language.load` avoids its environment-dependent path decision, but does not by itself solve asset fetching or parser-runtime initialization. If the defect is the wrong worker artifact selected by Vitest, fix that artifact/environment ownership instead. Choose one minimal correction from the reproduced evidence and record it in this plan.

Browser code must retain browser asset loading. A native filesystem adapter belongs only to the native runtime or test artifact that owns it. Use the dependency's supported APIs and the existing environment/build configuration before adding another loader abstraction.

## Execution checklist

- [ ] Reproduce with the narrow passing-test entry from `apps/web/`: `bun --bun vitest run --project dom src/features/settings/tests/page-held-selection.test.tsx`. Capture the structured syntax event and verify a known-good real-browser JSON request is observable through the same readiness/capture signal.
- [ ] Add the smallest portable integration regression using the real worker and JSON grammar in the affected Bun DOM environment. Assert nonempty JSON structural captures/readiness after initialization and an edit. It must fail for the observed loader mismatch even when the settings UI renders successfully.
- [ ] Inspect the actual dependency code, transformed worker artifact, filesystem external stub, and URL schemes in that failing run. Probe explicit byte loading and the correctly targeted native/test worker artifact. Select the narrow correction based on these results.
- [ ] Implement the correction at the WASM-load or environment boundary identified by the probe. Preserve configured browser asset URLs and the existing worker lifecycle. Avoid global runtime-detection changes.
- [ ] Verify a deliberately invalid/missing grammar produces the expected structured failure and settles its request. Verify disposal and a repeated JSON initialization release their resources and cannot publish into a disposed session.
- [ ] Rerun the new regression and the narrow original settings test under Bun. Confirm structural readiness is positive and the observed externalized-filesystem error is gone. Keep the dialog flake investigation separate.
- [ ] Run the existing real-browser worker client regression with JSON coverage, and inspect JSON settings-editor syntax in the actual app. If the loader path is shared by Markdown, add only the narrow Markdown load control needed to protect that contract.
- [ ] Build affected workspaces before consumer checks. Run package typecheck and narrow tests through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill where required. Commit the owned paths, push, deploy the web consumer, and record the artifact/runtime and inspected browser evidence.

## Verification and acceptance

Use the new Bun DOM regression, the original `page-held-selection.test.tsx`, and [treeSitter-workerClient.browser.test.ts](../editor/packages/tree-sitter/test/treeSitter-workerClient.browser.test.ts). Read package scripts before selecting browser commands. Committed fixtures resolve assets from the checkout or test temporary directories and run in CI without owner-specific paths.

Completion requires real JSON structural success in the affected environment and the production browser control. A missing error log, a passing surrounding settings assertion, or a Markdown build-warning change alone is insufficient. Record any nonreproducing environment precisely; do not declare a production regression without observing one.
