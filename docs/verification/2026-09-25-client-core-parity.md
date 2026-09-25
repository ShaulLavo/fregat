# Client-core web and TUI parity

Completed on lane L6, 2026-09-25. Plan 094 is deleted. Focus-transition work U8 was dropped by the completion-wave scope.

Contracts own Git status predicates, binary-diff detection, language metadata and shared wire vocabulary. Client-core owns the log API and live cache, attachment budget, mention grammar, replacement expansion, socket port, settings operations, terminal-context validation, registration commands, recent-command ledger, activity visibility, keybinding policy and worktree action/confirmation policy. Browser APIs, React hooks, formatting classes and Bun transport/storage adapters remain in their applications.

The log cache keeps 500 events sorted by timestamp and deduplicates event ids independently of retained detail. MIME normalization accepts JPG and parameters; both hosts enforce the encoded data-URL budget. Replacement expansion supports native captures plus newline, tab, backslash and standalone `$0`. Terminal context trims text and clamps finite line numbers. Provider enablement strips secrets before writing configuration.

Recent commands preserve each host's product policy. Web keeps 30 entries in a versioned envelope and applies recency during typed search. TUI keeps 50 entries in an array and applies recency only to empty search. Storage ports preserve atomic TUI updates, conditional invalid-record deletion and cross-process writers. The coordinator accepted preserving those policies.

TUI adopts the web activity filter, including checkpoint and provider diagnostic suppression, while failures remain visible. Worktree eligibility and command selection are shared; TUI retains its current-checkout restriction. Browser and TUI rendering remain local. Eleven TUI factories use an observable store in `host/state`, with replace, patch, unsubscribe, explicit disposal and parent-abort support. Tree and draft revision counters stay local because their snapshots represent mutable controllers.

## Verification

- Late log arrival, JPG extension, encoded attachment size, quoted mentions, replacement escapes and terminal-context normalization each failed before the change and passed afterward.
- Web logs 28 tests; TUI JSONL streaming; attachment, replacement and socket tests; settings/provider/registration tests; recents writer races and ranking tests passed.
- Final policy pass: 101 web tests, 16 TUI worktree/timeline/keymap tests. Observable-store pass: 34 lifecycle tests plus 17 file-browser, rail and disposal tests passed.
- Server, web and TUI typechecks and `bun run gates` passed. Every new client-core module has an explicit package export; no runtime-specific import was moved into client-core.

Browser evidence, screenshots read:

| Scenario                   | Evidence directory                                                               | Result                                                           |
| -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| logs-panel                 | `/work/tmp/fregat-evidence/20260925T145247Z-scenario-logs-panel`                 | Passed, no warning/error app logs                                |
| settings-defaults          | `/work/tmp/fregat-evidence/20260925T150329Z-scenario-settings-defaults`          | Passed, no warning/error app logs                                |
| settings-stale-diagnostics | `/work/tmp/fregat-evidence/20260925T151313Z-scenario-settings-stale-diagnostics` | Passed, no warning/error app logs                                |
| chat-draft-context-strip   | `/work/tmp/fregat-evidence/20260925T152014Z-scenario-chat-draft-context-strip`   | Passed; managed fixture release dialog and cancellation verified |

The draft-strip run logged four cancelled filesystem/Git requests during navigation and browser GPU diagnostics. The first release check used an external checkout, correctly exposed no release action, and was replaced with a managed dirty fixture. Fixture cleanup releases ownership before deleting its project. No real workspace or database was deleted.

The attachment browser run exposed an authenticated image-loading failure. Main's separate fix `a8de3a1d` adds anonymous CORS loading and a valid PNG/decode fixture; this lane picks that fix up at rebase and rechecks the scenario.
