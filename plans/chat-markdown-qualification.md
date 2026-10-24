# Qualify tree-sitter Markdown for chat rendering

Status: Approved, requested 2026-10-14. This is the chat verification work package under
[Plan 176](176-markdown-parser.md), with parser extensions owned by
[Plan 189](189-tree-sitter-md-improvement.md). Root [PLAN.md](../PLAN.md) owns scheduling.
The parser's [semantic producer plan](https://github.com/ShaulLavo/tree-sitter-md/blob/main/plans/bubli-semantic-markdown.md)
and the [shared consumer plan](bubli-markdown-consumer.md) retain their existing ownership.

## Outcome

Earn the chat parser cutover with repeatable evidence that tree-sitter preserves the meaning,
appearance, interactions and responsiveness of our current remark chat renderer. Capture the
remark baseline before implementing the candidate. Keep both implementations in the test
harness until the cutover passes. The production app continues to use remark during qualification.

Completion requires zero unexplained semantic or visual differences in the selected chat
profile, passing streaming and interaction checks, and passing paired performance budgets.
A missing candidate, missing fixture, unsupported required feature or inconclusive measurement
cannot produce a ready verdict. Passing parser construct counts alone cannot qualify chat.

## Current code and reusable checks

Implementation update, 2026-10-14: the initial baseline harness is implemented. The
[qualification guide](../.internal/markdown-parser/qualification.md) describes the five runnable
commands, fixtures, browser checks, raster controls and benchmark evidence. It has 102 owned
completed cases, 56 package streaming cases, 32 browser streaming stories and 128 visual states.
The actual parser candidate and independent held-out evaluation remain unqualified. Q0–Q5 below
retain their full gates; this harness delivery alone does not complete those units.

Inspected Fregat `f03e65e7741646d6fe950b2b7405e4f5cd716aa1` and tree-sitter-md
`e2ae3f735f614b3b618b5de71fc41644a180b9e7`. No comparison benchmarks were run for this plan.

| Existing owner                 | Entry points and evidence                                                                                         | Reuse                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Remark session                 | `packages/markdown/src/utils/session.ts`, `processor.ts`, `heal.ts`, `hold.ts`                                    | Incremental settled blocks, tail healing, GFM, math and CJK plugins. This is the performance reference.                                |
| Safe rendering                 | `packages/markdown/src/utils/hast.ts`, `sanitize-schema.ts`, `components/markdown.tsx`                            | Sanitization, lazy HTML and KaTeX stages, component overrides and code-block rendering.                                                |
| Chat policy                    | `apps/web/src/features/chat/components/assistant-markdown.tsx` and its tests                                      | Agent text normalization, list indentation, workspace links/images, artifact cards, Mermaid and clipboard behavior.                    |
| Prefix equality                | `packages/markdown/src/utils/tests/session.test.ts`                                                               | Every character prefix of 19 documents compares incremental and fresh remark results. Extend the fixture matrix and test both engines. |
| Component and sanitizer checks | `packages/markdown/src/components/tests/markdown.test.tsx`, `utils/tests/hast.test.ts`                            | Stable settled DOM, incomplete fences, loaded extensions, safe URLs and namespaced fragments.                                          |
| Browser rendering              | Chat `message-bubble.browser.tsx` and `mermaid-fence.browser.tsx` tests                                           | Real layout, highlighting, diagrams, math, delayed fonts and disposal.                                                                 |
| Stream frames and chat state   | `scripts/agent/scenarios/stream-frames.ts`, `stream-ambiguous-tail.ts`, `stream-code-colour.ts`, `chat-scroll.ts` | Deterministic chunks, per-frame observations, scroll following and reader-held position.                                               |
| Performance evidence           | `bun run agent:browser trace`, `renders`, `caches`                                                                | Production-path traces, component work and cache/lifetime evidence.                                                                    |

The parser currently exports decorations, highlights, folds and injections, with GFM and
frontmatter options. It lacks the complete renderer-facing semantic result. Its recorded
676/676 gate compares normalized construct ranges; it excludes list tightness from the main
score and does not certify decoded text or resolved URLs and titles. The 0.1 release also
excludes math and CJK-specific flanking. Implement those required semantics before qualifying
their chat cases. Chat frontmatter follows remark's current interpretation of opening `---`.

## Build one comparison harness

