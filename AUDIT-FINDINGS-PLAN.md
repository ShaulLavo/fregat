# Audited defect fixes

Working plan for the nine findings raised on 2026-09-12. Originally planned against Platform
`2f9528ac`; **rebased onto `d0bbaa2b` on 2026-09-12** and re-checked for drift, worktree
`.claude/worktrees/plan099-audit-findings`.

Drift from the four intervening commits (`afe4f727` dependency/editor sync, `d4e0c5f9` and `d0bbaa2b`
browser-test isolation, plus `plans/099-document-contributions.md`): **none of the nine defect files
changed**, so every unit's core anchors hold. Four corrections applied below:
`packages/ui/src/components/resizable.tsx`'s `isRecord` moved `:164` → `:167` (the missing
`value !== null` is intact, so the merge hazard stands); `.github/workflows/ci.yml` steps are now Lint
`:45`, Typecheck `:48`, Check-generated `:51`, Test `:57`; the pinned refs are `EDITOR_REF
30ae9ec8` / `GHOSTTY_REF 796d0878`, both already checked out as siblings; and every unit-8 target
(five `eslint.config.js`, five `eslint` devDependencies — now `^10.10.0`, `.prettierrc`,
`.prettierignore`, `pnpm-lock.yaml`) is still present.

This document is scratch. It is not a numbered entry in `plans/`, it is not in the
`plans/README.md` inventory, and it does not edit root `PLAN.md`. Delete it after the worktree
merges. Plan number 099 is already taken by `plans/099-document-contributions.md`, created in the
main checkout after this worktree was cut.

Every claim below was checked against source at `2f9528ac`, and every fix was attacked by a second
reader before being written down; a third pass re-checked the anchors in this document itself and
found errors, which are corrected here. Where the original finding's numbers were wrong, the corrected
number is here and the original is named as wrong — the point of the audit is not to be flattered.
Figures still labelled projections are projections: they are marked where they appear, and the three
places that need re-measuring against a real implementation say so.

## Progress

Landed on `worktree-plan099-audit-findings`, each commit verified against
[`BASELINE.md`](BASELINE.md) before the next started.

| Unit | Finding                    | Commit     | State                                                                                                    |
| ---- | -------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| 3    | LSP framing copies         | `669afeac` | **DONE** — 44.7x at 16 KiB chunks, 6.4x at the real 102 KiB read size, 0 fuzz regressions in 4,000 cases |
| 8    | Dead lint surface, CI gate | `3d1ea53e` | **DONE** — 5 configs and 24 deps deleted, `settings-reference` gate added, file-tree bench in CI         |
| 1    | Search stream completion   | `7ac493a6` | **DONE** — producer throws, replace gate is an allowlist, search now logs at all                         |
| 2    | Retention byte budget      | `d1d94b0b` | **DONE** — budget connected and registered, close-path eviction fixed                                    |
| 4    | Workspace open generation  | —          | not started                                                                                              |
| 5    | Provider command queue     | —          | not started                                                                                              |
| 6    | TUI draft attachments      | —          | not started                                                                                              |
| 7    | Session history pagination | —          | not started                                                                                              |

Decisions taken while executing, each recorded in its commit message:

- **Unit 8 / open decision 5** — `apps/server/eslint.config.js` is deleted and the language-server
  adoption change accepted. Keeping a dead lint config alive to preserve an accidental
  `lsp/registry.ts` adoption marker is not a reason to keep it. The registry and routes tests write
  their own fixture configs and are unaffected.
- **Unit 8** — the plan's instruction to delete the `eslint-disable` comments was **wrong and was not
  followed**. Oxlint honours those directives and all twelve name rules it enforces; deleting them
  turns `bun run lint` red.
- **Unit 2 / open decision 1** — the growth-point ceiling is **out of scope**, so the delivered
  property is "enforced at a switch and a close", not "always binding". Said so in the unit, the
  commit and the test name.
- **Unit 2 / open decision 7** — `'code-theme'` is a scalar widget; the test was stale, not the
  registry. `color-theme-provider.tsx` writes both keys through the scalar path.
- **Unit 2 / plan correction** — `RetainedWorkspaceSlice.rootPath` became `string | null` rather than
  taking a sentinel string, so Plan 098's branding has something honest to brand.
- **Unit 1 / plan correction** — the plan's `isCompleteDone` value predicate is not derivable
  (`path: ''` is a legal root). Fixed at the only place that knows instead: `doneEventFromData` now
  rejects a non-record payload rather than fabricating a zeroed terminal event.

Two baseline failures fixed as prerequisites rather than worked around:
`packages/contracts/src/tests/settings-mutations.test.ts` (unit 2) and
`apps/web/test/integration/server-in-process.test.ts`, which could not even load (unit 1).

Still open for a human: decisions 2, 3, 4, 6, 8, 9 and 10.

## Errata — corrections to the four fix commits

A review pass over `669afeac`, `3d1ea53e`, `7ac493a6` and `d1d94b0b` found 33 defects in them. The
code fixes are in the follow-up commit; these are the claims those commit messages got wrong. The
messages themselves are unamendable without a rebase, so this is the record.

**One blocking regression shipped.** `3d1ea53e` deleted `eslint` from `apps/server`'s
devDependencies on the premise that nothing invoked it. `apps/server/src/lsp/tests/eslint-server.test.ts`
spawns the real `vscode-eslint-language-server` against a fixture created **inside** `apps/server`, and
that server resolves the eslint library by walking up into `apps/server/node_modules`. Without it the
server returns an empty diagnostic list with no error, so the test's `code: 'semi'` assertion fails.
The message's "(37 tests pass)" counted that test — it passed only because
`bun install --frozen-lockfile` had left an orphaned `eslint@10.10.0` on disk rather than pruning it.
CI checks out fresh and would have gone red. `eslint` is restored to `apps/server` only, and the test
now asserts resolvability up front so the next dependency sweep fails loudly instead of mysteriously.

**`3d1ea53e`'s eslint-disable justification was wrong twice.** "Deleting them turns `bun run lint`
red" holds for exactly one of the twelve comments (`messages-timeline.tsx:87`,
`oxc-react-compiler/immutability`, configured `error`). Nine name warn-level rules, and every
workspace `lint` is a bare `oxlint .` with no `--deny-warnings`, so deleting those nine exits 0. Four
suppress nothing today. And `oxc-react-compiler/no-unused-directives` is about source
`'use no memo'` directives, not eslint-disable comments — there is no safety net; the flag that would
provide one is `--report-unused-disable-directives`, which nothing passes. Keeping the comments is
still right; the stated reason was not.

**`3d1ea53e` understated its own behaviour change.** The message says eslint LS adoption is lost
"when `apps/server` is the workspace root". Adoption is not root-local: `serverIsAdopted` walks from a
file's own directory up to the workspace root, and all five `eslint.config.js` files are gone, so
adoption is lost for every JS/TS file in this repo at any workspace root — including the repo root.
Because linter servers outrank typescript for diagnostics, code actions and formatting, oxlint now
owns those three where eslint did.

**`669afeac` quoted two different figures for one scenario.** 518 MiB in prose, 522.0 MiB in the
table. 522.0 is correct and consistent with the other rows: it counts both the `Buffer.concat` output
and the per-chunk `Buffer.from(chunk)` copy, and the old `push` performed both. The source comment now
says 522, and marks the payload hypothetical — no 4 MiB LSP response appears in `logs/` (largest
session total: 394,820 B). The plan's own arithmetic at the Unit 3 section was also short by one
chunk, and its `toString('utf8')` reconciliation was false.

**`669afeac`'s "512 B single chunk 2.7 ms → 1.3 ms" was mislabelled.** That pair is ~2,000 frames
through one long-lived reader, not one frame; a single 512-byte frame costs three orders of magnitude
less. The conclusion (no small-message regression) holds — re-measured at 1.06–1.33x on realistic
shapes — but the row's unit was wrong.

**`669afeac`'s "`serverBytes / serverChunkCount` is the mean read size" was wrong.** `serverBytes`
sums message _body_ lengths only, excluding every frame's `Content-Length:` header and every
discarded byte. The source comment now states the signature that those fields do support.

**`7ac493a6`'s "each of the four consumers already had a correct catch" was wrong.** Two of the four
call sites have no catch at all — `data-helpers.ts:142` and `DiskSearchProvider`'s bare `yield*`. The
conclusion (no consumer needed a new catch) holds, because the handler lives one or two layers out,
but the stated reason was the argument for throwing rather than typing the return, so it mattered. One
consumer _did_ change: `workbench.ts` lost its loop-exit `publish({ kind: 'ready' })`.

**`d1d94b0b`'s "pays no `localStorage` parse per tab close" was false.** The injected thunk called
`readSettingsMirror()`, which does a `localStorage` read, a `JSON.parse` and a valibot pass over all
31 mirrored keys, once per qualifying close. Injection relocated the cost by one call frame; it did
not remove it. The thunk now reads one key through `readSettingBootValue`, and the comments claim only
what is true: the injection keeps `apply-actions` off `features/settings` and lets a test pin the
budget.

**`d1d94b0b` left one behaviour change unmentioned.** The unconditionally-built active slice matches
`slice.rootPath === activeRootPath` when both are `null`, so the rootless active slice now spends one
of the three project slots and a rootless close retains two parked projects rather than three. Against
the code that actually ran at `d0bbaa2b` the rootless close path retained none, so this is a property
of the new code rather than a regression — but it was undisclosed. Now stated in `editorRetention`'s
docblock.

**Two claims the review upheld against my own doubt:** the differential fuzz result (re-run at 5x the
sample size with harsher chunkings — still 0 regressions, every divergence the stranded-frame class
where the new reader is correct), and the `lsp` log-line count (exactly 35,316, with none of the four
new framing fields present).

## Verdicts at a glance

| #   | Finding                                                 | Verdict                      | Owner                               | Effort                  |
| --- | ------------------------------------------------------- | ---------------------------- | ----------------------------------- | ----------------------- |
| F1  | Settings saves report success without saving            | Confirmed                    | **Plan 098 unit 2 — not this plan** | —                       |
| F2  | Search reports completion after an incomplete stream    | Confirmed, latent            | This plan, unit 1                   | S–M                     |
| F3  | The editor's memory budget is disconnected              | Confirmed                    | This plan, unit 2                   | M–L                     |
| F4  | LSP framing repeatedly copies the pending message       | Confirmed, impact overstated | This plan, unit 3                   | S                       |
| F5  | Workspace selection compares clients' clocks globally   | Confirmed                    | This plan, unit 4                   | M (+L for displacement) |
| F6  | Independent sessions share one provider-command queue   | Confirmed                    | This plan, unit 5                   | L                       |
| F7  | TUI typing rewrites unchanged attachment data           | Confirmed                    | This plan, unit 6                   | M                       |
| F8  | Session pagination leaves history collections unbounded | Confirmed                    | This plan, unit 7                   | M (server half S)       |
| F9a | The `lib/` → `features/` guard never reaches the gate   | Confirmed                    | **Plan 098 unit 3 — not this plan** | —                       |
| F9b | Dead ESLint config; benchmarks outside CI               | Partially confirmed          | This plan, unit 8                   | S–M                     |

None of the nine was refuted, but five were wrong in ways that change the fix: F2's reachability
story (the harm is latent, not live), F9's framing (the rule was never written, not lost), F3's scope
and effort (S is wrong, and the bigger bug is on the close path), F7's justification for a
content-addressed blob store (both of its premises are false), and F8's two proposed variants (neither
is shippable — see that unit).

## What this plan does not own

Two findings belong to Plan 098 and must not be implemented here. Landing them here would be worse
than leaving them: it would turn 098's characterization baseline into post-fix behaviour and defeat
its deliberate separation of baseline from correction.

**F1 — settings save acknowledgement.** Plan 098 records it as current defect 3
(`plans/098-document-and-tab-domain.md:95-98`) and owns it as implementation unit 2 (`:299-304`),
with the characterization row at `:54` and the gate at `:414`. Its treatment is sufficient: it names
both trigger classes, the consumer that trusts the boolean, the required post-state (tab and buffer
stay open), the follow-up proof, and the test files. Do not change
`features/settings/state/sync-service.ts`, `features/editor/state/save-service.ts`,
`features/editor/hooks/use-dirty-tab-close.tsx` or `keymap/workspace-commands.ts` in this plan —
098 units 2 and 5 both own those files.

Five corrections to attach to 098 unit 2's acceptance criteria, all verified here:

1. **There are six non-persisting exits, not one.** The finding describes only the
   already-conflicted buffer (`sync-service.ts:43`). The likelier route is an `idle` buffer whose
   compare-and-swap is rejected: `write()` catches `settings.RAW_REVISION_STALE`, calls
   `enterConflict`, returns void (`:80-85`). Four more resolve void identically —
   `finishAdmittedWrite` with no snapshot (`:125`), with a missing layer (`:129`), the
   committed-then-overwritten divergence (`:130-135`), and `finishWrite`'s conflict guards
   (`:156-162`).
2. **Two further guards are provably dead and should be deleted, not typed.**
   `SettingsDocumentSync` types `revision: string` for non-conflict states, and both callers narrow
   before entry, so `write()`'s `if (sync.revision === null) return` (`:66`) and
   `if (document.sync.kind !== 'settings') return` (`:62`) are unreachable. Pass
   `baseRevision: string` into `write()` and delete both. Minting union members for unreachable
   states defeats the exhaustiveness argument that justifies the union.
3. **`marked === false` does not mean "not persisted".** `applySaved` carries the comment at
   `workspace-document-service.ts:938-942`: "The write already landed on disk, so the sync metadata
   advances even when in-flight edits make the content checks below fail." Deriving
   persisted-ness from `marked` would stop `onSaved` firing for real on-disk writes and break
   `invalidateHistoryForForward` (`workspace-edit-service.ts:518-521`). Two independent facts come
   out of a settings write and must not share a union member: `bytesDurable` (did the server
   commit?) drives `onSaved`, history invalidation and the command-bus disposition;
   `bufferSettled` (did the buffer clean?) drives the close gate.
4. **TypeScript will not catch the two consumers that matter.**
   `if (results.some((saved) => !saved))` (`use-dirty-tab-close.tsx:379`) and
   `if (saved && wasDirty)` (`save-service.ts:63`) both still compile once `boolean` becomes an
   object union — `!object` is always false, `object &&` always truthy — so a half-applied change
   makes the close gate unconditional, which is strictly worse than today. `.oxlintrc.json` enables
   no `strict-boolean-expressions` and oxlint is not type-aware. Rename in the same pass
   (`save` → `saveDocument`, `saveMany` → `saveDocuments`, `SettingsSyncService.save` → `writeRaw`)
   so the compiler forces every call site to be revisited. Greenfield permits it.
5. **Refusing the close needs a resolution affordance.** `RawConflictBanner` mounts only inside the
   settings JSON view (`json-view.tsx:45`). Refusing a close without revealing that view and the
   conflicting scope trades a recoverable silent failure for a modal whose obvious exit is Discard.

Two corrections to the finding's own framing: the tab close does **not** lose the buffer —
`retain` skips dirty documents and every non-`file` sync kind
(`workspace-document-service.ts:268-269`), so the conflicted document survives in
`liveDocumentsById` and loss requires a page reload. And invalid JSON and server rejection are
already reported correctly: `settings.FILE_MALFORMED` is rethrown at `sync-service.ts:81` and
surfaces in the dialog's catch.

**F9a — the `lib/` → `features/*` import guard and the coalesced-log move.** Plan 098 unit 3
(`:306-311`) owns the move and the guard; its Mechanical enforcement section (`:354-399`) is the
detailed design, including the oxlint jsPlugin at `scripts/lint/web-boundaries.mjs` and its
calibration test. Plan 096 defers to it in as many words (`:100-104`), and Plan 097 restates the
deferral (`:8`, `:432-434`). This plan adds no second boundary rule and does not move
`apps/web/src/lib/file-server.ts:16`.

