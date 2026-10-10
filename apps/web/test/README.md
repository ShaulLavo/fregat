# Web test fixtures

Import `test` and `expect` from `test/fixtures.ts`. The `server` fixture runs the real
application against a temporary workspace. `client` and `directInProcessFetcher`
call its real routes without opening a server socket. Provider activity uses the
fixture's `MockProviderAdapter`.

## Compiler-sensitive regressions

Name a regression `*.compiler.test.tsx` to run it in the **compiler** project through
the ordinary `bun run test` and CI commands. It uses the same Happy DOM setup,
in-process server, and Bun resolution as **dom**, and compiles browser application
source with the web build's installed `oxc-transform-react`. The compilation control
checks memo reuse, revision invalidation, and owner replacement through rendered hooks.

To reproduce an existing DOM test under the compiler before moving its coverage,
run a narrow file through the standalone configuration from `apps/web`:

```sh
bun --bun vitest run --config vitest.compiler.config.ts src/features/workspace/tests/use-fs-actions.test.tsx -t 'saved rows cannot start mutations until the tree is confirmed'
```

This configuration can select ordinary DOM files. Keep the file filter narrow.
Use shared fixtures and render helpers in compiler regressions. The DOM project
excludes compiler test files so each regression runs only with compilation enabled.

## Binary response assertions

Use the **node** project (`*.test.ts`) to verify binary response bytes, including
attachment downloads and PDF sources. The native response constructor supports
`Bun.file` bodies.

The **dom** project (`*.test.tsx`) uses Happy DOM. Its response constructor checks
for Happy DOM's own Blob class. A native Bun File falls through to string conversion,
so a real route can answer status 200 with `[object File]` in its body while retaining
the original file's content length and MIME type.

The in-process fetcher rejects this known corruption with
`test-fixture.BINARY_BODY_UNSUPPORTED` and guidance to use the node project. It
checks only Happy DOM responses with a declared content length different from the
13-byte serialization marker. Inspection uses a clone and reads at most two chunks,
with the second read occurring only after the first is exactly a serialization
marker. The response returned to a successful caller stays unread; SSE responses
without a content length bypass inspection.

This guard detects the known serialization failure; it does not provide binary
support in Happy DOM. A 13-byte file cannot be distinguished by this length check.
Literal `[object File]` text with a matching declared length remains readable.
Keep exact-byte transport coverage in the node project and DOM coverage focused on
rendering and interaction.