Add test-only engine adapters that receive identical source, options and update schedules.
The baseline invokes the real incremental remark session and the actual chat plugin policy.
The candidate invokes the owned parser and its semantic API. It must not call remark to obtain
missing structure, or silently select the baseline for unsupported cases.

Compare at three boundaries: renderer-neutral semantics, sanitized rendered DOM, and the real
`AssistantMarkdown` message inside the chat timeline. Reuse the same fonts, styles, component
overrides, highlighter, diagram renderer and safe-render policy where those do not depend on the
parser. An adapter from parser semantics into that existing rendering boundary is acceptable.
Include its work and worker transfers in the measurements. This isolates parsing differences
while preserving the complete product-path test.

Do not force both parsers into identical private tree shapes. The comparison schema preserves
ordered nested blocks and inlines, decoded text, breaks, code whitespace, resolved URLs,
titles, alt text, list starts and tightness, tasks, table cells and alignment, HTML and extension
content, source correspondence and coverage. Compare source spans for the behaviors that use
them, separately from displayed content. Normalization may remove attribute order and map
generated namespaces consistently. It must preserve meaningful whitespace, numbering,
destinations, nesting and all columns.

Use pinned official expected output as an independent CommonMark and GFM oracle. Use the
current product renderer for chat policy and extension behavior. If remark disagrees with the
specification, report both results and adjudicate the minimal fixture. Record any intentional
product difference by fixture ID, field, expected behavior and reason. Broad mismatch allowances
and automatic baseline updates cannot pass qualification.

Place shared fixture manifests and schedules under `packages/markdown/test/fixtures/`.
Keep pure comparisons and benchmarks with that package. Keep real chat browser tests under
the chat feature's `tests/` and scenario orchestration under `scripts/agent/scenarios/`.
Do not create a second renderer, production parser selector or permanent preview service just
for testing. A `/dev` comparison tab may reuse the test adapters and actual message components.

## Freeze the corpus and profiles

Each fixture records an ID, exact source hash, provenance/license, split, profile, feature tags,
expected fields, source size and stream schedule. Derive runnable and passing denominators from
the manifest. Preserve unsupported and skipped rows with reasons.

| Set                  | Minimum scope                                                                                           | Purpose                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Official examples    | All pinned CommonMark 0.31.2 examples and the full applicable GFM examples                              | Semantic or canonical HTML correctness. Preserve section-level results and profile differences.    |
| Existing regressions | Pinned upstream 183-message chat corpus, 497-document snapshot and existing Fregat Markdown regressions | Known failures and real prose. These are development data, not independent evaluation.             |
| Curated chat cases   | At least 80 owned cases, covering every feature family below                                            | Product semantics, malformed input, interactions and adversarial boundaries.                       |
| Held-out messages    | At least 100 attributable owned or permissively licensed messages, selected before candidate tuning     | Independent completed-message and stream evaluation. Keep source hashes disjoint from development. |
| Generated workloads  | Fixed seeds and generators for normal and pathological shapes                                           | Scaling, fuzzing and resource bounds. Generated conformance data does not replace real messages.   |

The upstream corpus README documents that the owner authorized publication of the recovered
183-message corpus. Fetch the already-published assets at a pinned revision and verify their
hashes. Do not export production state again. Record corpus licensing/provenance in the manifest.
Freeze a complete final evaluation batch and the exact candidate revision before unblinding.
Any fix informed by that evaluation ends the batch's independent qualification status. Retain
the entire exposed batch as development regressions, then select and freeze a new complete
batch before evaluating the fixed candidate. Report every batch's original denominator and
failures. Never replace individual failures until the surviving set passes.

Cover prose, headings, nested emphasis and punctuation, entities and escapes, soft/hard breaks,
code spans, links and images with titles, late and duplicate reference definitions, ordered
starts other than one, tight/loose and nested lists, tasks, tables beyond 12 columns, escaped
pipes, empty cells, wide tables, fences with metadata and unknown languages, raw HTML, fragments,
math, footnotes, CJK, Hebrew/RTL, emoji, combining characters, ZWJ sequences, tabs, BOM and CRLF.
Include workspace chips/citations, local images, diagrams, artifact-card boundaries, enormous
single blocks and many short blocks. Footnotes must follow the actual enabled product profile;
reference parser support alone cannot establish that profile. Wiki links, callouts and highlights
remain Plan 189 scope and get explicit profiles when enabled in chat.