Verified here, for 098's benefit, by running the installed oxlint 1.70.0 against fixtures carrying
all five import forms:

- `no-restricted-imports` with `group: ["@/features/*", "@/features/**"]` catches alias, type-only
  and re-export forms. It **misses** relative escapes — closed for free by adding
  `"**/features/*", "**/features/**"` — and **cannot** catch `await import('@/features/x')` at all.
  Two of the five required forms fail with the built-in rule, so 096's requirement at `:124-125`
  ("a spelling-only grep is insufficient") is not met by it.
- 098's jsPlugin design does work on this binary. The object form with a relative specifier loads,
  functions inside `overrides`, and catches the dynamic import at `prod.ts:5:19`. The complete
  visitor set is `ImportDeclaration`, `ImportExpression`, `ExportNamedDeclaration`,
  `ExportAllDeclaration` and `CallExpression` — a plugin omitting the two export visitors misses
  `export { x } from '@/features/…'`.
- Drift correction for 098: `.oxlintrc.json:4` is `"jsPlugins": ["oxc-plugin-react-compiler/eslint"]`,
  a list of **strings**. 098's sketch adds an object entry to that same list; the object form was
  confirmed to work, so the sketch is sound, but `scripts/lint/` does not exist yet and root
  `"test:scripts"` names exactly one file — so 098's "add this file to root `test:scripts`
  unconditionally" is a required edit, not an automatic pickup.
- Enforcement turns on with exactly **one** production fix. `grep -rn "from '@/features/"
apps/web/src/lib` returns 19 hits: `lib/file-server.ts:16` plus 18 inside
  `lib/**/tests/**`, which are legitimate under the repo's drive-real-code test doctrine and want
  `excludeFiles`. Zero relative escapes exist today.
- Gotcha for whoever writes it: `extends` re-anchors inherited `overrides` globs to the _extending_
  config's directory. A root override anchored at `apps/web/src/lib/**` silently stops matching if
  anyone later adds an `apps/web/.oxlintrc.json` — no error, no warning. Prefer a local
  `apps/web/.oxlintrc.json` with `{"extends": ["../../.oxlintrc.json"]}` and `files: ["src/lib/**"]`,
  mirroring the existing `apps/tui/.oxlintrc.json` idiom.

## Verification policy

