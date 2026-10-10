# Plan 303: Keep spellcheck input bounded and worker failures settled

Status: APPROVED, 2026-10-03. Remaining work is a bounded validation pass over shipped hardening, with fixes only for demonstrated gaps.

Owner: `ShaulLavo/fregat`, `editor/packages/spellcheck/` and its Platform consumers. Reported in the read-only Singapore mirror as [Singapore #58](https://github.com/ShaulLavo/singapore/issues/58). Inspected baseline: Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`.

Dependencies: [E058 spellcheck](e058-spellcheck.md). Rendering work continues in [Plan 304](304-spellcheck-rendering-cost.md), and language support in [Plan 305](305-spellcheck-language-support.md).

## Outcome

Pasting or typing a long visible line keeps editing usable. A failed dictionary worker settles its requests, preserves accepted words, and releases pending state. Normal prose, exclusions, delayed replies, and undoable replacement keep their existing behavior.

## Current code and shipped evidence

The issue reviewed Singapore `b27dbb90`. Its isolated Node probe measured roughly quadratic growth for 5k, 10k, and 20k letter runs. Those historical values describe that revision, not the current implementation.

[E062 delivery evidence](../editor/docs/editing/e062-spellcheck-hardening.md) records shipped Editor `dab873292fb9b0cd38c7c9fc4cd4c84951734e2b`, Platform `c1391065a`, and release `20260926T211241Z-c1391065-spellcheck-hardening`. Source inspection confirms the core fixes remain present:

- [tokenizer.ts](../editor/packages/spellcheck/src/tokenizer.ts) skips whitespace chunks above 256 UTF-16 units before structured scans. Bounded chunks preserve surrounding offsets and exclusion ranges.
- [controller.ts](../editor/packages/spellcheck/src/controller.ts) skips prose lines and code regions above 16,384 units before reading or caching them. It retains viewport locality, cached tokenization and word verdicts, current-text offset ownership, and caret-word hold-back.
- [service.ts](../editor/packages/spellcheck/src/service.ts) creates the worker and posts requests inside the request promise. Setup, initial accepted-word synchronization, later posting, crash, and decoding failures stop the worker and settle all pending requests. Accepted words survive service-level restart. Disposal prevents restart.
- An editor controller stops requesting checks after its first failure, so subsequent keystrokes do not repeatedly create workers. A later explicit service request can create a fresh worker. Preserve that distinction.
- Existing [tokenizer tests](../editor/packages/spellcheck/test/tokenizer.test.ts), [service tests](../editor/packages/spellcheck/test/service.test.ts), and [typing browser tests](../editor/packages/spellcheck/test/typing.browser.test.ts) cover oversized punctuation inputs, surrounding offsets, asynchronous failures, pending cleanup, accepted-word synchronization, restart, disposal, long-line paste, and continued editing.

No fresh runtime reproduction ran during this planning pass. The first execution step verifies the current artifact and the existing regression coverage. It must not recreate the shipped fixes.

## Scope and ownership

Retain `cspell-trie-lib`, the lazy host-owned shared service, the existing `SpellcheckChecker` boundary, and the worker/plugin architecture. The controller owns current positions. The worker returns word verdicts, never stale document offsets.

Keep URL, email, path, dotted-name, syntax, inline-replacement, Markdown link-label/target, and code-fence exclusions. Keep single undo-step replacement and the editor's simple text-only API. Tokenization remains bounded even if later moved to a worker. Language expansion and underline optimization run independently.

## Execution checklist

- [ ] Read the current E062 receipt and compare the four source files above with the inspected baseline. Map each correctness acceptance item in #58 to current code and an existing test.
- [ ] Rerun the 5k/10k/20k token probe with warm-up and repeated samples under one recorded runtime. Include near-matching email/path/dotted inputs and mixed punctuation. Record deliberate skipping and scaling, without a machine-specific timing assertion.
- [ ] Run the existing tokenizer and service failure tests. Verify both `check()` and `suggest()` return rejected promises for construction failure, and every failed post leaves zero pending requests. Cover initial accepted words, a later post while other requests are pending, accepted-word sync, crash, restart, late old-worker messages, and disposal. Add a regression only when an acceptance item lacks observable coverage or fails.
- [ ] Run the existing browser typing regressions on a visible oversized line and after worker setup failure. Confirm the test observes the first failed request before checking that later typing causes no retry.
- [ ] Verify the existing plugin tests for delayed replies after edits, independent editors sharing one service, exclusions, caret hold-back, replacement, and undo. Fix only a reproduced remaining defect at its owner.
- [ ] Record which source requirements were already shipped and which current checks passed. If the current checks confirm all correctness requirements, finish this plan with the validation receipt and no duplicate runtime changes.
- [ ] For a changed runtime, build the affected workspaces, verify the real `editor-spellcheck` Platform scenario, inspect its screenshots, commit the owned paths, push, and deploy the web consumer. Update E058 and this checklist with the final evidence.

## Verification and acceptance

From `editor/packages/spellcheck/`, the narrow checks are `bun run test -- test/tokenizer.test.ts test/service.test.ts`, then `bun run test -- test/typing.browser.test.ts`. The file filters restrict the package script's configured projects to the relevant cases. Use host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill for browser runs and benchmarks.

Keep portable regression fixtures in the package. Derive probe paths from the checkout and temporary directories. The real app proof is `bun run agent:browser scenario editor-spellcheck`, with inspected evidence retained and a reachable result for the remote owner.

Completion requires bounded classification before expensive scans, settled failures without retained pending state, usable editing after failure, and unchanged offset/exclusion/replacement behavior. Timing samples establish scaling; they do not promise the historical Node or Bun timings on another machine.