## Correctness and behavioral suites

| Suite                | Required observations                                                                                                                                           | Pass condition                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completed messages   | Semantic fields, canonical spec output, sanitized product DOM, visible text and source spans                                                                    | No unexplained differences. Missing fields fail before screenshot comparison.                                                                                                                 |
| Streaming prefixes   | Raw parsing and product tail policy, every split point in short cases, one-unit and seeded multi-chunk schedules                                                | Each engine's incremental result equals its fresh parse of the same prefix. Product prefixes match the agreed healed/held-tail policy. Final streamed output equals completed-message output. |
| Nonlocal changes     | Definitions added, removed or edited before/after their uses, option changes, source replacement and stream completion                                          | All affected earlier links update. Unaffected blocks retain appropriate DOM identity and state. Reclassification may legitimately replace a block.                                            |
| Browser interactions | Native selection and keyboard copy during appends, rich/plain clipboard, link activation, task state, scroll following, reader-held position and history reload | Copied payloads and actions remain correct. Selection survives unrelated appends. Reader-held scroll does not jump. Final content agrees after reload.                                        |
| Safe display         | Script/event HTML, dangerous and obfuscated URLs, DOM-clobbering IDs, fragment namespaces, model text resembling controls                                       | Same selected sanitization policy and safe activation behavior for both engines. No script execution or forged host controls.                                                                 |
| Async and lifetime   | Delayed HTML/math/fonts/images/highlighting, stale worker responses, replaced/disposed messages, sibling documents, repeated open/close                         | No stale publication, cross-message contamination, lost content or retained subscriptions. Settled fences keep their colors through completion.                                               |

Use at least 32 small development fixtures for exhaustive split points and the larger message
sets for eight seeded chunk schedules each. Exercise boundaries inside markers, destinations,
entities, CRLF and Unicode sequences. Test UTF-8 byte splits through the transport decoder, then
feed the actual decoded string updates to rendering. Keep arbitrary UTF-16 splits as a separate
adversarial API profile; do not label impossible transport sequences as normal traffic.

A live tail may differ from completed Markdown while syntax is incomplete. Document the
held-tail/healing policy and the syntax/reference dependencies that may change earlier output.
Do not require every prefix to equal the final message or ban every DOM replacement. Observe
loss of selection, unrelated remounts, painted raw syntax and color drops directly.

Fuzz delimiter/bracket stacks, nested containers, definitions, Unicode and edit/undo sequences.
Use bounded seeded runs in PRs and longer nightly runs. Minimize each failure into an owned
fixture with the seed, operation list and first failing prefix before fixing it.

## Visual tests

Build 32 representative visual stories from the tagged corpus. Capture baseline and candidate
at 390×844 and 1440×900, in light and dark themes. That is 128 paired Chromium states.
Run eight critical stories under all four profiles in WebKit as well. Add keyboard focus,
reduced motion, RTL, image failure, loaded math and wide-table horizontal scrolling to those stories.

Capture stable completed states and named streaming pauses before/after fences, links, list
markers, table separators and reference definitions. Record frame observations during transitions;
endpoint screenshots cannot detect a one-frame flash. Compare content, block bounds, wrapping,
list spacing, table geometry and overflow in addition to pixels. Assert nonempty expected text,
known links and required elements so two blank screenshots cannot pass.

Wait for fonts and the declared extension stage. Test delayed stages separately. Fix browser,
device scale, fonts, viewport, theme and fixtures. Calibrate a pixel tolerance from repeated
remark-versus-remark captures on that engine before comparing candidates. Limit any mask to
identified nondeterministic UI chrome. Never mask message content, tables, code, images or math.
Keep semantic and geometry assertions even when rasterization needs tolerance.

Produce a review page with source, baseline, candidate, pixel overlay and per-field differences,
plus a failure recording and replay command. Review every changed image. Publish one private
disposable preview when a remote visual review is needed, preserving its URL across revisions.
Browser-width emulation does not establish real iPhone selection or touch behavior. Run the
critical selection, copy and scrolling cases on an available iOS surface before mobile cutover;
report unavailable device coverage explicitly.

## Benchmarks

Measure the current incremental remark implementation, including its healing and host plugins.
Keep whole-document remark parsing as a labeled diagnostic, never the sole performance baseline.
Use production builds for browser results and record complete input/output coverage.