`bun run test` is **RED on clean `main`** at `2f9528ac`: 25 failing test files, 43 failing tests,
with only docs modified. So "the suite must be green" is not a usable completion criterion, which is
what `plans/README.md:15-16` already legislates ("never gate completion on an absolute test count or
a bare root `bun run verify`").

Capture the baseline before the first edit and assert **no new failures** against it. Failures
include deterministic, non-environmental ones:
`packages/contracts/src/tests/settings-mutations.test.ts:46` and `session-vocabulary.test.ts`.

**Do not reuse the audit's environmental attributions — both were wrong on inspection.**
`apps/tui/src/terminal/tests/host.test.ts:4` is
`test.runIf(process.platform === 'linux' && Bun.which('nvim'))(…)`, so a missing `nvim` makes it skip
rather than fail, and `nvim` is present on this machine — whatever fails there, it is not that. And
`apps/tui/src/host/tests/frame.test.ts` never asserts a settings count at all (28 lines, five
assertions, none about settings); the `1 setting` expectations live in
`components/tests/foundation.test.tsx:39`, `components/tests/application.test.tsx:58,95`,
`navigation/tests/integration.test.tsx:45` and `settings/tests/editor.test.ts:104`. A real
`~/.platform/settings.json` leaking into the test env remains a plausible cause of a `52 settings`
reading, but attribute it to the file that actually asserts it, from the baseline run's own output.

`settings-mutations.test.ts:46` is **already failing and is in unit 2's blast radius** — a new scalar
setting lands on top of a red assertion. Its cause, read from source rather than from the runner:
`SCALAR_SETTING_IDS` is `SETTING_IDS` minus eight explicitly listed non-scalar ids
(`settings/mutations.ts:25-43`), while the test's `expected` is `SETTING_IDS` filtered by
`widget ∈ {boolean, enum, font, multiline, number, string}`. `editor.codeTheme.dark` and
`editor.codeTheme.light` have `widget: 'code-theme'` (`keys.ts:77-96`), so they are **in**
`SCALAR_SETTING_IDS` and **absent** from `expected` — the received array carries two extra entries.
(One audit pass reported this in the opposite direction; the reading above is from source. Confirm
against the runner where the work is done — this worktree has no `node_modules` and cannot run it.)
That makes it a real decision, not a stale snapshot: either `'code-theme'` is a scalar widget and
belongs in the test's set, or the two keys belong in `NON_SCALAR_SETTING_IDS`. Settle it in unit 2,
where a new registry entry touches the same assertion.

Measured budgets on this machine: `format:check` 0.67s, `generated:check` 1.44s, `typecheck` 5.5s,
`lint` 41.1s, full `test` 1m14s wall.

Per-workspace focused commands, all verified:

```sh
cd apps/web    && bun --bun vitest run --project node src/…/foo.test.ts
cd apps/web    && bun --bun vitest run --project dom  src/…/foo.test.tsx
cd apps/web    && vitest run --config vitest.browser.config.ts src/…/foo.browser.tsx   # no --bun
cd apps/server && bun --bun vitest run src/fs/tests/search.test.ts
cd apps/tui    && bun --bun vitest run src/…/foo.test.ts
cd packages/contracts && vitest run src/tests/foo.test.ts                              # no --bun
cd packages/client-core && vitest run src/…/foo.test.ts                                # no config file
bun --bun vitest run scripts/runtime-network.test.ts --environment node                # from root
```

`apps/web/test/integration/server-in-process.test.ts:5` imports `@/lib/workspace-search-client`,
a module that no longer exists (now `packages/client-core/src/files/search-client.ts`). It is inside
the `node` project glob, so it fails to resolve at HEAD. Record it as a pre-existing baseline
failure and repoint it in unit 1, which changes that collector's contract anyway.

## Landing order

Land the behavioural fixes **before** Plans 091, 094 and 098 touch the same files. Each fix is a
small correction; the consolidations are large mechanical rewrites. Rebasing a rewrite over a fix is
cheap; re-deriving a fix inside a rewrite is not.

1. **Unit 8** (F9b) — no contracts and no consumers, but not quite orderless. Its item 7 (the
   `settings-reference` `--check`) is what gives unit 2's new registry key a gate, so land item 7
   **before** unit 2 or accept that unit 2 must regenerate `docs/settings-reference.md` by hand with
   nothing checking it. Its item 1 invalidates two CI caches and the editor-open calibration, and its
   item 5 adds a CI step every later PR then runs — both are reasons to land it early rather than
   late.
2. **Unit 3** (F4) — no plan names `stdio-rpc.ts`. Fully independent.
3. **Unit 7** (F8) server-only half — narrowed DESC read-model query, diff-query point read, the new
   wide-event fields. No contract surface. One caveat on "server-only": the field additions include
   `pipeline-logging.ts:41-49`, which is the **client's** `chatSessionSnapshotSummary` under
   `apps/web/src/features/chat/utils/` — it needs no coordination, but it is not a server file.
4. **Unit 2** (F3) — before Plan 098 unit 5, which rebrands `RetainedWorkspaceSlice.documentIds`
   and `tabIds` to `DocumentKey` / `TabId` and rewrites `apply-actions.ts:277-287`.
5. **Unit 1** (F2) — before Plan 094's observable-store merge folds `search/state/workbench.ts`, and
   outside Plan 097's execution window: 097 carves the search protocol out of its own scope
   (`097:175`), so there is no ownership conflict, but its drift check diffs `packages/client-core`
   wholesale (`097:406`), which covers this unit's `search-client.ts` edits. Land before 097 starts or
   after it finishes, not during.
6. **Unit 6** (F7) — before Plan 094's attachment-policy item (`094:349-375`) and its
   observable-store reconcile, which cites `drafts.ts:197`.
7. **Unit 4** (F5) steps 1–4 — before Plan 085's bootstrap milestone, which runs through this open
   path and would otherwise measure a racing baseline.
8. **Unit 5** (F6) — write the worktree-exclusion regression green against HEAD first.
9. **Unit 7** client half, then **unit 4** step 5 (index displacement) — the two largest surfaces.

---

## Unit 1 — A search stream that ends without `done` must not report success (F2)

**Verdict: confirmed mechanism, latent harm.** The finding's reachability story is wrong in two ways
and misses the one instance that fires today.

### Ground truth

`collectWorkspaceSearch` never records whether a `done` event arrived. It keeps the last one if one
happens to come (`search-client.ts:37,50`) and then fills every terminal field optimistically:
`count: done?.count ?? matches.length` (`:54`), `truncated: done?.truncated ?? false` (`:60`). A
stream that simply ends is indistinguishable from a completed one. The defect spans `:37-62`; the
cited `:53` is the first line of that `return` block.

The TUI anchor is exact. `apps/tui/src/search/state/workbench.ts:46` is
`if (!controller.signal.aborted) publish({ ...state, kind: 'ready' })`, which fires on loop exit
whether or not `done` was seen, leaving `truncated` at the `false` set by the loading publish
(`:37`). That falsifies exactly the two fields the replace gate reads: `pane.tsx:99` disables
`search.replace` unless `state.kind === 'ready' && rows.length && !state.truncated`. Driven with a
real eden client whose response ended after two match frames, the snapshot was
`{kind:'ready', matches:2, truncated:false}` and the pane's `disabledReason` evaluated to `null` —
replace unlocked.

The TUI's replace is the destructive end: `prepareReplacement` (`state/replacement.ts:29-49`) takes
the distinct paths of the partial match set and rewrites **every occurrence in each whole file**,
and the dialog's confirmation count (`replace-dialog.tsx:115`) comes from the same partial set, so
nothing tells the user files are missing from the run. Web's is not destructive:
`replace-runner.ts:142-159` edits only the exact match ranges it was handed.

### Corrections to the finding

- **Budget truncation is not the trigger.** Hitting the result or file budget `break`s the match
  loop and still yields warnings and then `done` with `truncated: true`
  (`apps/server/src/fs/search.ts:271-290`). Commit `bc013a3a` touched only the web-local
  `OpenBufferSearchProvider`, which likewise still yields
  `doneEvent(query, count, count >= query.limit)` (`providers.ts:71`). A control run with a real
  truncating frame produced `{count:1, truncated:true, warnings:1}` — correct.
- **No current server path ends the stream cleanly without `done`** except
  `search.ts:265` (`if (signal?.aborted) return`), which requires the caller to have aborted. Every
  other exit yields `done` or throws, and a throw becomes an `error` SSE frame the client converts
  to a thrown `SEARCH_EVENT_ERROR` (`search-client.ts:108-110`). A genuinely premature transport
  close was measured: Bun's fetch throws `TypeError: The socket connection was closed unexpectedly`.
  There is no dev proxy (`apps/web/vite.config.ts:45-61`) and the TUI has no per-request timeout.
- **So the destructive TUI harm is latent, not live.** It needs an intermediary that closes the body
  cleanly, a partially delivered `done` frame, or one future early `return` on the server. The work
  is justified by a gate that is defeatable in principle and untested — not by a half-applied rename
  happening today. The finding's "risk low, effort S" reads as a live defect; it is not one.
- **The reachable instance the finding missed is abort-reported-as-success.**
  `streamWorkspaceSearch` swallows the caller's abort with `if (signal?.aborted) return`
  (`search-client.ts:78`) instead of `throwIfAborted()`, so the collector resolves. Aborting after
  the first frame returned `{count:0, matches:0, truncated:false}` rather than rejecting. This fires
  on every keystroke in the command palette and in chat project-entry search. TanStack Query
  discards the late value, so the UI is spared — but `observeClientOperation` takes the success
  branch and writes `fs.quick_open_files outcome:'ok'` with a partial `matchCount`, and
  `fetchQuickOpenFiles` does not pass `signal` into the event, so the abort suppression at
  `client-logging.ts:94` cannot help. One wrong log line per keystroke.

### The fix

Put the invariant in the producer, not in a return value.

The structural proposal — typing the generator as
`AsyncGenerator<WorkspaceSearchEvent, WorkspaceSearchOutcome>` — does not deliver what it promises.
`for await` discards a generator's return value with no diagnostic, and `yield*` into an
`AsyncGenerator<T>` (whose `TReturn` defaults to `any`) launders it, which is exactly what
`DiskSearchProvider.search` (`providers.ts:32-41`) does today. Making the outcome unignorable means
widening `SearchProvider` (`providers.ts:22-24`) and every implementor and stub — roughly 20 files —
to buy a property that a throw gives for free in one.

1. **`packages/client-core/src/files/search-client.ts:65-80`** — track terminality and end the
   generator by throwing:

   ```ts
   let matchCount = 0
   let terminated = false
   for await (const event of parseEdenSseStream(response.data)) {
     signal?.throwIfAborted()
     const parsed = workspaceSearchEventFromSse(event)
     if (parsed.type === 'match') matchCount += 1
     terminated = parsed.type === 'done'
     yield parsed
   }
   if (!terminated) throw searchErrors.SEARCH_INCOMPLETE({ matchCount })
   ```

   Three things that block this and must land with it:

   - **`matchCount` does not exist in `streamWorkspaceSearch` today** — the generator holds no
     counter. Count in the loop, as above.
   - **`SEARCH_INCOMPLETE` is not in the catalog.** Add it to
     `packages/client-core/src/files/search-errors.ts` alongside the five existing entries
     (`EDEN_STREAM_MISSING`, `SEARCH_EVENT_ERROR`, `SEARCH_FAILED`, `SEARCH_MATCH_INVALID`,
     `UNEXPECTED_SEARCH_EVENT`), with `code`, `status`, `why` and `fix`, per the feature's
     `defineErrorCatalog` wrapper. Never `new Error`.
   - **Do not write an `isCompleteDone` value predicate.** An earlier draft proposed one to reject the
     zeroed `done`, and no such predicate is derivable: `doneEventFromData`
     (`search-client.ts:153-167`) returns `{ count: 0, path: '', query: '', truncated: false }` when
     the frame payload is not a record, and every one of those values is legal for a real empty result
     — `path: ''` is a valid workspace root (098:58 records `search-buffer:` for root `''`). Fix it at
     the only place that knows: make `doneEventFromData` reject a non-record payload instead of
     fabricating a zeroed event, following `SEARCH_MATCH_INVALID`'s precedent for exactly this shape.
     Then `terminated = parsed.type === 'done'` is sufficient, because a `done` that arrives can no
     longer be a fabrication.

   `throwIfAborted` is already the house pattern (`files/read.ts:20`, `chat/owner.ts:128`).

   All four inference sites are then fixed with zero further edits, because each already has a
   correct catch: `collectWorkspaceSearch` propagates (`:39`); `createSearchWorkbench` lands in its
   catch and publishes `kind:'failed'`, which renders (`pane.tsx:170`) and blocks replace
   (`pane.tsx:99`); `CompositeSearchProvider` logs `outcome:'error'` and rethrows
   (`providers.ts:118-122`) so no `done` is fabricated; `streamSearchScope` swallows it only when
   `scopedSignal.aborted` (`picker-search.ts:110-112`), which is the deliberate 6s-timeout
   tolerance — and that line stops being ambiguous once the non-aborted case throws, so one comment
   replaces a refactor.

2. **`apps/web/src/features/search/hooks/use-replace.ts:149-158`** — flip `canReplace` from a
   denylist to an allowlist: `if (snapshot.status !== 'ready') return false`. Today only
   `status === 'loading'` blocks, so `'error'` passes. On a same-query re-run
   (`appendingToResults` true) `failSearchBuffer` (`buffer-state.tsx:627-647`) clears the running
   fields (`pendingResultIds`, `runningMatches`, `runningQuery`, `runningSearchQuery`,
   `streamBaseMatches`) but **not** `matches`, so the partial set stays in `snapshot.matches` and
   replace stays enabled over a proven-incomplete set. This closes that and the pre-existing
   `'error'` hole together.

3. **Server `try/finally` in `observedSearchEvents`** (`apps/server/src/fs/service.ts:789-830`) so a
   generator returned by a client disconnect still records a terminal status. **It needs a
   `recorded` guard**: `recordStreamSummary` already runs on the normal path (`:829`) and in the
   catch (`:822-825`), and a bare `finally` would add a second `fs.operations[]` entry to the same
   wide event for every search — turning one wide event into two, the opposite of the wide-event
   rule.

4. **Repoint** `apps/web/test/integration/server-in-process.test.ts:5` from the deleted
   `@/lib/workspace-search-client`.

**Deferred deliberately:** the `outcome: 'complete' | 'result-limit' | 'file-limit'` contract change.
It is a product question about UI copy and it drags in the persisted cache schema and a
`WORKSPACE_CACHE_VERSION` bump for no correctness gain.

**Caveat to accept:** reusing `'error'` in web rather than adding an `'incomplete'` status means the
summary reads "Search failed · Showing previous results" (`summary.tsx:99-104`). That is accurate for
a new query and imprecise for a same-query re-run. Adding the status costs all four
`SearchBufferStatus` switches, `cachedSearchBufferStatus` and a cache version — pay it only with
eyes open.

### Observability

No search event says whether a terminal frame arrived, on either side.

- Server: `completed` exists and ships in `searchStreamSummary` (`service.ts:894-902`, the `completed` field at `:902`) — the right wide
  shape — but only when the loop completes normally or throws. When `sseResponse` calls
  `events.return()` on disconnect (`sse.ts:56-62`) the generator is suspended at `yield` with no
  `finally`, so nothing is recorded. Verifiable in the data: of the `search_events` lines in
  `logs/2026-08-27.1.jsonl`, not one carries `completed` or `matchCount`. Fixed by item 3.
- Client: `logSearchCompleted` (`providers.ts:174-189`) writes a bare `outcome:'ok'`. Replace with a
  terminal condition: `'complete' | 'truncated' | 'aborted' | 'incomplete'`.
- Thread `signal` into `observeClientOperation` at `file-server.ts:206`. (Note: the finding's
  companion anchor `:251` is `writeFileContent`'s log event, which has no `signal` in scope at all —
  that edit cannot be executed as written.)
- The TUI logs **nothing** for search — no `log.` call anywhere under `apps/tui/src/search` — which
  is where the destructive replace lives. Add two wide events, named so they can be grepped:
  `action: 'tui.search.run'`, `area: 'search'`, with `query`, `matchCount`, `fileCount`,
  `outcome: 'complete' | 'truncated' | 'aborted' | 'incomplete'`, `durationMs`; and
  `action: 'tui.search.replace'`, `area: 'search'`, with `pathCount`, `replacedCount`,
  `searchOutcome` (the outcome of the run it was planned from) and `durationMs`. Without that second
  field nothing connects a half-applied repo-wide rename to the incomplete search that authorised
  it.

### Tests

The condition under test is one **no current server produces** (see Corrections), so it has to be
fabricated at the transport. That is allowed and is not `mock.module`: `streamWorkspaceSearch` takes
its `Client` as a parameter, so a test supplies an object exposing only the one route it calls, whose
handler returns a `Response` whose SSE body the test controls. Mocking our own _modules_ is what the
doctrine forbids; injecting at a parameter is what it prescribes. `packages/client-core` runs plain
`vitest` (no `--bun`) and therefore cannot drive the Bun-native in-process server, which is the other
reason the fake client is the right seam here.

- `packages/client-core/src/files/tests/search-client.test.ts` (new; plain `vitest`) — over an
  injected client: a body ending after two `match` frames with no `done` rejects with
  `SEARCH_INCOMPLETE` carrying `matchCount: 2`; a body with a real truncating `done` resolves
  `{truncated: true}`; an aborted signal rejects rather than resolving `{count: 0}`; a `done` frame
  whose payload is not a record rejects instead of yielding a zeroed event.
- `apps/tui/src/search/tests/workbench.test.ts` (node) — `createSearchWorkbench` over an incomplete
  stream publishes `kind:'failed'`, and the `disabledReason` expression at `pane.tsx:99` is non-null.
- `apps/web/src/features/search/hooks/tests/use-replace.test.tsx` (dom) — `canReplace` is false for
  `status:'error'` with matches held from a prior run.
- `apps/server/src/fs/tests/search.test.ts` (extend) — a client disconnect mid-stream records exactly
  one `fs.operations[]` entry, carrying a terminal status. This one drives the real in-process server
  per the fixture doctrine; only the _disconnect_ is synthetic.

### Coordination

Plan 091 edits `search-client.ts:316` (the `isRecord` copy) and its five `clientErrors` throw sites
including `:75`; this unit edits `:65-82` and `:153-167`, and adds a catalog entry — enough to shift
`:316` either way. Plan 092 edits `providers.ts:381,388`.
Plan 094 folds `search/state/workbench.ts:14` into one observable store (`094:466-469`) and must keep
the `disposed`-flag family. Plan 094's replacement item is `apps/tui/src/search/utils/replacement.ts`
and `apps/web/src/features/search/utils/replace.ts` (`094:443-452`) — **not** `search-client.ts`, so
`done`-completeness is unowned and this plan takes it. Whichever lands second rebases; no behavioural
conflict in any of them.

---

## Unit 2 — Fix the retention byte budget's two defects, and decide whether it binds (F3)

**Verdict: confirmed, both halves, and the finding understates the scope.** Effort is M–L, not S.

### Ground truth

1. The 64 MiB ceiling is a hardcoded module constant,
   `DEFAULT_BYTE_BUDGET = 64 * 1024 * 1024` (`document-retention.ts:2`). No registry key exists.
2. The only production caller that can engage it, `retentionForWorkspaces`
   (`apply-actions.ts:263-275`), passes exactly `activeRootPath` and `slices` at `:269` — no
   `documentSizes`, no `byteBudget`, no `projectLimit`. `withinByteBudget` bails on its first line,
   `if (!documentSizes) return parked` (`:82`). The budget is not "treated as zero"; it is **skipped
   entirely**. The only ceiling in force is `DEFAULT_PROJECT_LIMIT = 3`.
3. The accounting bug reproduces. `sliceBytes` mutates `counted` (`:110`) **before** the caller's
   budget test (`:91`), so a rejected slice's documents are marked already-charged and a later slice
   that actually keeps them is charged 0. Running the real module: budget 100 retained 105, and 175
   with four slices, against a believed total of 10 in both.

Three corrections to the finding's framing: it is not specific to overlapping or nested roots — two
parked slices sharing one document id suffice, nested or not; the direction is **under**charging, not
double-charging; and it is latent today precisely because of defect (1).

**The finding understates scope.** The same "caller hands retention its own partial view of the
world" API shape produces a second, fully reachable defect at the _other_ retain call site
(`apply-actions.ts:290-295` + `:328`), reproduced against the real document store: closing a tab in
one project evicts a parked project's clean documents and disposes every parked view. That is a
bigger user-visible bug than the budget gap and is the strongest argument for the structural answer.
It is recoverable — the parked workspace still records its tabs, so switch-back re-runs the open
path — so the real cost is a refetch plus the loss of that buffer's undo history and view session,
not lost content.

Also: "the editor has no memory bound" would be false. The prepared-open cache has a working byte
ceiling (32 MiB total, 1 MiB per file, 8 records, 30s TTL). The accurate statement is that
_retention_ imposes no byte bound at all.

### The fix

Do **not** change `WorkspaceDocumentService.retain`'s signature. Get the "omitting sizes is
inexpressible" property from the other side.

1. **Make `documentSizes` required** on `retentionForProjects` (`document-retention.ts:35`), and make
   the only producer of that map `documentSizes(): ReadonlyMap<string, number>` on the service,
   surfaced through the document store. The map type can then only come from the store that owns the
   documents, so a caller cannot invent one — same compile-time guarantee, and it keeps the service
   free of `rootPath` / `lastActiveAt`, which are workspace vocabulary. It also leaves the three
   direct `retain` calls in `document-retain.test.ts:32,47,60` working, and avoids colliding with
   Plan 098 unit 5's rename of `retain`.

   **The map must hold every live document, not only the evictable ones.** `sliceBytes` charges
   `documentSizes.get(documentId) ?? 0` (`document-retention.ts:111`), so any document absent from the
   map is charged zero — and an unevictable document (dirty, non-`file` sync, or path-unavailable)
   still occupies memory. An evictables-only map would make "active + parked ≤ budget" a claim about a
   number smaller than the real footprint, which is the same class of defect this unit exists to fix.
   Hence `documentSizes` rather than `evictableDocumentSizes`: the name must not invite the narrower
   membership. Report the unevictable share separately through the `unevictableDocumentBytes` field
   below.

   Size collection is O(live documents) with no allocation beyond one Map: `getTextSnapshot()`
   returns a retained field and `.length` is `snapshot.length`
   (`../Editor/packages/editor/src/documentSession.ts:764-766`, with `length` at `documentTextSnapshot.ts:202-204`). There is no performance argument
   for keeping sizes optional.

2. **One shared slice builder used by both retain call sites, with the active slice built
   unconditionally.** This is the edit that fixes the close-path eviction, and it is independent of
   where sizes come from, so it can land first and alone as the bug fix.

   `RetainedWorkspaceSlice.rootPath` is a plain string (`document-retention.ts:7`), so "use a
   sentinel" needs a value that cannot collide with a real root. Do not invent a magic string —
   Plan 098 unit 5 is about to brand this field, and 098's own enforcement bullet (`:371-373`) forbids
   claiming branding protects helpers that "still accept any string". Widen the field to
   `rootPath: string | null` instead and let `null` mean the rootless active slice: it is
   uninhabitable by a real path, it survives branding as `DocumentKey`/`TabId` land around it, and
   `retainedSlices`'s `slice.rootPath === activeRootPath` comparison (`:66`) already does the right
   thing when both sides are `null`.

   This must not be gated on `activeRootPath` the way `apply-actions.ts:271-273` is. On the close
   path with `rootFolder === null` a conditional active slice yields a keep set containing only
   parked slices, so every open document falls outside it. Reachable: `applyFolderless`
   (`apply-view.ts:176-201`) calls `clearRootFolder()`, and rootless surfaces are still openable
   (`openSettingsEditor`, `apply-actions.ts:119-120`). Today `:290-295` protects the remaining tabs
   unconditionally — preserve that.

3. **Split measure from commit, with a local `seen` set.** `sliceBytes` becomes a pure `measure()`
   that consults `counted` without mutating it; the caller commits the slice's ids only in the kept
   branch.

   **Two commits, not one.** The active loop at `:86` must still commit unconditionally. Taken
   literally, "commit only in the kept branch" also de-commits the active loop, and simulation
   confirms the consequence: for the nested-roots input, `kept` goes from `["/repo/apps/web"]` to
   `[]`, because `active` never commits `shared`, parked is charged 100 again, and 100+100 > 100.
   That is exactly the input of `charges a document shared by nested roots only once`
   (`document-retention.test.ts:58-72`), whose `expect(retention.tabIds.size).toBe(2)` would go to 1.
   Spell out both commit rules or the implementer breaks the invariant the module header comment
   (`:16-25`) exists to protect.

   A non-mutating `measure()` also loses the intra-slice dedupe that mutating `counted` inside the
   loop gave for free, hence the local `seen` set. Production cannot produce a duplicate id today
   (`editorOpenPathsForWorkbenchPanels` dedupes, `panels.ts:41-43`) but the unit tests build slices
   by hand.

4. **Register the budget** in `packages/contracts/src/settings/keys.ts`. `keys.ts:493-508`
   (`lsp.idleTimeoutMs`) is the precedent for the shape; `category` is a free-form string and
   `'Editor'` already exists, so no category plumbing is needed. It must be registered in the same
   pass as its consumer, not ahead of it.

   **Scope: `machine`, following that precedent rather than overriding it.** An earlier draft asserted
   `application`. `lsp.idleTimeoutMs` chose `machine` with the comment "Machine scope: this is a
   per-box RAM tradeoff" — the identical argument for an identical quantity, and a 64 MiB ceiling that
   is right on a 64 GB workstation is wrong on an 8 GB laptop, which is what `machine` scope is for.
   What CLAUDE.md settles here is only the negative: a memory budget reaches neither execution nor
   suppression, but it must not be `window`, because a workspace file ships inside a cloned
   repository. Record the choice explicitly in the plan so it is not re-litigated.

5. **Inject `budgetBytes`** into `createEditorApplyActions` from the runtime that already reads
   settings, instead of calling `readSettingsMirror()` inside `apply-actions`. Three wins: no
   cross-feature import; no `localStorage` parse plus ~32 valibot parses per tab close on the
   address-apply loop; and the budget becomes pinnable in the `node` project — which is the only way
   the headline test can exist at all. `readSettingsMirror()` reads `localStorage`, which is
   `undefined` under Bun, so `parseStored()` swallows the `ReferenceError` and yields
   `DEFAULT_SETTING_VALUES` — **unless a test installs a `Storage` shim**, as
   `features/editor/state/tests/color-theme-store.test.ts:29-49` already does in the **node** project
   (its comment at `:26`: "The node project reads the settings boot mirror through the Storage
   boundary"). So the headline test is not strictly unwritable without item 5; it would just have to
   reach through that shim to pin a value `apply-actions` reads for itself. The argument for injection
   rests on the other two grounds: no cross-feature import from `features/editor` into
   `features/settings`, and no `localStorage` parse plus ~32 valibot parses per tab close on the
   address-apply loop. Cost: eleven `createEditorApplyActions` construction sites gain one field, all
   mechanical and typechecked.

### State the honest outcome

With items 1–5 the property delivered is "active + parked ≤ budget, **sampled at a project switch or
a tab close**" — not "the declared 64 MiB ceiling". Nothing calls retention when a document is
_created_: `grep -rn retainEditorDocuments` returns exactly two production sites,
`apply-actions.ts:251` and `:328`. Walk the finding's own scenario with the fix landed: open 40 MiB in
project A, switch to B (parked A = 40 MiB ≤ 64, kept), open 40 MiB in B. Live footprint 80 MiB, and
no retention trigger exists until the next switch or close. With two projects it never fires.

The trigger that actually binds is an LRU ceiling inside `ensureLiveDocument` /
`ensureViewForDocument`, where the footprint grows. `WorkspaceDocumentService` already owns every
live document and already knows which are clean, `sync.kind === 'file'`, path-available and
view-unreferenced — the predicate is written at `:266-274` and `:279-286`. That needs no caller input
for the byte half at all, and leaves slice policy governing only project count and view lifetime,
which is what its header comment says it is for.

**Decide explicitly:** land the growth-point ceiling in this unit, or scope it out — and if it is
scoped out, stop describing the outcome as "the declared 64 MiB ceiling now binds" anywhere,
including in this unit's title and its headline test.

If it is landed, note that item 5's injection does **not** reach it. `budgetBytes` goes into
`createEditorApplyActions`, and `ensureLiveDocument` / `ensureViewForDocument` live in
`WorkspaceDocumentService` (`workspace-document-service.ts:323`, `:367`), which `apply-actions` does
not construct. The growth-point branch therefore needs its own three things, none of which exist
above: the budget threaded into the service's constructor instead; an eviction order (LRU by last
access over the documents the existing predicate at `:266-274` already deems evictable, newest-first
retained); and its own test asserting that opening past the ceiling evicts rather than grows. Price it
separately — the "M-L" in the verdict table covers items 1-5 only.

### Observability

`retainEditorDocuments` returns `{evictedDocumentIds, evictedTabIds}` and both call sites discard it,
so eviction and its absence are invisible. `workspace.root_switched` carries `parkedCount`, `path`,
`previousPath`, `restoredTabCount` and nothing about retention — confirmed against real lines in
`logs/2026-08-27.jsonl`. The close path logs nothing at all, which is why the close-path eviction
could destroy parked documents without a trace.

Add to the existing `workspace.root_switched` event rather than new narrow lines: `budgetBytes`,
`retainedDocumentBytes`, `unevictableDocumentBytes`, `evictedDocumentCount`, `evictedTabCount`,
`droppedRootPaths`. Add an `editor.command.close_tab` wide event carrying the same eviction fields
alongside the tab context that `editor.command.select_file` already models (`:195-208`). No
structured error belongs here — this is a silent policy bypass, not a thrown path, and
`documentSizes` becoming required moves "the caller forgot" from runtime to compile time.

### Tests

- `document-retention.test.ts` — a rejected parked slice does not discount a later slice's shared
  documents; the existing nested-roots test stays green (it pins the active-loop commit);
  intra-slice duplicate ids are charged once.
- `apps/web` (node) — the budget is enforced **at a project switch** with `budgetBytes` injected low.
  Name it for what it proves ("evicts a parked slice over budget on switch"), not "the ceiling binds" —
  it says nothing about the growth path, and a test named for the stronger property is how someone ends
  up believing they shipped it. This is why item 5 exists.
- `apps/web` (node) — closing a tab in one project retains a parked project's clean documents and
  does not dispose its views. This goes in **red** and comes out green; it is a bug-fix test, not a
  characterization record, and should not be folded into Plan 098's baseline.
- `apps/web` (node) — retention with `rootFolder === null` retains the open documents.

### Coordination

No plan mentions `document-retention.ts`. Plan 098 unit 5 (`:319-321`) migrates "store/service/view
keys, dirty sets, retention, save entry points and closing to the common types" and unit 8 deletes
path-based tab membership; `RetainedWorkspaceSlice.documentIds` / `tabIds` are exactly the strings it
rebrands. Land this first so 098 carries it. Preserve the union-over-slices rule
(`document-retention.ts:22-24`) and the charge-shared-documents-once rule (`:100`).

`docs/settings-reference.md` is **not** covered by `generated:check` — see unit 8 — so regenerating
it after item 4 is a CLAUDE.md obligation with no CI backstop today.

---

## Unit 3 — Assemble each LSP body once (F4)

**Verdict: confirmed. The arithmetic is exact; the stated impact is not.** Keep this at S and
describe it honestly.

### Ground truth

`push` (`stdio-rpc.ts:15`) is `this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])`: the
whole pending message is reallocated and recopied on every chunk, plus a second defensive copy of the
chunk itself.

For 4 MiB in 16 KiB chunks: 256 chunks, concat copies `16384 × Σ(1…256) = 16384 × 32896 =
538,968,064 B = 514.0 MiB`, plus `256 × 16 KiB = 4.0 MiB` of `Buffer.from` copies = **518.0 MiB
exactly**. The claim is right to the byte. Closed form: `copied ≈ total² / (2 × chunk)`.

**The second quadratic cost does not exist.** I expected `this.buffer.indexOf(HEADER_SEPARATOR)`
(`:29`) to rescan the accumulated body per push. It does not: when the body is incomplete
`nextMessage` returns at `:41` **without trimming the buffer**, so the separator stays ~22 bytes from
the front and `indexOf` hits immediately. Measured on the 4 MiB case: 6,939 bytes scanned over 258
calls = 26.9 bytes per call, constant. The single quadratic term is the concat, exactly as the
original finding said.

### Impact, corrected

The finding's "caused 518 MiB" asserts an observation. It is a synthetic figure:

- **The chunk size is wrong.** The real pipe delivers ~102 KiB reads, not 16 KiB. At the measured
  chunk size the same formula gives **~84 MiB** for a 4 MiB payload (measured range 72.7–86.0 MiB).
  That is the number the plan should carry.
- **No 4 MiB LSP response has been observed.** Largest single-session server total in `logs/`:
  394,820 B.
- **Nothing stalls the server.** The synthetic 32.6–33.5 ms (4 MiB) and 130.8–162.6 ms (16 MiB)
  figures are tight loops. Against the real feed the work is spread across one event-loop turn per
  stdout read, and the worst measured **single-tick** block is 1.0–1.6 ms at 4 MiB and 4.5–6.1 ms at
  16 MiB — under one frame at 60 Hz. Claims that unrelated routes, other terminals or the editor UI stall behind it are not
  supported.
- **The load argument is backwards.** Load left read size unchanged or larger, and copy volume
  slightly lower.

So this is a real, cheap, worthwhile fix with a large measured multiplier on the framing work
itself — and not a production incident. Two genuine correctness defects in the same 66 lines are
worth more than the allocation win:

1. **A stranded frame.** After a header block with no valid `Content-Length` is discarded (`:36`),
   `nextMessage` returns null, which exits `drain`'s loop (`:22`), so a complete frame already
   sitting behind it in the buffer waits for the next chunk. If the server goes quiet the response is
   lost and the caller's request hangs — with no log. (Any subsequent push, even zero-length,
   releases it, so "never delivered" overstates it.)
