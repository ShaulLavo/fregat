# Plan 305: Select spelling languages explicitly

Status: APPROVED, 2026-10-03.

Owner: `ShaulLavo/fregat`, `editor/packages/spellcheck/` for the reusable service and Platform for settings and persistence. Reported in the read-only Singapore mirror as [Singapore #58](https://github.com/ShaulLavo/singapore/issues/58). Inspected baseline: Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`.

Dependencies: [E058](e058-spellcheck.md), [Plan 303](303-spellcheck-correctness.md). Language expansion runs separately from [Plan 304](304-spellcheck-rendering-cost.md). File spellcheck defaults remain governed by its measurements.

## Outcome

The owner chooses spelling languages independently of syntax language. A Markdown document can use selected spelling dictionaries while Markdown still determines which regions are prose. Mixed-language checking accepts a word in any selected dictionary, and suggestions merge in the configured language order.

English remains the initial selection. Additional dictionaries load when selected. The language list states which dictionaries are available and any failed load without silently applying a different selection.

## Current code

[engine notes](../editor/packages/spellcheck/docs/engine.md) already document the English-shaped policy and the explicit-language design. This documentation shipped in [E062](../editor/docs/editing/e062-spellcheck-hardening.md). It must not be scheduled as a missing fix.

The current [tokenizer](../editor/packages/spellcheck/src/tokenizer.ts) admits ASCII letters and internal apostrophes. `hola mundo` reaches the English checker; Hebrew, Russian, and `café` are skipped. These are tokenization facts, not assertions about final verdicts or language detection.

[dictionaryAssets.ts](../editor/packages/spellcheck/src/dictionaryAssets.ts) provides one merged English trie. [engine.ts](../editor/packages/spellcheck/src/engine.ts) uses `cspell-trie-lib`, while [service.ts](../editor/packages/spellcheck/src/service.ts), [protocol.ts](../editor/packages/spellcheck/src/protocol.ts), and [controller.ts](../editor/packages/spellcheck/src/controller.ts) have no selected-language generation protocol. Current dictionary versioning reacts to accepted-word changes only.

Platform creates its shared service in [runtime.ts](../apps/web/src/features/editor/state/runtime.ts), supplies file options in [use-spellcheck-plugin.ts](../apps/web/src/features/editor/hooks/use-spellcheck-plugin.ts), and registers `editor.spellcheck` and `spellcheck.words` in [settings keys](../packages/contracts/src/settings/keys.ts).

## Scope and chosen behavior

Retain the cspell engine and the existing checker/provider boundary. A hidden editable input supplies no standard diagnostics or suggestions API. Browser-native spelling is not a backend for this custom renderer.

Implement a manifest of supported dictionaries with stable language identifiers, source/version, asset location, normalization/segmentation rules, attribution, and verified permissive data licenses. Recheck the actual chosen data. An engine license or an old dictionary survey does not establish the dictionary's license.

Begin by auditing candidate Spanish, Hebrew, and Russian data against the issue's examples. Publish entries only where both data provenance and tokenization can be supported. English remains bundled and available throughout. Record unavailable candidates and the exact data or segmentation blocker in the execution receipt. The first delivery must include at least one audited additional language; an empty expanded catalog does not complete the feature.

Keep scripts, syntax regions, and spelling language separate. Use explicit supported-script selection and language-specific word segmentation. Normalize dictionary lookup keys to NFC with a defined case/apostrophe policy per dictionary. Keep accents and original UTF-16 spans, including combining marks. Preserve structured-text/excluded-range rules and Plan 303's pre-scan bounds.

## Generation and settings ownership

The service owns the selected ordered dictionary set and its generation. A requested selection loads lazily into a candidate generation. Publish it atomically after every selected dictionary is ready. If loading fails, keep the previous complete selection active and expose the failed requested selection to the host. Settle affected promises and keep disposal and worker restart explicit.

Tag requests/replies with their generation or enforce an equivalent typed request identity. On adoption, controllers clear verdicts, pending words, line tokenization, and painted issues; old-generation replies cannot repopulate them. A successful explicit generation adoption resets a controller's previous failure state. Failed loads and ordinary keystrokes do not restart it. Accepted words belong to the user and synchronize into every new generation. Keep one lazy host-owned service per page, with no mandatory singleton and no required document setup for a simple Editor.

Register the host language selection in `packages/contracts/src/settings/keys.ts` in the same change as its consumer. Use application scope because dictionary selection controls downloaded/loaded resources. Keep `spellcheck.words` suppression merging intact. Data loading remains inside the spelling service; settings reads and mutations follow the existing TanStack/registry contracts. Do not add remote dictionary URLs as a user setting or new environment variables.

## Execution checklist

- [ ] Audit candidate dictionary sources and actual versions/licenses. Record a reproducible build/import recipe, asset sizes, and supported segmentation for each approved manifest entry. Keep provenance in `THIRD_PARTY_NOTICES`.
- [ ] Finalize the selected-language/generation data shape and implement it through the existing service/worker protocol. Keep English-only construction and the plain `new Editor(element)` plugin path usable.
- [ ] Update tokenization and normalization alongside dictionary selection. Verify accented Latin text, combining marks, Hebrew, Russian, mixed scripts, apostrophes, code identifiers, structured text, excluded ranges, and oversized tokens. Dictionaries cannot enable a script the tokenizer still skips.
- [ ] Implement atomic selection adoption, lazy assets, cache invalidation, accepted-word synchronization, bounded failure reporting, restart, and stale-result rejection. Expose the complete active selection separately from a pending or failed request.
- [ ] Register the language setting, connect it to the shared runtime and composer consumer, and regenerate `settings:reference`. Document available languages and mixed-language verdict/suggestion order using the existing settings UI.
- [ ] Add portable unit tests for generation changes during in-flight check/suggestion requests, failed dictionary loading, disposal, and two editors sharing the service. Assert original UTF-16 range mapping after normalization and one undo step for replacement.
- [ ] Add real-worker and real-editor browser coverage for a supported additional language, English fallback during a failed selection, and selection changes after marks are visible. Verify the composer and file editor independently.
- [ ] Measure selected-set load time/memory and input cost against English-only before delivery. Keep file defaults unchanged unless Plan 304's measured gate permits a separate default update.
- [ ] Build affected workspaces, run narrow consumer checks and the extended Platform spelling scenario, inspect paint evidence, commit owned paths, push, deploy, and publish the receipt and supported catalog.

## Acceptance

Only selected dictionaries load. Mixed-language behavior is explicit. A selection change invalidates every dependent cache and ignores stale replies. Loading failure preserves a complete active selection. Supported non-ASCII text produces ranges at its original offsets. Dictionary provenance is verified individually, and the English-only limits remain accurately documented during rollout.
