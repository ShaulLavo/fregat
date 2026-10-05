# Document contribution ownership boundaries

`EditorTextBuffer` publishes canonical document revisions. `DocumentDelivery` admits readers and
projections, composes changes from each endpoint's acknowledged revision, and owns source release.
Backend sessions retain parser, token, clipped projection, or protocol results.

| Owner | State | Lifetime |
| --- | --- | --- |
| `DocumentDelivery` | Issued reads, endpoint acknowledgements, shared source transactions and exact pins | Document and retained source scopes |
| `AnalysisEntry` | Computation demand, configuration identity and accepted result | Compatible operation interests |
| Tree-sitter and Shiki adapters | Parser or tokenizer progress and domain results | Runtime session and physical worker |
| Minimap source adapter | Clipped render data and source receipt | Retained document source |
| LSP source adapter | Protocol attachment, URI, version and connection epoch | Retained protocol source |
| Syntax controller | Displayed tokens, folds, range demand and paint admission | View |

Computation cancellation interrupts a waiter through its work signal. A shared source transaction
uses the endpoint's lifetime signal. An abandoned computation releases a pin that arrives later.
Shiki finishes and records dispatched tokenization or recoloring before releasing its serial task.
Tree-sitter rejects the obsolete waiter and sets its existing shared cancellation flag when available.

Runtime configuration keys stay stable until result inputs change. Admission captures the key.
Completed work, cached waits and task acceptance recheck it. A pinned request keeps its captured
source revision while its configuration remains subject to these checks.

## Synchronous result projections

These consumers receive canonical view publications and use the canonical edit history to project
their own results. Their saved points identify the source of those results.

| Consumer | Saved state | Use |
| --- | --- | --- |
| Find | `elsewhereSyncPoint` | Projects offscreen match offsets before bringing them into the painted range |
| Merge conflicts | `parsedPoint` | Carries parsed conflict regions through supported edits |
| Semantic-token layer | `syncPointsByTextVersion` | Projects a delayed protocol result or drops it after a history gap |

Syntax-controller dispatch cursors and edit composition are removed. Its retained sessions request
the current canonical read. Displayed contributors remain protected; optional offscreen range
history can retire, and returning to a retired range performs a fresh query before restoring paint.

## Executable checks

`bun run documents:check` parses production source with `oxc-parser`. It checks package source and
dist imports, private worker-reader imports, raw runtime factories, legacy source bindings, edit
cursor accesses, and direct buffer subscriptions, including simple buffer aliases. Explicit backend
adapters and synchronous view observers are listed in the checker with their ownership reasons.
The checker runs in the normal gates, verification command and CI.

The AST check enforces these known boundaries. Independent code review establishes ownership for
new domain state and updates the explicit adapters when a backend requires one.

`bun run documents:inventory` regenerates the discovery inventory. Its source matches support the
ownership review; the AST check supplies the enforcement.
