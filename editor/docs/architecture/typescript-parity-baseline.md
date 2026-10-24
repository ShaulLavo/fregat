# TypeScript core parity baseline

The shared contract runs 25 useful-answer cases against one project and one unsaved edit.
It preserves the original worker method assertions and checks required diagnostics, semantic
color, completion detail and extraction independently of optional wire methods. Editor actions,
additional feature families, project/lifetime coverage and Rust qualification are not covered.

## Results

The in-process and real module TypeScript 6.0.3 workers support all 25 core cases in
Chromium, Firefox and WebKit. Real process tests pin
these observed gaps so supported behavior cannot disappear without failing a test:

| Engine            | Compiler / adapter                          | Supported | Failed | Unavailable |
| ----------------- | ------------------------------------------- | --------: | -----: | ----------: |
| Classic tsserver  | TS 6.0.3 / typescript-language-server 6.0.1 |        21 |      2 |           2 |
| Native TypeScript | TS 7.0.2                                    |        22 |      2 |           1 |

Classic refactor resolution and extraction return command actions without edits. On-type
formatting and pull diagnostics are unavailable. Push diagnostics still satisfy the required
post-edit outcome. Native quick fixes and extraction return empty arrays; resolve is
unavailable. Controls retained the complete original diagnostic and negotiated literal
code-action kinds. The action executor and upstream semantic support need separate work.

The real module-worker tests verify termination, client disconnection and worker disappearance
in all three browsers. The test server permits the installed TypeScript library directory,
including dependencies outside an exclusive worktree. The configured external WebSocket
reference adapter is pending and stays explicitly `unrun` in the initial matrix.

## Run and capture

From the repository root, create a fresh evidence directory outside the checkout. Run these
commands separately so a failed command keeps its exit status. Each suite writes tagged JSON
run records alongside normal test output:

```sh
bun run --cwd editor/packages/typescript-lsp test test/parity.test.ts test/parity-contract.test.ts > "$evidence/worker.log" 2>&1
bun run --cwd apps/server test src/lsp/tests/typescript-feature-parity.test.ts > "$evidence/server.log" 2>&1
bun run --cwd editor/packages/typescript-lsp test:browser > "$evidence/browser.log" 2>&1
bun scripts/typescript-parity-capture.mjs "$evidence/matrix.json" "$evidence/worker.log" "$evidence/server.log" "$evidence/browser.log"
bun scripts/typescript-parity.mjs baseline "$evidence/matrix.json"
bun scripts/typescript-parity.mjs qualify "$evidence/matrix.json"
```

`baseline` requires all seven backend roles and every canonical cell. It permits recorded
failures, unavailable variants and unrun roles. `qualify` requires clean source, passed tests,
verified cleanup, supported mandatory outcomes and every advertised variant. It rejects any
advertised method without a contract case. Core qualification covers these 25 cases only;
the complete editor qualification has additional gates beyond these 25 cases.

Capture rejects duplicate runs for a backend. Keep each retry in a separate evidence directory
and name the selected run explicitly. Missing roles receive unrun records; capture never
substitutes a successful attempt. Each artifact records the source revision, dirty state and
SHA-256 digest before and after execution. Changed source prevents capture. The validator
compares the recorded source with the current checkout and binds artifact hashes, backend
metadata, capability observations, results and test/cleanup receipts to the matrix.

All fixtures own teardown before setup. Real process fixtures await child close events before
removing projects; browser fixtures observe actual worker disappearance. Failed tests and
failed teardown remain visible in their artifact receipts and cannot qualify an engine.