| Benchmark                   | Workload                                                                                       | Measurements                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold mount                  | Fresh realm/cache, first chat message with and without fences, HTML and math                   | Asset fetch/decode, WASM initialization, complete parse, projection, first meaningful and fully ready paint.                                 |
| Warm completed message      | 0.25, 2, 8, 32 and 128 KiB mixed prose                                                         | Parse, semantic projection, sanitization, React commit, layout/paint and end-to-end latency.                                                 |
| Streaming replay            | Same messages at 1, 8, 24, 64 and 256 UTF-16 units per update, plus pinned realistic schedules | Per-update p50/p95, total CPU and elapsed time, end-of-stream settlement and dropped/deferred updates.                                       |
| Pathological scaling        | 1 MiB mixed text, one paragraph, one fence, many references, deep lists, 32-column table       | Work versus source size, worst update, completed bytes and output equivalence. Expose whole-document invalidation and repeated-copy costs.   |
| Reference invalidation      | Early links with late definitions, definition edits and removals                               | Earlier-block update latency, projection work, DOM replacements and output correctness.                                                      |
| Highlighting and extensions | Same code-language/cache state, diagrams, HTML and math                                        | Separate parser, highlighter, loader and renderer costs. Also measure the combined message path.                                             |
| Timeline and input          | 1, 20, 100 and 500 messages, virtualized history, streaming while typing/selecting/scrolling   | Main-thread work, long tasks, frame delays, input-to-paint, follow/park drift and render counts.                                             |
| Resources                   | 20, 100 and 500 create/update/dispose cycles, simultaneous messages and worker replacement     | JS live heap, WASM reserved heap, worker count, buffers, peak use, reusable high-water plateau and cleanup.                                  |
| Payload                     | Fresh product build, cache-empty and runtime-already-loaded cases                              | Actual transferred host/grammar/resolver/JS bytes, lazy renderer assets and requests. Record payload without introducing a bundle-size gate. |

Run both engines on the same host, browser and source schedules. Alternate or randomize paired
order, separate cold and warm trials and reset caches symmetrically. Exclude fixture generation
from timing. Count coalesced updates explicitly and require the same visible-output deadlines;
the candidate cannot win by skipping content. Record commit/lockfile and WASM hashes, hardware,
runtime/browser versions, fonts, cache state, warmups, repetitions and all raw samples.

Measure prefix latency from update receipt until that revision finishes processing and the
first frame matches its expected product projection. Require a revision completion receipt so
an unchanged old frame cannot satisfy the measurement. An intentionally held marker may have
the same projection as its predecessor. Report those prefixes, their processing cost and hold
duration separately. Measure release latency from receipt of the chunk that resolves the held
syntax. Include held-prefix CPU and worker work in total stream cost. Do not wait for a visible
change that the agreed tail policy deliberately suppresses.

Use at least 20 independent paired trials for promotion, with warmup outside measured trials.
Report p50/p95 and total stream CPU per workload, with paired confidence intervals. Do not report
p99 from a handful of samples or average away the giant-block cases. Capture a trace for any
material regression before tuning it. Use `trace --compare` for product speed claims and
`renders` to locate repeated work; render counts alone cannot prove speed.

## Freeze promotion budgets before candidate tuning

Check the following initial product targets against the captured remark baseline in Q0.
Commit the selected workload-level budgets before candidate optimization. If baseline behavior
already misses a target, retain the failure and schedule its fix; do not loosen a target after
seeing candidate results. A later product-budget change needs a separate recorded decision.

| Gate                             | Initial target                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantics and interactions       | Zero unexplained differences in development and held-out sets. Zero lost selections, unsafe activations or incorrect clipboard payloads in required scenarios.                                                         |
| Visual behavior                  | Zero unexplained changed states after calibrated raster tolerance. Zero content flashes or settled fence color drops in required frame probes.                                                                         |
| Ordinary streaming, up to 32 KiB | p95 prefix-projection latency and held-syntax release latency ≤33.4 ms at the pinned 24-unit schedule. p95 main-thread work per update ≤8 ms. No attributable task over 50 ms in these ordinary fixtures.              |
| Paired latency                   | Candidate p95 update/settlement ≤ remark p95 ×1.10 +1 ms; mount ≤ remark p95 ×1.10 +5 ms. Check each workload, with the paired confidence bound within its budget.                                                     |
| Total stream work                | Candidate total CPU ≤ remark ×1.10 +5 ms per message. Include worker work and semantic transfer. Apply the gate to large/pathological workloads as well.                                                               |
| Resources                        | No persistent growth across repeated disposed-message batches after reachable caches plateau. Explain allocator reservation separately from live allocations; prove subsequent batches reuse the WASM high-water mark. |