2. **No bound anywhere.** `Number.parseInt` (`:62`) is accepted unchecked, so
   `Content-Length: 999999999999` buffers without limit, with no error and no log. This is hardening
   — the child is a binary this app spawns from a pinned registry or a user override — not an
   exposure.

### The fix

Assemble directly into a pre-sized body buffer. Keep a small, hard-bounded header accumulator.
**Not** a chunk queue.

State: `header: Buffer` (small, growable, capped), `headerLength: number`, `body: Buffer | null`,
`bodyFilled: number`.

- `push` with `body === null`: append the chunk into `header` at `headerLength`, then
  `header.indexOf(HEADER_SEPARATOR, …)` over the accumulated header only. The header region is
  contiguous by construction, so the separator can never straddle a boundary — the entire resumable
  scan cursor, its `max(0, scanned - 3)` resume rule and the off-by-one class it creates do not
  exist. On a hit: parse `Content-Length`, `body = Buffer.allocUnsafe(contentLength)`, copy the
  post-separator bytes in, and move any bytes past `bodyEnd` to the front of `header` with one
  `copyWithin`.
- `push` with `body !== null`: `chunk.copy(body, bodyFilled)` for the part that fits; on overshoot,
  copy the prefix, emit, and re-enter header mode with the remainder. No scanning mid-body.
- Emit `body.toString('utf8')` when `bodyFilled === contentLength`; consume, then reset.

Why this beats retaining chunks: identical asymptotics and effectively identical constant (one copy
per body byte either way; the chunk list's only edge is a one-chunk zero-copy path, priced at 1.5× on
a 0.001 ms case). It keeps today's copy semantics in `push`, which deletes the retained-chunk
ownership precondition — and that precondition is false on this runtime: Bun was measured handing two
consecutive stdout chunks as views into **one shared 64 KiB ArrayBuffer** (byteOffsets 0 and 36544),
so retention would pin slabs, not payloads, and a mutate-after-push hazard would be real. Peak memory
is exactly `contentLength + one chunk`, bounded _before_ any allocation, independent of chunk count.
The single `allocUnsafe` is the natural and only place a `contentLength` bound has to be checked.
Reaches nesting depth 2 with three small functions.

**Also fix the stranded frame:** separate "need more bytes" from "discarded a bad header block" in
`nextMessage`'s return so `drain` keeps going after a discard.

**Split the bounds policy into a second change.** A frame exceeding a cap must not throw from inside
`push`: the only place it can raise from is `stdout.on('data')` (`proxy-session.ts:418`), where a
throw is uncaught — `apps/server/src/index.ts:67` registers `unhandledRejection` only, with no
`uncaughtException` handler, so a misbehaving language server would kill the whole server process.
Land the copy fix, the `(message, byteLength)` callback and the wide-event fields first; take the
bounds and malformed-frame policy once `serverMaxMessageBytes` has produced evidence about what the
cap should be.

### Measured

Micro-benchmark importing the real `LspStdioMessageReader`, run under `bun`. Two runs each. The
copied-bytes row is the concat model above (514.0 + 4.0 MiB), counted on the same basis as the
prototype column — the harness separately reported 522.0 MiB by also counting the terminal
`toString('utf8')`, which the prototype pays too and which is therefore excluded from both.

| Case                           | Current              | Prototype        |                     |
| ------------------------------ | -------------------- | ---------------- | ------------------- |
| 4 MiB / 16 KiB chunks — wall   | 32.594 / 33.463 ms   | 1.104 / 0.877 ms | 29.5× / 38.2×       |
| 4 MiB / 16 KiB chunks — copied | 518.0 MiB            | 4.0 MiB          | 129.5×              |
| 1 MiB / 16 KiB chunks — wall   | 2.777 / 2.995 ms     | 0.125 / 0.161 ms | 22.3× / 18.6×       |
| 16 MiB / 64 KiB chunks — wall  | 130.817 / 162.572 ms | 2.984 / 4.003 ms | 43.8× / 40.6×       |
| 512 B / one chunk (×2000)      | 0.001 ms             | 0.001 ms         | 1.5×, no regression |

Correctness: 4,000 seeded differential fuzz cases (1–4 frames, 1–12 random cut points, bodies 2 B to
5 KB including UTF-8) — 0 mismatches against the real class. 14 hand-written edge cases — 12 exact
matches, 2 deliberate improvements (the malformed-header cases the current reader strands).

Re-run this harness against the implementation before quoting any of it as achieved.

### Observability

`stdio-rpc.ts` emits nothing on any path. The `lsp` area is well represented in `logs/` — 35,316
lines across nine files, including 10,467 `lsp.connection.acquired`, 4,991 `lsp.match` and 54
`lsp.session` — but **not one field describes framing**. The wide `lsp.session` event
(`proxy-session.ts:1443-1472`) carries `serverBytes`, `serverMessageCount`, `stderrBytes`,
`durationMs`, `outcome`: enough to see that bytes moved, and nothing about what it cost to move them.
(Those same 54 lines are where the 394,820 B maximum above comes from, so the area is not merely
present — it is the evidence this unit relies on.)

Add to that existing event: `serverChunkCount` (with `serverBytes` this yields mean chunk size, the
only way to see quadratic exposure from a log), `serverMaxMessageBytes` (the field that would name a
large response as the culprit), and `framingDiscardedBytes` / `framingMalformedCount` (non-zero is
the signature of the stranded-frame bug).

When the bounds policy lands, add `FRAME_TOO_LARGE` and `MALFORMED_FRAME` to the existing
`lspErrors` catalog at `apps/server/src/observability/structured-errors.ts:148` — the LSP feature has
no `structured-errors.ts` of its own and already imports from there. Never `new Error`.

### Coordination

Independent. `grep -rn "stdio-rpc\|Content-Length" plans/*.md` returns nothing. Plan 095 edits
`lsp/routes.ts` and `lsp/typescript/runtime.ts`, not this file. Plan 088 later extracts
`lsp/backend.ts` from `proxy-session.ts` (the sole consumer, `:353` and `:1281`), and inherits this
fix. Keep the `adapters/codex.ts:2112-2128` collateral separate — same bug class, different framing
(newline-delimited), different accumulator type (string).

---

## Unit 4 — Scope workspace-open ownership per client (F5)

**Verdict: confirmed, and the defect needed no clock skew to fire — it is in the repo's own logs.**

### Ground truth

`open-generation.ts:4` mints `Math.max(Date.now(), workspaceOpenGeneration + 1)` — a wall-clock value
from whatever machine the client runs on. `apps/server/src/fs/service.ts:128` holds **one
process-wide scalar** `latestWorkspaceOpenGeneration = 0`, and `claimWorkspaceOpen` (`:598-602`)
rejects any claim with `generation <= latest` with no notion of who sent it. There is exactly one
`FileSystemService` per server process (`app.ts:111`), so every window, tab, desktop shell and TUI on
that origin is compared against the same scalar. `supersededWorkspaceOpen()` (`:609-614`) returns
from two places: the initial claim (`:212`) and a re-check after `registerWorkspaceAddress` awaits
(`:215`), as HTTP 200 with `entry: undefined`.

`logs/2026-08-27.1.jsonl` contains six cross-instance supersedes. For example
`09:57:10.114 instance f1b7b05f generation 1787824630099 opened` immediately followed by
`09:57:10.116 instance 2eddc035 generation 1787824630093 superseded`, same path. Instance `5d3170c9`
was superseded three times in eight seconds while two others kept winning. **Every one is two
different `client.instanceId`s on one machine with a healthy clock**: the loser's `Date.now()` was
1–46 ms earlier but its request arrived 0–59 ms later. Jitter between minting the claim
(`open-root.ts:43`, after the reservation and before the fetch) and arrival is enough.

### Corrections to the finding

- **The headline scenario is derived, not recorded.** Nothing in the logs shows clock skew. The
  cross-machine case is reachable by construction under federated environments — a laptop client
  opening a root on a workstation's server turns a two-minute skew into a two-minute outage for the
  other machine's windows — but say so as a derived scenario.
- **Zero index displacement actually occurred.** `installWorkspaceIndexScope` early-returns when the
  absolute root is unchanged (`:619`), and every one of the six observed supersedes is on the
  identical path. Displacement needs two windows on _different_ roots. The log file does contain
  interleaved opens of two different roots between 18:13 and 18:24 (`2f0e4468` on
  `home/shaul/Projects/platform`, `ebd68474` on `work/projects/platform`; 441 opens on one root, 92 on
  the other) — but the lines carry no process id, so whether one `FileSystemService` served both is
  not provable from them either. Treat displacement as reachable by construction, not observed.
  When it does happen the loser's searches degrade to `fd`/`rg` with
  `fallbackReason: 'root-mismatch'` (`search.ts:530`) — slower, not wrong. The phrase "displace each
  other's workspace indexes" invites a reader to hear data corruption; it is a rebuild plus a new
  watcher plus a slower provider.
- **Treat the root-validation self-race as the primary defect.** `root-validation.ts:90` calls
  `openWorkspaceRootPath(path, claimWorkspaceOpenGeneration(), …)` for a mere **validation**. A real
  open that is mid-flight then fails the `:215` recheck and returns `superseded`, so the root never
  opens. That is reproducible with **one** client, and it is the cheapest thing here to fix.
- **A server-assigned token alone is insufficient.** One window can have two opens in flight at once
  (nothing aborts the older fetch — `open-root.ts:35-38`), so the client's own intent order has to
  survive network reordering. Per-owner monotonic sequencing is the right shape.

### The fix

1. **Move root validation off `POST /fs/workspace-root` — in this pass, not as an open question.**
   `registerWorkspaceAddress` already returns a full `WorkspaceRootEntry` (canonical path plus
   `workspaceAddress`) and already throws the same NOT_FOUND / NOT_A_DIRECTORY / INVALID_PATH errors
   that `root-validation.ts:14-19` keys its invalidation on. (`PATH_OUTSIDE_WORKSPACE` maps to
   `permission_denied` at `client-error-taxonomy.ts:48` and is deliberately **not** one of them — the
   comment at `root-validation.ts:14` is why: "Transient failures must not invalidate a retained
   workspace.") The only
   reason validation cannot use it is that `FileSystemService.registerWorkspaceAddress` (`:225-232`, narrowing at `:229`)
   narrows the result to `.workspaceAddress`. Widen that return and point `validateRootPath`
   (`root-validation.ts:82-99`) at it. Validation then claims no sequence, moves nobody's index, and
   can never be superseded. A handful of lines; it removes one of the two claim sites and the silent
   address-damage failure mode outright. **Do this first.**

2. **Put the ordering key in the request body, not a header**, and make it epoch-scoped.
   `openWorkspaceRootBodySchema` (`fs/contracts.ts:192-195`) becomes
   `{ claim: { epoch: string; sequence: number }, path }`. Both parts are minted in
   `open-generation.ts` so they share one reset boundary. The server keeps `Map<epoch, sequence>`:
   same epoch and `sequence <= last` loses; unknown epoch is accepted and recorded.

   Why the body beats a header: valibot and Eden make it a **compile error** at every call site,
   instead of ~12 runtime-only 400s with no future caller caught by `tsc`; it survives a client
   module reset, so there is no HMR/reload lockout; it needs no new `FsErrorCode`, no lifted header
   reader and no cross-feature move; and a client-supplied staleness token in the body is the idiom
   already used twice in this repo (`packages/contracts/src/settings/mutations.ts:272` `baseRevision`,
   `fs/contracts.ts:203` `baseVersion` on `writeBodySchema`). The server-minted epochs at
   `settings/store.ts:151` and `fs/workspace-edit.ts:140` are the **response**-side half of the same
   pattern, not request keys — do not cite them as precedent for the body field.
   `x-client-instance` stays what it is: log correlation and lease identity.

   **Bound the map.** Every client reload mints a fresh epoch and an unknown epoch is accepted, so
   `Map<epoch, sequence>` grows one entry per page load forever. Cap it with LRU eviction at a small
   fixed size (a server serves a handful of live windows, not thousands) and state the eviction
   consequence: an evicted epoch is treated as unknown, i.e. accepted — which is safe, because a
   client that has been idle long enough to be evicted has no in-flight open to reorder.

3. **Delete the clock** from `open-generation.ts`.

4. **Add `owner` and `supersededBy` to the wide event** (see Observability). Post-fix the field is
   `supersededBy: { owner, epoch, sequence }` — `generation` is the name of the value step 3 deletes,
   so it must not survive in the log vocabulary.

Steps 1–4 are independently shippable and remove every false supersede. **Step 5 — retiring the
index displacement — is the larger half and may be scoped out**; if it is, say so rather than
claiming displacement is fixed.

5. **Index scope per root, with one ownerless view preserved.** Add `indexForRoot(absoluteRoot)` for
   search. Do **not** make `info().workspaceIndex` owner-scoped: `/health` (`app.ts:272-283`) is the
   only ownerless observation point for the index — there is no `/fs/info` route, and
   `fetchServerInfo` hits `/health` (`file-server.ts:442-464`) — and nine assertions across six files
   depend on it, several becoming unwritable. Let `/health` report the live scopes as a list of
   `{root, readiness}`. Bound live scopes with LRU retirement and no settings key. Renew leases on
   **any** request from the owner — and note that `machines/service.ts:322-333` is the shape to
   _avoid_, not the precedent: `renewClient` is called only from `connect()` (`:56`) and the events
   subscription (`:166`, `:179`), and `:327` (`if (subscribing || this.events.hasClient(client))
return`) means that while the stream is open no expiry timer exists at all, so there the SSE stream
   **is** the sole keep-alive. That is exactly the failure mode to design out here, because
   `streamWorkspaceEvents`
   (`use-events.ts:817-836`) has no reconnect at all, so one dropped SSE stream would otherwise
   retire a live workspace's index for the rest of the session.

### Observability

The logs half-explain this — enough to confirm the defect from them, far too little for anyone to
notice it. Each `fs.open_workspace_root` event already carries `generation`, `openStatus`, `path`,
`scanRoot` and `client.instanceId` on both the server and client-ingested lines, which is why the six
supersedes were provable.

Missing, and part of the fix:

- **The rejection reason is absent from the rejected event.** A `superseded` line records the loser's
  generation but never the value or owner that beat it, so finding the race means sorting every open
  event in the file and diffing adjacent lines. Add `supersededBy: { owner, epoch, sequence }` and an
  explicit `owner` — `generation` is the value step 3 deletes and must not survive as a field name.
- **The level is wrong.** `openStatus: 'superseded'` is `info` with HTTP 200, indistinguishable from
  an expected same-window rapid switch. After the fix a cross-owner supersede is unreachable, so it
  should be `warn` when the loser's owner differs from the winner's.
- **No event for index displacement.** `installWorkspaceIndexScope` / `retireWorkspaceIndexScope`
  (`:617-640`) log nothing. Add `{ owner, previousRoot, nextRoot, reason }`.
- **Silent address damage leaves no trace.** `root-validation.ts:91` skips `confirm(entry)` on a
  superseded validation without a line. Add a `warn` — or, after item 1, delete the path.

### Tests

- `apps/server` — two owners interleaving opens: both succeed; a stale sequence from the _same_ epoch
  loses; an unknown epoch is accepted.
- `apps/server` — validation no longer claims a sequence and cannot supersede an in-flight open.
- `apps/web` (dom) — `features/workspace/tests/use-open-root.test.tsx:78`
  (`expect(results).toContainEqual({ path: 'a', result: 'superseded' })`, test at `:62-79`). Steps 1-4
  make a cross-owner supersede unreachable, so "keep it green" is **not** an option: the real choice is
  rewrite it to assert same-owner rapid-switch supersession, or delete it. Decide it in this unit; it
  is listed under Open decisions.
- `apps/server` — `/health` still reports the index ownerlessly.

### Coordination

This is the finding most likely to invalidate someone else's assumptions.

- **Plan 086 (IMPLEMENTED)** recorded the invariant this changes (`086:236`):
  "`features/workspace/state/{open-root,open-generation}.ts`. **Preserve owner capture and supersede
  checks.**" Its regression at `use-open-root.test.tsx:78` (test at `:62-79`) encodes the current `'superseded'`
  outcomes.
- **Plan 078 (IMPLEMENTED, live gates open)** states the ownership rule at `:119-122`: "An action
  captured on A stays owned by A after activation of B." The cross-client half of this finding is
  observable precisely in 078's still-open live browser/SSH gate. Fixing it first is correct, but the
  gate report must say the protocol changed.
- **Plan 094** edits `fs/service.ts:170-181` (the `ServerInfo.ok` decision) and `:660`. This unit
  edits `:128`, `:191-222`, `:225-232` (fix item 1 widens `registerWorkspaceAddress`'s return) and
  `:598-614`, shifting every later line. Note that
  `openWorkspaceRootObserved` returns `this.info().workspaceIndex` (`:218`, `:613`) — the same
  `info()` 094 is deciding about. Plan 094 item 8.1 also moves `ServerInfo` and
  `WorkspaceIndexStatus` into `packages/contracts/src/fs-info.ts`; either land that relocation first
  and change the shape once, or land this first and hand 094 the new shape. One must not be in flight
  while the other edits that region.
- **Plan 085** asserts the same principle at `:73` and its first milestone runs through this path.
- **Plan 098** retypes `openWorkspaceRootPath`'s `path` argument (`098:200`) while this changes the
  `generation` argument — adjacent lines in `file-server.ts:489-520`, trivially mergeable, but do
  not run both in one worktree.

---

## Unit 5 — Order provider commands by session, protect the checkout separately (F6)

**Verdict: confirmed and reproduced end to end. Effort L.**

### Ground truth

One global `SerialWorker` (`provider-command-reactor.ts:105`) receives every provider intent for
every session (`handleEvents` → `worker.enqueue`, `:119`), and `SerialWorker.run` processes strictly
one task at a time (`serial-worker.ts:54-57`). The only production path from a user's Stop to
`adapter.interruptTurn` runs through it (`:178` → `:406`).

Reproduced against a real engine, a real temp git checkout and a `MockProviderAdapter` subclass
parking session A's `startRuntime`: with session B live, Stop on B left
`adapter.interruptedSessions === []` while A was parked, and the adapter interrupt arrived only once
A's launch completed. Worse, the projection marks B's turn `interrupted` at commit time
(`projection-pipeline.ts:330-337`) — the repro printed
`{ turnState: "interrupted", runtimeStatus: "ready", adapterInterrupts: 0 }`. The committed
projection says the turn is interrupted while the provider has not been told.

It is not only interrupts: runtime stops (`:180`), checkpoint reverts (`:183`), approval responses
(`:186`) and user-input responses (`:189`) for every other session sit in the same queue.

### Corrections to the finding

- **The second anchor is mislabelled.** `:228` is `await this.beforeTurnStart?.(context.session.id)`
  — the worktree/checkpoint prerequisite wait, not provider startup. Provider startup is `:234`.
- **The longest hold is not the spawn.** Both real adapters self-bound `startRuntime` at 25–30s
  (`claude.ts:98,607`; `codex.ts:75-76,528`). The unbounded parts are
  `engine.turnPrerequisitesSettled` (`engine.ts:975-981`), which from inside the held queue awaits a
  **per-repository git lane** (`:978` → `repository-lane.ts:22-25`, FIFO behind any user commit) and
  then a **global** `checkpointReactor.drain()` (`:980`) covering every session's pending capture.
  Attribute the tens-of-seconds risk to those, not to the spawn.
- **"Worktree corruption" overstates it.** `GitCheckpointStore.capture` runs `add --all` against a
  _temporary_ index (`GIT_INDEX_FILE`, `checkpoint-store.ts:117-126`, with the comment at `:55-56`
  stating the user's real index is untouched), so it cannot corrupt the checkout. The real hazards are
  a torn checkpoint tree photographed mid-`restore`/`clean`, a capture erroring as files vanish under
  it, and a ref-bookkeeping race between capture's `update-ref` (`:135`) and revert's `deleteRefs`
  (`:522-525`). Say "torn snapshot / stale-or-lost checkpoint ref".
- **The capture-vs-revert overlap is already shipped.** Splitting the queue widens the window and
  newly permits revert-vs-revert on one worktree; it does not create the overlap. That distinction
  matters for how the regression test is written.
- **Do not quote a latency figure from the repro.** Its delay was the size of the artificial gate
  parked in session A's `startRuntime`, not a production measurement; the production hold is the union
  of the git lane wait and the global checkpoint drain, which has no measured ceiling.

The finding's "with separate worktree protections" clause is load-bearing, not garnish: splitting the
queue without it is what opens the revert-vs-revert window.

### The fix

**Write `checkpoint-revert-worktree-exclusion.test.ts` first, green against current HEAD.** It pins
the invariants the global queue is silently providing; without it, commit 1 has no way to prove it did
not open a window.

**Commit 1 — atomic, must not be split.**

- `KeyedSerialWorker` with per-`SessionId` intent lanes (`:73,105,119,131,145`). Interrupts deserve
  scrutiny: an interrupt for a running session must never wait behind any other session's work, so
  consider bypassing queueing entirely rather than queueing it per session.
- **Key the filesystem exclusion by the checkout, not the repository.** The invariant is "one whole-
  worktree file mutation at a time over this checkout" — `capture`'s `add --all`
  (`checkpoint-store.ts:126`) versus `restoreRef`'s `restore --worktree --staged` / `clean -fd` /
  `reset` (`git/service.ts:352-368`). Add `withWorktreeCheckoutLane(canonicalPath, action)` and wrap
  exactly those two. Do **not** promote `withGitRepositoryLane` to whole-operation scope: it is keyed
  by git _common dir_ (`repository-lane.ts:19`), so that would couple every sibling worktree of one
  repository for the duration of a `git add --all` — and `engine.ts:978`'s refresh, which gates every
  session's turn start, sits behind it.
- **Hold no lane across the revert's dispatch or its provider RPC.** Order: acquire lane →
  `restoreRef` → release; then `rollbackConversation` (`provider-service.ts:601-610`, unbounded
  adapter RPC) and `dispatch(session.revert.complete)` off-lane, preserving the deliberate
  prune-before-delete order at `:510-521`. `deleteRefs` needs no lane at all — refs are
  session-scoped and `staleRefs` comes from this session's own checkpoints (`:780-782`).
- Fold in `boundedProviderOperation` on `adapter.startRuntime` (`provider-service.ts:254`). It is
  not the only unwrapped adapter call — `sendTurn` (`:296`, `:372`), `interruptTurn` (`:441`, `:818`),
  `respondApproval` (`:487`), `respondUserInput` (`:509`), `rollbackSession` (`:609`) and
  `stopRuntime` (`:926`) are unwrapped too, against ten sites that do go through it — but it is the
  one that holds a turn-start lane while it waits. Both shipped adapters self-bound `startRuntime` at
  25-30s, so this is defence against a future or misbehaving adapter rather than a live hang; wrap it
  anyway, because a lane whose holder has no timeout of its own defeats per-session lanes.
- The new log fields, below.

**Commit 2 — after.** Delete the global drain coupling rather than re-keying it.
`beforeTurnStart` currently fires an event and then drains a global worker to wait for the task that
event produced. Give `CheckpointReactor` a direct `captureBaseline(sessionId): Promise<void>` that
`turnPrerequisitesSettled` awaits, and drop `session.turn-start-requested` from `taskForEvent`
(`checkpoint-reactor.ts:119-124`). One await, one caller, no drain, no lane key for the baseline path
— and it removes the reason to resolve the worktree inside `handleEvents`. Per CLAUDE.md's
optimization guidance this is the "delete the layer instead of speeding it up" answer: the plan should
not re-key a global drain that does not belong in the turn-start path. The event-driven path stays
only for `session.worktree-released` and `session.runtime-set`. Then key
`checkpoint-reactor.ts:91` by `WorktreeId`.

`provider-runtime-ingestion.ts:86` and `session-deletion-reactor.ts:40` are **candidates, not
instructions**: that ingestion (whose `seenEventIds` dedupe and buffer flush may rely on the global
order) and `runtimeEvents` are safe to key per session was never established. Establish it per site
before touching either, and leave them global if you cannot.

Until commit 2, interrupt latency is fixed but **start** latency stays coupled across sessions
through that global drain.

**Do not claim the other `SerialWorker` sites are the same defect.** Five exist
(`provider-command-reactor.ts:105`, `checkpoint-reactor.ts:91`, `provider-runtime-ingestion.ts:86`,
`session-deletion-reactor.ts:40`, `provider-service.ts:114`), but that ingestion (`seenEventIds` plus
buffer flush) and `runtimeEvents` are safe to key per session was **not** established. Verify each
before touching it.

### Observability

Across every retained file in `logs/*.jsonl` there are exactly 5
`chat.pipeline.provider_reactor.events_received` lines and zero `intent_enqueued`, `intent_start` or
`interrupt.start` lines — no real provider turn is captured in the retained window, so there is no
historical evidence of a defect that is reachable in normal two-session use.

The instrumentation that exists is structurally insufficient. `intent_enqueued` (`:116`) and
`intent_start` (`:170`) emit `orchestrationEventSummary`, which carries no queue state at all: seeing
a 20-second Stop would mean hand-joining two lines by `eventId` and subtracting timestamps, and even
then nothing names the session holding the lane. `ensure_session.start`/`.complete` carry no
`durationMs`, though `send_turn.complete` right next door does.

Add to the existing wide events:

- `intent_start`: `queueKey`, `queueDepth`, `queueWaitMs`. With these the defect is a single `jq`.
- `interrupt.start`: `queueWaitMs`, plus `blockedBySessionId` / `blockedByIntent` when the lane was
  occupied — the field that would have named session A.
- `provider_service.ensure_session.complete`: `durationMs`, matching `send_turn.complete`.
- `provider_reactor.turn_start.context` (`:214`): `prerequisitesMs`, split into worktree-refresh and
  checkpoint-drain, so the `engine.ts:978` and `:980` waits stop hiding inside one `await`.

Error conventions here are already correct — `createStructuredError` / `createInternalError` via
`observability/structured-errors`, with `serializableError` lifting `code`/`status`/`why`/`fix` onto
the log field. Nothing to change.

### Verification

```sh
cd apps/server && bun --bun vitest run src/orchestration/tests
bun run --cwd apps/server typecheck
```

`apps/server/vitest.config.ts` declares no `projects` and no `name`, so there is no `--project` flag
to pass here — that form belongs to `apps/web` only. Run the whole `src/orchestration/tests`
directory rather than a narrower selection: the drain and `isIdle` changes are exactly what a
narrower check misses.

### Coordination

Nothing in `plans/` owns this reactor's scheduling. Plan 091 edits the same file's bottom-of-file
helpers (`provider-command-reactor.ts:841-849` per `091:57,242,257`; those anchors have already
drifted — HEAD has 844 and 848). Content overlap is nil. Plan 095 owns the five
listener→generator bridges (`settings/store.ts:306`, `machines/events.ts:20`,
`orchestration/streams.ts:157`, `provider/provider-adapter-registry.ts:687`, `fs/watch.ts:509`) —
this unit touches none of them, and should say so explicitly if it collapses any settle loop.

---

## Unit 6 — Keep attachment bytes out of TUI draft rows (F7)

**Verdict: confirmed, and the 400 MiB figure is exact.**

### Ground truth

`write()` (`drafts.ts:75`) does `storage.setItem(key, JSON.stringify(draft))` — the whole draft,
attachment base64 included, since `attachments: chatAttachmentUploadsSchema` (`:21`) carries
`dataUrl`, produced at `attachments.ts:55` as `data:<mime>;base64,<…>`. `files.ts:84` `setItem` is a
synchronous SQLite UPSERT into a `TEXT` column, and `validateItem` (`:111-113`) is a no-op for draft
keys.

**There is no debounce.** `composer.tsx:161-168` `onContentChange` → `queueMicrotask(publish)` →
`stage.tsx:499` `onChange` → `update` (`:134-146`) → `write`. `queueMicrotask` drains before the next
event-loop turn, so it coalesces nothing across keystrokes: one full write per keypress.

Arithmetic, measured: `MAX_CHAT_ATTACHMENT_BYTES` = 10 MiB (`chat-model.ts:42`) → base64 is
`4 × ceil(10485760/3) = 13,981,016` chars, plus the 22-char `data:image/png;base64,` prefix =
13,981,038 chars = **13.333 MiB** per attachment. (`JSON.stringify` adds two quote chars; the base64
alphabet needs no escaping, so there is no second inflation, and the draft spread copies an array
reference, not bytes.) The schema ceiling `MAX_CHAT_ATTACHMENT_DATA_URL_LENGTH` = 13,981,080 passes
by 42 chars. **30 edits × 1 attachment = 400.0 MiB exactly.**

Measured on real `bun:sqlite` with the same PRAGMAs and schema, per keystroke:

| Attachments | Payload    | stringify | SQLite | Total        |
| ----------- | ---------- | --------- | ------ | ------------ |
| 0           | 0 MiB      | 0.0       | 0.0    | 0.0 ms       |
| 1           | 13.33 MiB  | 1.1       | 12.7   | **13.8 ms**  |
| 2           | 26.67 MiB  | 7.7       | 21.8   | 29.5 ms      |
| 4           | 53.33 MiB  | 7.7       | 54.6   | 62.2 ms      |
| 8           | 106.67 MiB | 37.2      | 107.4  | **144.5 ms** |

Linear in attachment bytes overall and dominated by the SQLite write, all of it synchronous on the
render thread. Two caveats on the table itself: the stage columns were sampled separately, so they do
not sum exactly to the totals (7.7 + 54.6 against a printed 62.2; 37.2 + 107.4 against 144.5), and the
identical 7.7 ms stringify reading at both 2 and 4 attachments is inconsistent with linearity and is
probably one noisy sample. Re-measure before quoting per-stage numbers; the totals and the byte
volumes are the load-bearing figures. 30 edits
with one attachment: ~414 ms total (30 x 13.8 ms) against ~2 ms for the attachment-free baseline.

One send costs a further ~29 ms of redundant full-payload work (`getItem` 5.3, `JSON.parse` 1.6,
`isDeepStrictEqual` 1.0, `retain()` 9.5, `remember()` 11.7).

**Neither `agent.history:` nor `agent.stash:` is capped.** `agent.history:` is never pruned at all;
`agent.stash:` is pruned only for the single newest row `pop` restores (`drafts.ts:184,189`), leaving
every older stash row unreachable and permanent. Every sent prompt's base64 therefore stays on disk:
a 20-send run left **413.3 MiB** of TEXT in the `state` table — which is 31 x 13.333 MiB, not 20, once
the live draft row, the retained `agent.pending:` command and the stash copies are counted alongside
the 20 history rows. Re-derive that breakdown against the implementation before quoting the figure.

### Corrections to the finding

- **"Visibly frozen TUI on every keypress" is overstated for the case the finding is about.** 13.8 ms
  is roughly one frame — a perceptible hitch and an ~11% duty cycle at 8 chars/sec — not a freeze.
  "Frozen" is fair only at 4–8 attachments (62–145 ms).
- **The 8-attachment worst case (3.13 GiB over 30 edits) is real but is a ceiling-of-the-ceiling.**
  `MAX_CHAT_ATTACHMENTS` = 8 is enforced in three places and reachable, but it needs eight deliberate
  attaches near the per-file cap. The honest framing: 13.33 MiB per write per attachment, linear in
  attachment bytes, 106.67 MiB as the schema-permitted maximum.
- **The "~34,000× reduction" is a projection from an unwritten implementation.** Carry the caveat
  wherever the number appears, and re-run the harness against the implementation before claiming it.
- **The two justifications offered for a content-addressed blob store do not hold.** `apps/web` did
  not build one — it stopped persisting image bytes at all ("image bytes stay in memory only and
  stored attachments are not restored", `draft-storage.ts:27-32`). And the server's store is
  **id**-addressed, not content-addressed (`attachments/store.ts:173-177`), with `chat-model.ts:123-136`
  stating explicitly that "`id` and `mimeType` already decide the blob's name on disk, so a persisted
  second copy could only ever go stale" — which is exactly what a `blobHash` field would be.

### The fix

**Tier 1 — do what `apps/web` actually did, then stop.** `draftSchema.attachments` becomes plain
`chatAttachmentsSchema` (`chat-model.ts:87`). Zero new fields: no hash, no regex, no filesystem, no
blob store, no sweep, no crash-ordering rule, no cross-process or cross-environment hazard. The bytes
live in a per-process `Map<string, { mimeType: string; bytes: Uint8Array }>` keyed by
`attachment.id`, created inside `createDrafts` (or a sibling `agent-stage/state/attachment-bytes.ts`)
and dropped when the process exits.

`attachmentFromBytes` stays **synchronous**, so `stage.tsx:157,192,558` keep their shapes, and
`use-stage.ts:145` reads the map synchronously so `send()` stays synchronous. That last point is
load-bearing: inserting an `await readBlob()` into `send()` would move the only synchronous
reentrancy guard (`inFlight.current = true`, `use-stage.ts:170`) behind an await, and double-Enter
would dispatch two turns.

Row size drops from 13.33 MiB to ~200 B per attachment — the same win, for roughly a third of the
diff. The cost is that a restart loses the image and keeps the text: exactly the tradeoff `apps/web`
shipped and documented, and a TUI restart is rarer than a browser refresh.

**Tier 2 — only if losing the image across a restart is judged unacceptable.** Go to disk, but
address the blob the way this repo already does:
`<storageDirectory>/blobs/<environmentId>/<attachment.id><ext>` with `ext` from
`chatAttachmentExtension` (`chat-model.ts:116-121`). Per-environment (a shared `blobs/<sha>` tree
plus a single-environment sweep would let a TUI on env A delete env B's attachments), derived
entirely from fields the draft already holds, so still zero new schema fields and no sha256 pass.
Delete eagerly by id at the four points that drop an attachment (`clearContent`,
`chat.clearAttachments` `stage.tsx:201`, inbox removal `inbox.tsx:40`, history/stash trim). Make the
startup sweep conservative: read only the four exact draft-owned prefixes — `agent.draft:`,
`agent.pending:`, `agent.history:` and `agent.stash:` (confirm each against `drafts.ts` before
writing the sweep) — never `storage.keys('agent.')`, which also returns rail and inbox rows.
`v.safeParse` each row and skip what does not parse (`storage.keys('agent.')` feeds non-draft rows to a `parseDraft` that throws, turning
one bad row into a launch failure), and unlink only files older than a grace window — mark-and-sweep
with SQLite rows as sole truth is sound only single-process, and
`apps/tui/src/storage/tests/files.test.ts:15,41` exists specifically because two TUI processes share
one file. Mirror `apps/server/src/attachments/store.ts:139-155` for the ENOENT-tolerant unlink and
`:84-99` for read-returns-null.

**Both tiers also need, as correctness work rather than polish:**

- **Decide what happens to the bytes in the retained command.** `retain()` stores the _command_, and
  `command.message.attachments` is `chatAttachmentUploadsSchema`
  (`packages/contracts/src/orchestration-commands.ts:248`), so the send path stays O(attachment bytes)
  regardless. The claim that `retain`/`pending`/`discardPending` "become trivially cheap as a side
  effect" is false. Either rehydrate at resume from metadata plus the byte source, or accept the
  13.33 MiB pending write and say so.
- **Cap `agent.history:` and `agent.stash:`** with a monotonic key, and invalidate `historyCursors`
  in the same commit.
- **Re-check the empty-prompt guard** (`use-stage.ts:135`) after any attachment drop.

**Skip the debounce.** Once the bytes are gone the measured write is ~0.1 ms, which needs no
coalescing, and a 300 ms debounce is where most of the risk lives: it defeats the deliberate
cross-owner compare-and-swap in `clearContent` (`drafts.ts:158-166`), breaks `takeInbox`'s and
`pop`'s write-then-delete ordering, and breaks three existing durability assertions — for a saving
that no longer matters. If coalescing is wanted later, land it alone with a dirty-key set (not a bare
`Debouncer`, whose last-args semantics drop other keys) and a flush wired into
`apps/tui/src/host/interactive.tsx` before `session.dispose()`, because dispose closes the database
(`session.ts:211`). The uncapped `promptElementSchema.text` / `terminalContextSchema.text`
(`agent-stage/utils/prompt.ts:9,15`) is a real but separate size-cap question — a `v.maxLength` is the
honest one-line fix.

### Greenfield state deletion

**The convenient assumption here is false, and the unit must not rest on it.** An earlier draft said
existing rows fail validation and `parseDraft` (`drafts.ts:201-211`) throws, making the bad state
self-announcing. It does not: `chatAttachmentSchema` is a plain `v.object`
(`packages/contracts/src/chat-model.ts:51`), and `v.object` **ignores unknown entries**, so a stored
row's `dataUrl` is silently stripped and the tier-1 shape — a strict subset — parses cleanly. The
precedent this unit cites says so in as many words at `draft-storage.ts:31-32`: "`v.object` ignores
unknown entries, so drafts written by the old schema still parse — their `images` array is stripped
instead of rehydrated."

So the real post-change state is an attachment whose metadata survives and whose bytes are absent from
the new per-process `Map`. **Specify that miss.** The honest behaviour, and the one `apps/web` already
ships: on a map miss, drop the attachment from the restored draft and keep the text. That means
`attachmentFromBytes`'s consumers must tolerate a metadata-only row at `use-stage.ts:145` and at
`stage.tsx:157,192,558`, and the empty-prompt guard (`use-stage.ts:135`) must be re-evaluated after
the drop — which is the same re-check item (c) already calls for. Never send an attachment whose bytes
are missing.

Greenfield still applies to the _policy_: write no healing or migration code, and no compatibility
shim for `dataUrl`. It just cannot be justified by a throw that will not happen. A developer who wants
a clean slate runs `rm ~/.platform/tui/*.sqlite*` (the directory holds only the per-environment SQLite
files plus WAL/SHM siblings); drafts, prompt history, stashes and recent commands are all viewer
convenience state.

### Observability

`files.ts` and `drafts.ts` emit **zero** events; there is no `area: 'storage'` event anywhere in
`logs/`. The only nearby instrumentation is `recordObservabilityWarning('tui.storage.read', …)` on
the read-corruption path. A developer complaining "the TUI stalls when I type" would find nothing.

Add one wide event at the single funnel, `files.ts:84 setItem`: `action: 'tui.storage.write'`,
`area: 'storage'`, `storageKey`, **`valueBytes`** (a 13,981,xxx-byte draft row is unmistakable),
`durationMs`. On the draft path enrich the same event rather than adding another: `attachmentCount`,
plus `blobBytes` / `blobsWritten` / `blobsReclaimed` if tier 2 is taken. Escalate to
`recordObservabilityWarning` above a threshold (say `valueBytes > 1 MiB`) so the pathological case
announces itself. Note the fixture at `apps/tui/test/fixtures.ts:50-70` filters on
`event.action === 'tui.storage.read'` and needs broadening.

Error conventions are already correct (`createTuiError` at `drafts.ts:87,180,205`; no `new Error`).
A missing-blob degradation should follow the server's precedent and return null with a warning rather
than construct an error.

### Coordination

Plan 094 owns the attachment-limit **policy** (`094:349-375`) and names this exact inflation at
`:362`; this unit owns the **persistence**. They collide in one function: 094 rewrites the limit
checks at `attachments.ts:18,37` while this rewrites `attachmentFromBytes`'s return at `:49-56`.
**Land this first** — it is the larger win (400 MiB → ~12 KiB projected, versus 094's 13.33 → 10 MiB
measured per write,
a 25% trim that leaves the O(edits × bytes) shape intact), it does not depend on 094's unresolved
open decision Q4.4, and it shrinks 094's surface to a wire-budget question at one call site. Plan 094
also folds `drafts.ts:197`'s `revision` into one observable store (`094:481-483`) and holds the open
`KeyValueStorage.updateItem` decision for `files.ts` (`094:36,55-56`) — do not pre-empt that port
decision.

Adjacent, not in scope: `drafts.ts` never adopted Plan 090's corrupt-read policy
(`docs/duplicate-defect-regressions.md:20`), unlike `inbox.ts:40-51`. Worth its own small change
reusing 090's `removeItemIfValue` plus `tui.storage.read` / `outcome: 'discarded'` shape rather than
inventing a second policy.

---

## Unit 7 — Bound the session snapshot's history collections (F8)

**Verdict: confirmed, anchors exact, and understated in four ways.** Argue the _plans_ half on
payload bytes and memory rather than CPU — its CPU cost is negligible for a structural reason. The
checkpoints half does have a real CPU cost, measured below.

### Ground truth

`snapshot-query.ts:226-227` puts `sessionCheckpointRows(sessionId)` and
`sessionProposedPlans(sessionId)` into the snapshot. Both (`:333-340`, `:342-352`) are
`select().from().where().orderBy().all()` with **no `.limit()`**, while messages and activities on the
same object go through `.limit(limit + 1)` at `:283` and `:311`.

Understated in four ways:

1. **Four unbounded checkpoint reads, not one.** `:333` also backs `sessionCheckpointIndex` (`:354`),
   which `fullReadModel` calls once per session at boot (`:100`) and `hydrateSession` calls on every
   revert or import (`:399`) — plus a fifth independent full scan in `checkpoint-diff-query.ts:75-82`
   on every turn-diff request.
2. **The payload is not paid only on open.** `command-sync.ts:34` refetches the whole detail snapshot
   after **every accepted command**, and client-core's `owner.ts:311-337` does the same for the TUI.
   A long session re-ships every checkpoint on every message sent.
3. **The client throws most of it away on arrival.** `writers.ts:1420` slices plans to 200 and
   `:1432` slices checkpoints to 500, _after_ valibot parsing and a deep clone of the whole thing.
4. **The doc comment at `:211-216` is false as written** — "opening a 5,000 message session has to
   cost the same as opening a 5 message one" — and that is what hides the defect from a reader.

**This is a scaling defect, not an observed one.** The real dev database holds 51 sessions, 4
checkpoint rows, 0 proposed plans, max 31 messages per session, and `logs/` has zero
`orchestration.session_detail_snapshot` events in ten days. The design point is set by the repo's own
constants: `CHAT_MESSAGE_CACHE_LIMIT` and `MAX_SESSION_MESSAGES` are both 2,000, so sessions of ~1,000
turns are contemplated.

### Measured, with corrections

Harness seeded from row shapes in the real dev database (147 B per `files_json` entry with real repo
paths and refs), replicating the real DDL and schemas.

**Wire bytes reproduce exactly** (checkpoints, server side): 50 turns × 8 files = 75 KB; 500 = 756 KB;
2,000 = 3.0 MB; 5,000 = 7.6 MB; 5,000 × 40 files = 30.6 MB. With a newest-20 window on the same
5,000-turn data: 30 KB (8 files) and 125 KB (40 files) — **250× less wire**.

**Two CPU corrections:**

- **Plan CPU figures are ~3× too high and must be rewritten.** Measured: 200 plans × 12 KB at ~1.6 ms
  total against a claimed 4.5 ms; 1,000 × 4 KB at ~2.8 ms against 7.7 ms; 50 × 4 KB at ~0.16 ms
  against 0.6 ms. The reason is structural, not noise: `planMarkdown` is one opaque string under
  `trimmedNonEmptyStringSchema` (`chat-model.ts:273`), so valibot does one trim and one length check
  per plan regardless of markdown size — 1,000 plans validate in 0.24 ms. **The plans half of this
  finding must be argued on payload bytes and memory alone.** Plan wire bytes do reproduce (200 × 4 KB
  = 881 KB; newest-10 = 43 KB).
- **Checkpoint CPU figures are 12-38% generous, not a flat 20%.** Measured 5,000t × 8f = 18.1 ms
  server / 23.7 ms client against 24.9 / 26.6 (38% and 12%); 5,000t × 40f = 77.7 / 99.1 against
  92.4 / 118.1 (19% and 19%); 500t × 8f = 1.8 / 2.3 against 3.4 / 4.1. Quote the lower numbers, or a
  range — not a single correction factor.
- `normalizeEdenDates` is not the singular client hotspot: at 5,000t × 40f it is ~39.9 ms of ~99.1 ms
  and valibot is ~38.2 ms — essentially equal.
- The stall does not delay the optimistic echo. `scheduleSessionProjectionSyncAfterDispatch` is
  fire-and-forget from `onAccepted` (`chat-view.tsx:334-339`), so the message is already painted. The
  symptom, at the 5,000-turn scale this unit projects rather than observes, is a ~24 ms main-thread
  stall arriving shortly **after** the send — one or two dropped frames while the reply's first tokens
  stream — plus the same on stop (`:379`) and revert (`:413`). At the scale of the real dev database it
  is unmeasurable.
- Every logged connection is `origin: http://127.0.0.1:3301`, so today the payload is a loopback copy
  and the honest present cost is CPU on both sides. There is no compression anywhere in
  `apps/server/src`, and remote deployment is contemplated (commit `c1ac973f`), so wire volume is a
  real future cost — do not lead with megabytes as if they were network egress today.

### Why neither proposed variant is shippable

Both treat `checkpoints` and `proposedPlans` as read-only display data. They are not:

- The client's held checkpoint list is the **authority for revert pruning**.
  `applySessionRevertedEvent` derives `retainedTurnIds` from the held window (`writers.ts:1100-1112`
  plus `shouldRetainAfterRevert` `:1606-1611`) and prunes messages, activities and plans with it. With
  a 20-row window, a revert to any turn older than the window yields an **empty** retained set and
  blanks the entire transcript and `latestTurn` in every client that did not itself dispatch the
  revert.
- The held plan list is the **carrier for the `implementedAt` stamp**, which has no event
  (`plan-follow-up-provider.tsx:270-300`). The suggested merge primitive `prependUnheld`
  (`writers.ts:128-136`, called at `:103-104`) is held-wins, so for mutable rows it discards the incoming `implementedAt` and
  leaves the source session offering "Implement" forever.
- The held checkpoint list is the **source of the revert affordance** on every user message
  (`timeline-items.ts:751-769`).
- The held summary is what keeps the git pane out of a permanent skeleton
  (`tool-pane.tsx:166-171`, whose own comment says "No summary yet means the checkpoint has not
  streamed in — pending, not absent"). Changing `reconcileSessionDiffScope`
  (`session-diff-scope-storage.ts:141`) as proposed converts a silently-repointed pick into an
  infinite `LoadingState`.

And `writeSessionDetailState` **replaces** plans and checkpoints on every snapshot
(`writers.ts:638-640,665-666`), which a refetch-after-every-command turns into "page back, then send
a message, and the annotations you paged in are gone".

A floor-derived page window is also not a bound: `chatSessionEarlierPageInput`
(`selectors.ts:423-434`) sends no annotation cursor, so a lower-bound-only page re-ships the whole
session's annotations on page 1 — and adding a separate annotation limit makes annotations
_unreachable_ whenever a page spans more turns than the limit, the exact failure
`orchestration-snapshots.ts:101-109` says the anchor design exists to prevent.

### The fix

Three moves, smaller than either proposed variant.

1. **Snapshot: a fixed newest-N window.** `desc(checkpointTurnCount)` + `.limit()` + reverse at
   `:333-340`; `desc(createdAt), desc(planId)` + `.limit()` + reverse at `:342-352`.
2. **Pages carry annotations by MEMBERSHIP, not by timestamp.** A page returns exactly the
   checkpoints and plans whose `turnId` is in the set of turnIds of the rows that page returns, with
   no separate limit. Exact at page boundaries (no interval arithmetic, no checkpoint stranded
   between pages), cannot re-ship the whole session (each turn's annotations are delivered once, with
   its messages), needs no second cursor, and is genuinely derived — bounded by the page's turn count.
   Turn-less annotations (plans with `turnId: null`, `projection-pipeline.ts:1387`) ride on the
   snapshot only.
3. **Bound bytes, not rows.** Drop `files` from the checkpoint summary on the snapshot and the page;
   ship `fileCount`, `additions`, `deletions` instead, and fetch `files` per turn lazily. Only two
   consumers ever read `files` (`tool-pane.tsx:185`, `changed-files.tsx:46-48`) and both are
   user-initiated. This kills the unbounded per-checkpoint files array that neither proposed variant
   bounds, makes `files_json` a column no read path selects except the one rendering it, fixes
   `checkpoint-diff-query.ts:75-82` for free, and turns the 30 MB case into kilobytes with no
   windowing argument at all.

   Add **one** lazy read for the three legitimately session-wide questions:
   `GET /session-checkpoints?sessionId&beforeTurnCount&limit` returning
   `{checkpoints: orchestrationCheckpointSummarySchema[], hasEarlier}` off the existing
   `(session_id, checkpoint_turn_count)` index. It answers the TUI revert picker
   (`changed-files.tsx:49-54`) without a git spawn and without losing `+N −M` per file, answers the
   "files changed by this session" dialog with the stats it already renders, and turns
   `tool-pane.tsx:169`'s infinite skeleton into a real load. HTTP, not a WS method, for the reason
   `orchestration-ws.ts:27-30` already gives about large one-shot bodies.

   **Do not repoint the TUI at `/full-session-diff`** — that is a net regression. `GitFileDiff`
   (`contracts/git.ts:48-60`) carries full patch text, hunks and optional `oldText`/`newText` but no
   additions/deletions and no turn attribution, so the dialog would ship a _larger_ payload to render
   a smaller list, become async, and start failing with `REF_UNAVAILABLE`
   (`checkpoint-diff-query.ts:84-92`) where the projection-backed list could not.

**Two prerequisites, independent of which design wins:**

- `applySessionRevertedEvent` (`writers.ts:1095-1112`) must stop deriving `retainedTurnIds` from the
  held checkpoint list. The server already computes it (`projection-pipeline.ts:1330-1345`), so put it
  in the `session.reverted` payload.
- The client's annotation merge must be **incoming-wins-by-id** in the shape of
  `writers.ts:1025-1028`, never `prependUnheld`, with the `session.history-imported` case still
  replacing. `owner.ts:324-327` already has that predicate; the web path at
  `session-detail-subscriptions.ts:363` needs it too.

### Sequencing within the unit

Land the three server-only, strictly-better pieces first — the narrowed DESC-ordered read-model
checkpoint query, the diff-query aggregate plus point read, and the new wide-event fields at
`routes.ts:138-150` / `streams.ts:410-423` / `pipeline-logging.ts:41-49`. They have no contract
surface and no client coordination. Then the lazy route plus the snapshot cap. Then the page
membership fields — the page fields, the writers merge, the reconcile semantics and the TUI dialog are
one behavioural unit and splitting them ships the regression. Migration 16 (`plan_id` in the plans
index) goes with the plans window, following migration 15's shape verbatim.

### Observability

The instrument is miscalibrated in exactly the way CLAUDE.md's Debugging section names: all three wide
events describe only the half of the snapshot that is already bounded. `routes.ts:138-150` emits
`activityCount`, `activityWindowFull`, `messageCount`, `messageWindowFull`, `windowSize`,
`snapshotSequence`; `streams.ts:412-423` and the client's `chatSessionSnapshotSummary`
(`pipeline-logging.ts:41-49`) emit the two counts and the sequence, and **no** `*WindowFull` field at all —
those exist only on `routes.ts`'s event. A user reporting "sending a message in this old
session hangs" produces one event reading `messageCount: 200, messageWindowFull: true,
durationMs: 900` — an instrument asserting the payload is bounded while the unbounded half goes
unmeasured.

Add to those existing events: `checkpointCount`, `checkpointFileCount` (the summed `files.length` —
one 300-file turn is worth more than 300 one-file turns), `proposedPlanCount`, `proposedPlanBytes`,
and `checkpointWindowFull` / `planWindowFull` mirroring the existing `messageWindowFull` idiom so a
truncated annotation set is distinguishable from a short session. No new structured error: the only
failure mode is `orchestrationErrors.SESSION_NOT_FOUND` (`:223`, `:250`), already carrying
code/status/why/fix.

### Coordination

`snapshot-query.ts`, the orchestration contracts and the streams/routes wide events are claimed by no
plan — the server half is unowned. Two collisions on the client half. Plan 096 moves the
persisted-storage helpers in `session-diff-scope-storage.ts:58-119` and states at `:260` that
`reconcileSessionDiffScope` (`:132`) stays put; this rewrites that function's body — land the
reconcile fix as a small isolated commit and let 096 rebase (preferred; it is six lines and 096 is
large). Plan 097 owns `apps/web/src/features/chat/utils/checkpoint-diff-query.ts` (`097:227`), a
different file from the server's, so the point-read rewrite does not collide — but 097's drift check
diffs `apps/web`, `apps/tui` and `packages/client-core` wholesale (`097:406`), so the client-core
writers and TUI dialog edits should land before 097 starts or after it finishes, not during. Note
that 096's SSE route deletions do not remove `shellSnapshot`'s consumers: 096 keeps the engine
generators, with WS RPC as their live consumer (`096:97-98`).

---

## Unit 8 — Delete the dead lint surface; put one real benchmark in CI (F9b)

**Verdict: partially confirmed. The premise is true, the framing is wrong in a way that changes the
fix.** See "What this plan does not own" for the guard half.

### Ground truth

**ESLint is entirely dead code.** Five configs exist (`apps/web`, `apps/server`,
`packages/contracts`, `packages/observability`, `packages/ui`). Every workspace `lint` script is
exactly `oxlint .` (11 of them); root `lint` is `bun run --filter '*' lint`; `lefthook.yml` runs
`oxfmt` and `oxlint` only; CI runs `bun run lint`. No eslint invocation exists anywhere. ESLint _is_
installed, nested per-workspace with a binary in each `node_modules/.bin/`, and absent from the root
— ~125 lines of eslint config (142 counting `.prettierrc` and `.prettierignore`) plus five installed trees carried for nothing. 48 eslint-family entries in
`bun.lock`.

**Four corrections that change the work:**

1. **"Custom restrictions" is plural; there is exactly one.** `apps/server/eslint.config.js:22`'s
   `no-restricted-syntax` banning local `isRecord`. `apps/web`'s config has zero custom rules;
   contracts and observability are identical boilerplate and `packages/ui`'s is a copy of `apps/web`'s. Only the `apps/server` config can mislead
   anyone about a restriction; the other four mislead only about which linter runs.
2. **The `lib/` → `@/features/*` ban was never written in any config, eslint or oxlint.** `grep` for
   `no-restricted-imports|no-restricted-paths|no-barrel|import/no-|boundaries` across the repo returns
   zero hits outside prose. The rule exists only as CLAUDE.md text. **It was not lost when eslint went
   unused; it never reached any linter.** The fix is to author it — which is Plan 098 unit 3's job,
   not this one's.
3. **The one real eslint restriction would catch nothing even if eslint ran.** It is scoped to
   `apps/server`, which has **zero** local `isRecord` (the only near-hit is `isRecorded` at
   `db/migrations.ts:137`, a different function). Six real duplicates live in the workspaces the rule
   never covered. Note the fairer reading: `apps/server` imports the canonical guard everywhere it
   needs it, so the rule is most likely a ratchet added _after_ that workspace was cleaned, now
   vacuously satisfied — "ineffective because never extended" is defensible; "aimed at the wrong
   workspace" is not.
4. **The CI anchor is off.** `.github/workflows/ci.yml:40` is a comment about `format:check`; the Lint
   step is line 46.

**`no-restricted-syntax` does not exist in oxlint 1.70.0.** All 833 rule keys in
`node_modules/oxlint/configuration_schema.json` were enumerated: `no-restricted-exports`,
`-globals`, `-imports`, `-properties` and `typescript/no-restricted-types` are present;
`no-restricted-syntax` is absent, and a config naming it fails to parse
(`Rule 'no-restricted-syntax' not found in plugin 'eslint'`). It cannot be ported. An AST-selector ban
has no oxlint equivalent.

### The fix

1. **Delete the dead lint surface, and do not try to port it.** The five `eslint.config.js` files,
   their eslint / `@eslint/js` / `typescript-eslint` / `globals` / `eslint-plugin-*` devDependencies
   across five `package.json`s, and the stale `pnpm-lock.yaml`. Regenerate `bun.lock` in the same
   commit.

   **Keep every `eslint-disable` comment.** An earlier draft of this plan called them inert and told
   the implementer to delete them; that is wrong and would turn `bun run lint` red, which CI gates at
   `ci.yml:45-46`. Oxlint **honours** eslint-disable directives, and all twelve in the repo name rules
   oxlint actually enforces: six name `no-empty-pattern` (one of the 833 rules, active as `warn`),
   three name `oxc-react-compiler/refs` and `/immutability` (both `error` at `.oxlintrc.json:15,17`),
   and three name `react-hooks/*`, which oxlint reports as `react-hooks(exhaustive-deps)`. Verified by
   fixture: stripping the three directives from a copy of
   `apps/web/src/features/chat/components/messages-timeline.tsx` produces
   `error oxc-react-compiler(immutability)`, while the unmodified file is silent. `.oxlintrc.json:25`
   also sets `oxc-react-compiler/no-unused-directives` to `error`, so a directive that stops being
   needed fails the build on its own — the codebase already polices this better than a sweep would.

   Also delete `.prettierrc` and `.prettierignore`: prettier does not run, and `.prettierrc` actively
   **conflicts** with the real formatter (`.oxfmtrc.json`) — `singleQuote` false vs true, `printWidth`
   80 vs 100, `trailingComma` es5 vs all. A config that contradicts the formatter that does run is
   worse than no config.

2. **Deleting `apps/server/eslint.config.js` is a behaviour change, not cleanup — decide it
   explicitly.** `apps/server/src/lsp/registry.ts:103` declares
   `const eslintConfigMarkers = ['eslint.config.*', '.eslintrc*']` and `:268-281` uses it as the
   `eslint` language server's `adoptionMarkers`. Removing the file changes which language server the
   app adopts for diagnostics and formatting when `apps/server` is the workspace root. Record the
   decision — delete and accept the adoption change, or keep the file and wire ESLint into
   `apps/server`'s `lint` script — and gate on `apps/server/src/lsp/tests/registry.test.ts` (which
   writes its own fixture configs, so it is unaffected) and `lsp/tests/routes.test.ts:113`. **Do not
   let the removal sweep touch `lsp/registry.ts` or its tests**: they reference eslint as a language
   server the app supports in the _user's_ project, and a grep-driven deletion breaks
   `lsp/tests/{registry,eslint-server}.test.ts` and
   `apps/web/src/features/editor/tests/language-server-plugin.test.ts`.

3. **Preserve the dead rule's intent as a real cleanup instead — or hand it to Plan 091.** Six
   duplicate `isRecord` definitions have drifted into the workspaces the rule never covered:
   `packages/observability/src/sanitize.ts:69` and `scope.ts:136`,
   `packages/client-core/src/files/search-client.ts:316`,
   `packages/ui/src/components/resizable.tsx:167`,
   `apps/web/src/lib/file-open-intent/state/service.ts:1912`, and
   `apps/web/src/lib/tests/file-open-intent-service.test.ts:1449`, against canonical
   `packages/contracts/src/is-record.ts:1`.

   **Per CLAUDE.md's "diff their behaviour first" — and this is exactly the trap that paragraph warns
   about.** Five of the six are character-identical to the canonical
   `typeof value === 'object' && value !== null && !Array.isArray(value)`. The sixth,
   `packages/ui/src/components/resizable.tsx:167-171`, is **not**: it reads
   `if (!value) return false` and then `typeof value === 'object' && !Array.isArray(value)` — with
   **no `value !== null` check**. Its guard is load-bearing, not decorative: delete the `if (!value)`
   line and `isRecord(null)` returns `true`, because `typeof null === 'object'` and
   `!Array.isArray(null)`. It is equivalent to the canonical version only _because_ the guard is
   there. All six share the signature `(unknown) => value is Record<string, unknown>`, so a wrong
   merge typechecks — the six-`basename` hazard, in the flesh.

   **Plan 091 already owns this, and its design avoids the dependency rather than adding one.**
   `091:338-342` says the two observability copies "must **not** follow: that package declares only
   `evlog` … and must keep it that way. Collapse them into one private module inside observability" —
   a private `src/internal/is-record.ts` that both import. `091:344-347` then deliberately excludes
   `packages/ui/src/components/resizable.tsx:164` ("`packages/ui` has zero workspace dependencies"),
   assigning it to census item 9.2. So no package gains an `@workspace/contracts` dependency under the
   owning plan. Hand this to 091.

   **Drift correction for 091, and it is the dangerous kind.** `091:344-347` gives its reason for
   excluding the `packages/ui` copy as "it omits `!Array.isArray`". That is not what it omits —
   `resizable.tsx:167-171` has `!Array.isArray(value)`; what it lacks is `value !== null`, which the
   `if (!value) return false` line supplies. 091's conclusion is right and its second reason (zero
   workspace dependencies) holds, but the stated one is backwards, and a reader who "fixes" the named
   omission by adding an `!Array.isArray` that is already there would conclude the copy is now
   equivalent and merge it — dropping the null guard. Correct 091's sentence when this is handed over.

4. **Do not author `scripts/check-architecture.ts`.** Both rules proposed for it are red on main and
   there is no green subset. The barrel rule hits **two** live named-re-export barrels, not one:
   `apps/web/src/features/git/hooks/index.ts` (17 named re-exports, 4 importers, each taking one
   symbol) and `apps/server/src/observability/index.ts` (23 named symbols across six `export`
   statements, 42 importing files). Neither uses `export *`. The `isRecord`
   rule hits the six duplicates plus, if ported literally from the eslint selector
   (`VariableDeclarator[id.name="isRecord"]`), the canonical definition itself. An enforcement change
   that fails on unlisted violations is not landable — and that test must be applied consistently: it
   also rules out wiring `bun run unused:exports` (1,722 findings) and, until measured, `bun run
dupes`.

   Note for whenever a barrel rule _is_ authored: `oxc/no-barrel-file`'s only option is `threshold`
   over `export *` re-exports. At `threshold: 0` a file with `export * from './c'` is flagged; a file
   with only named re-exports is **not** — so both real barrels are invisible to it. A lint
   rule can ban _importing_ a barrel (`no-restricted-imports` with `group: ["@/features/*/hooks"]`;
   verified that `*` does not cross `/`, so `@/features/git/hooks` is flagged while
   `@/features/git/hooks/use-status` is allowed) but cannot ban a barrel file _existing_. The cheapest
   real fix for `git/hooks` is to delete the barrel and inline its four single-symbol imports. Ship
   any such rule **with** the refactors it demands, never with an exemption list.

   The dead-config class does have a root-cause tool: `knip` is already a devDependency with
   `unused:files` / `unused:exports` scripts and a `knip.json`, and nobody runs it. But it would
   **not** have caught this: `bun run unused:files` emits 365 paths, and the only `eslint.config.js`
   rows among them are the five _worktree_ copies that the missing `.claude/worktrees/**` ignore lets
   in. Knip's eslint plugin claims a real `eslint.config.js` as a config entry point in any workspace
   declaring `eslint`, which is all five — so the dead configs are invisible to it by design. Making
   it a gate is still the honest answer to
   "a config nobody runs rots", but it is its own change: it currently emits 40+ findings including
   legitimate entry points (`vitest.browser.config.ts`, every `*.browser.tsx`, `scripts/dev.ts`,
   `scripts/prod.ts`), and `knip.json` lacks a `.claude/worktrees/**` ignore — which is why 318 of the
   365 findings are worktree copies. Do not present it as a free win.

5. **Wire exactly one benchmark into CI, and be honest about why only one.**

   `apps/web/scripts/file-tree-prepared-input-benchmark.ts --gate` is the only suitable candidate.
   Verified: **3.6s wall**, pure in-process (no browser, no server, no sibling Editor checkout), and
   ratio-based thresholds that cancel out runner speed — `REMOUNT_SPEEDUP_GATE = 0.2`,
   `COLD_SLOWDOWN_GATE = 0.15`. It **passed with ~4× margin**: at 50k paths `remountSpeedup 0.764`
   and `coldSlowdown -0.109`; at 10k, `0.708` / `-0.073`. It has no `package.json` script today —
   add `bench:file-tree-prepared-input[:gate]`. Argue its CI-safety from that headroom and the
   four-second cost, not from scale-invariance: the two sides of its ratio measure different work, so
   absolute runner noise hits the small denominator disproportionately.

   Insert the step in the existing **`quality`** job between `.github/workflows/ci.yml:51`
   (`Check generated artifacts`) and the `Test` step at `:57`. It reuses the already-paid setup. A third job
   re-pays the whole composite setup: two git clones plus two `bun install --frozen-lockfile` plus two
   `bun run build` for `../Editor` and `../ghostty-webgpu`, **none of which is cached** — only
   `~/.bun/install/cache` and `~/.cache/ms-playwright` are.

   Why the others stay out:

   - **`editor-open:gate` is structurally impossible.** Its calibration `identity` includes
     `platformImplementationSha256`, a SHA-256 over all of `apps/web/src` plus `bun.lock` and
     `packages/*/src`, and `calibrationIdentitiesMatch` **throws** on a mismatch. Every PR touching
     `apps/web/src` invalidates it before a single measurement runs.
   - **`editor-typing:gate`** has only ~20–26% headroom (steady p95 23.90 ms, burst 21.90 ms against a
     30 ms ceiling) and `docs/native-bench-harness.md` records ~2× tail-latency inflation under
     sustained load.
   - **`editor-scroll:gate`** needs a live app and server and GPU-dependent Chromium flags. Its
     deterministic **count** thresholds (`maxCssHighlightRanges: 270`, `maxMeanRangesCount: 12`,
     `maxMeanSegmentsCount: 12`) are machine-independent and could be split out and gated later,
     leaving `maxMedianFrameMeanMs` reported-only. Second choice, not this pass.
   - **`workspace-search`** and **`pty-benchmark`** are smoke runs only: the former searches the repo
     itself so its output is not comparable across commits and its provider depends on `rg`/`fd`; the
     latter spawns real shells and its sub-0.02 ms echo medians are unusable as a shared-runner
     threshold. `chat-snapshot-benchmark.ts` is already self-asserting and free at 0.13s — worth a
     smoke run, never a timing gate.

   The one-line summary the plan should carry: **every timing threshold in this repo was calibrated on
   one developer machine and documents ~2× tail inflation under load; none survives a shared runner.**
   If timing numbers in CI are wanted at all, emit them as a build artifact for trend inspection and
   gate only on deterministic count and ratio metrics.

6. **Delete `lefthook.yml`'s commented-out editor-scroll bench gate and its TODO**, recording the
   won't-do reason: it needs a live web and API server, which is why it never moved.

7. **Close the `docs/settings-reference.md` gap** — small, and directly in unit 2's path.
   `scripts/generate-settings-reference.ts` (106 lines) has **no `--check` and no `--target`**; its
   tail only ever `writeFileSync`s to one hardcoded path. There is no root
   `settings:reference:check`, and `generated:check` does not mention it. So registering a setting and
   forgetting `bun run settings:reference` produces a stale reference that **nothing** catches — not
   CI, not `generated:check`, not lefthook — even though CLAUDE.md mandates running it. Mirror
   `scripts/generate-settings-schema.ts:118-135` (temp-write, read back, string compare,
   `process.exitCode = 1` with a "run `bun run settings:reference`" message), add the root script, and
   append it to the `generated:check` chain. The comparison must run on the full rendered body,
   because the generator interpolates `SCOPE_NOTES` into prose. All three artifacts currently agree at
   53 settings, so the risk is purely forward-looking. Cost is nil: `generated:check` is 1.44s.

### Observability

A rare case where the logging rule does not apply: the defect is entirely build-time, and its only
possible trace is CI job output, which correctly reported success because nothing ran.

Two conventions do apply to the new tooling. Any new script must use `createScriptError`
(`scripts/structured-errors.ts:12`, built on `defineErrorCatalog('scripts', …)`) and never
`new Error`. And the shape requirement: a checker must emit **one wide event per run carrying the
complete violation array**, not a narrow line per violation — `file-tree-prepared-input-benchmark.ts:113-138`
already models this, accumulating into a `failures` array and emitting a single
`FILE_TREE_PREPARED_INPUT_GATE_FAILED` line. The payoff is concrete beyond convention: a developer
fixing violations one CI round-trip at a time is the failure mode that gets a new gate disabled.

### Caution on auditing rule liveness

Never use `oxlint --print-config` as evidence. It omits JS-plugin rules entirely: it reports 131
active rules for `apps/web` with only two denies and shows **none** of the 16
`oxc-react-compiler/*` entries from `.oxlintrc.json:10-25` — yet those are enforced, proven by
fixture (`oxc-react-compiler(refs)` and `(set-state-in-render)` both fire, and a bogus `jsPlugins`
name hard-fails the run). Verify liveness with a deliberately-violating fixture.

### Coordination

No plan mentions `apps/server/eslint.config.js` or `.github/workflows/ci.yml` except
`plans/073:139`, which is about a desktop matrix. Independent of 091–098 on file ownership. Step 1
invalidates two CI caches and the editor-open calibration file — expect one slow CI run, and tell
anyone using `bench:editor-open:gate` locally to recalibrate.

---

## Open decisions for a human

1. **Unit 2 — does the growth-point ceiling land in this pass?** Without it the delivered property is
   "≤ budget, sampled at a switch or a close", and the finding's own scenario still sits at 80 MiB
   with two projects open. Either do it or stop claiming the 64 MiB ceiling binds.
2. **Unit 4 — is the index-displacement half (step 5) in scope?** Steps 1–4 remove every false
   supersede and are cheap. Step 5 is the larger half and touches `/health`'s contract.
3. **Unit 6 — tier 1 or tier 2?** Tier 1 loses the attachment image across a TUI restart, which is
   what `apps/web` already ships and documents. Tier 2 keeps it and costs a per-environment blob store
   with a conservative sweep.
4. **Unit 6 — what happens to the bytes in the retained `agent.pending:` command?** Rehydrate at
   resume, or accept one 13.33 MiB pending write and say so.
5. **Unit 8 — delete `apps/server/eslint.config.js` and accept the language-server adoption change,
   or keep the file and wire ESLint into that workspace's `lint` script?** Do not do both halves
   silently.
6. **Unit 8 — does the `isRecord` consolidation belong here or in Plan 091?** 091 already owns five of
   the six copies and has a design that adds no package dependency (a private module inside
   observability; `packages/ui` deliberately out of scope). Handing it to 091 is the recommendation;
   the decision is whether this plan carries the `packages/ui` null-guard note there or leaves it.
7. **Unit 2 — is `'code-theme'` a scalar widget, or do the two `editor.codeTheme.*` keys belong in
   `NON_SCALAR_SETTING_IDS`?** This is what `settings-mutations.test.ts:46` is already failing over,
   and unit 2 adds a registry key to the same assertion. One of the two must change; the plan does not
   choose, because the answer depends on whether those keys are meant to be settable through the scalar
   mutation path.
8. **Unit 1 — add an `'incomplete'` `SearchBufferStatus`, or reuse `'error'`?** Reusing `'error'` is
   what the unit recommends and costs nothing, at the price of the summary reading "Search failed ·
   Showing previous results" for a same-query re-run. Adding the status costs every
   `SearchBufferStatus` branch — seven production modules today (`buffer-status-state`, `summary`,
   `results-view`, `pending-or-empty`, `run-state`, `buffer-runner`, `buffer-state`) plus `use-replace`,
   `cachedSearchBufferStatus` and a cache-version bump. Not an implementer's call.
9. **Unit 5 — do interrupts bypass queueing entirely, or get a per-session lane?** The unit says
   "consider bypassing", which is not a decision, and it sits inside commit 1, which the unit says must
   not be split. Settle it before commit 1 starts.
10. **Unit 4 — rewrite or delete `use-open-root.test.tsx:78`?** Steps 1–4 make a cross-owner supersede
    unreachable, so that assertion cannot stay as written. Rewriting it to assert same-owner rapid-switch
    supersession preserves Plan 086's intent; deleting it is also defensible under the
    delete-obsolete-tests rule. Either way it must be deliberate, and Plan 078's still-open live gate
    report must record that the protocol changed.

## Pre-existing baseline facts to record before starting

1. `bun run test` is **red on clean main**: 25 files, 43 tests.
   `packages/contracts/src/tests/settings-mutations.test.ts:46` and `session-vocabulary.test.ts` fail
   deterministically; two TUI failures are plausibly environmental (`nvim`; the developer's real
   `~/.platform/settings.json` leaking in). Measured in the main checkout at `2f9528ac` — this
   worktree has no `node_modules`, so re-capture the baseline wherever the work is actually done.
2. `apps/web/test/integration/server-in-process.test.ts:5` imports the deleted
   `@/lib/workspace-search-client` and fails to resolve. Repointed in unit 1.
3. `.oxlintrc.json:4` uses the string form of `jsPlugins`; the object form needed by Plan 098's
   plugin sketch was verified to work in the same array.
4. `scripts/lint/` does not exist, and root `test:scripts` names exactly one file — so 098's "add this
   file to `test:scripts` unconditionally" is a required edit, not an automatic pickup.
5. `docs/settings-reference.md` has no `--check` and is covered by nothing. Closed in unit 8 item 7.
6. `PLAN.md` has **no** section mentioning Plan 097 or 098 (`grep -n "09[78]" PLAN.md` is empty),
   while `plans/097`'s tail says "Root scheduling remains in `PLAN.md`". A live dangling reference,
   noted here and left alone.
7. `plans/099-document-contributions.md` was created in the main checkout while this audit ran, so
   plan number 099 is taken.
8. Plan 091's anchors into `provider-command-reactor.ts` have already drifted: it cites 841/845/849;
   HEAD has 844 and 848.