Stress workloads still require exact output, finite bounded work and passing paired comparisons.
They do not inherit the ordinary one-frame target. On noisy CI, run correctness and smoke limits;
run promotion timing on an identified quiet host. A confidence interval crossing a budget is
inconclusive, not a pass. Keep unsupported required features visible as cutover blockers.

## Ordered implementation units

- [ ] **Q0: freeze the oracle and baseline.** Inventory exact plugin/profile behavior, capture
      current source/assets, define the manifest and comparison fields, select holdouts, and commit
      budgets. Run existing narrow Markdown tests and the relevant stream/scroll scenarios. Record
      current defects separately from candidate differences. Exit with reproducible reference receipts.
- [ ] **Q1: make the harness falsifiable.** Add adapters, corpus loader, semantic/safe-DOM
      comparison and machine-readable reports. Prove remark-versus-remark self-comparison works, then
      prove controls fail after removing a block, changing one destination, changing list numbering,
      truncating a table, retaining stale output or producing blank screenshots. A self-comparison
      validates the harness only. Full qualification must fail while the candidate API is absent.
- [ ] **Q2: connect the real candidate.** Implement the required semantic producer through its
      existing plan and chat adapter through Plan 176. Reuse the current renderer and host policy.
      Verify runtime provenance so the candidate never obtains parse structure from remark. Exit with
      completed-message semantics and required extensions passing before visual/performance tuning.
- [ ] **Q3: qualify streaming and state.** Add exhaustive and seeded prefix/edit suites, fuzz
      reducers and real browser selection/clipboard/scroll probes. Extend the existing deterministic
      provider fixture and frame samplers. Exit with prefix/final invariants and state checks passing.
- [ ] **Q4: capture visuals and paired performance.** Add the comparison gallery, visual story
      matrix and benchmark workloads. Validate negative controls, review images, investigate regressions
      with traces and run held-out evaluation. Exit with all selected promotion budgets passing.
- [ ] **Q5: install the gates and cut over.** Add bounded PR checks for changed Markdown/chat paths,
      nightly broad fuzz/visual/bench jobs and a release qualification report. Switch the actual chat
      path, rerun the real scenarios and preserve the test-only remark oracle. Delete production remark
      callers/dependencies only after remaining consumers have also migrated. Verify the served release
      through the repository's authorized delivery workflow.

Q0 and Q1 can land before the semantic API exists. Q2 depends on its producer work.
Q3–Q5 cannot be marked complete from parser-only evidence. Harness work and producer work can
use separate ownership boundaries, but one coordinator owns the complete qualification verdict.

## Commands, reports and cleanup

Existing checks are `bun run --cwd packages/markdown test`, the relevant app Vitest filters,
and `bun run agent:browser scenario|trace|renders <scenario>`. These do not yet run a cross-engine
chat comparison. Implement separate `markdown:parity`, `markdown:stream`, `markdown:visual`,
`markdown:bench` and `markdown:qualify` entry points during Q1–Q4. Those names are target commands,
not claims about current scripts. They accept fixture/profile/engine filters and an output directory.

Every qualification writes a manifest with exact revisions, executed/failed/skipped counts by
profile and suite, declared budgets, semantic differences, paired samples, traces, screenshots,
recordings, minimized failures and reproduction commands. An overall verdict is VERIFIED,
NOT VERIFIED or INCONCLUSIVE. A partial baseline-only report cannot be VERIFIED for cutover.
Keep decision rows beside the report. Publish the small report and replay fixtures as CI artifacts;
keep implementation ordering and open work in this plan.

Committed harnesses run from fresh clones without local reference clones, live provider accounts,
absolute machine paths or private state. Record pre-existing resources before setup and install
teardown before starting servers, browsers or fixtures. Reuse isolated fixture/provider helpers.
Release fixture workspaces, stop task-created servers/workers and remove temporary profiles and
copied builds on success, failure, interruption and timeout. Verify cleanup on the execution host.
Retain only the report, required replay fixtures and an explicitly owned disposable review app.
