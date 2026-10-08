# Collaborative editing: placement and portable tests

Research date: 2026-10-08. Verification is source inspection, not execution.

## Source pins and citation convention

All file references below use these exact commits. A reference such as `L:crates/loro-internal/tests/fugue.rs:5–89` means that file and line range at the recorded Loro commit.

| Key | Repository                                                                                                      | Inspected commit                           | Local checkout             |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------- |
| L   | [loro-dev/loro](https://github.com/loro-dev/loro/tree/c00c9fa501f8d32f68d6255eacb7035a67fb6ab6)                 | `c00c9fa501f8d32f68d6255eacb7035a67fb6ab6` | `references/loro`          |
| Y   | [yjs/yjs](https://github.com/yjs/yjs/tree/d01eefc997cf12d29d5aabea804df5f69c659a79)                             | `d01eefc997cf12d29d5aabea804df5f69c659a79` | `references/yjs`           |
| D   | [josephg/diamond-types](https://github.com/josephg/diamond-types/tree/89ae3a0ab8d941a2885e6ec89d094bc9ce9d2922) | `89ae3a0ab8d941a2885e6ec89d094bc9ce9d2922` | `references/diamond-types` |
| F   | [mweidner037/fugue](https://github.com/mweidner037/fugue/tree/31e74fea67f23add13a5d10f781c0d78edcd14da)         | `31e74fea67f23add13a5d10f781c0d78edcd14da` | `references/fugue`         |

The Fugue repository is the paper’s reference implementation and benchmark repository, not `list-positions`. Its README identifies the implementations and paper explicitly. `F:README.md:1–3,29–43`.

Two additional primary sources:

- [Weidner, Text Without CRDTs](https://mattweidner.com/2025/05/21/text-without-crdts.html), particularly “Main Idea,” “Concurrent Insertions,” “Some Corrections,” “Client Side,” and “Decentralized Variants.”
- [Weidner and Kleppmann, The Art of the Fugue](https://arxiv.org/html/2305.00583), particularly Algorithm 1, Table I, §V-A–C, Definition 4, Lemma 5, Definition 6, and Theorems 9–10.

**Inventory limitation:** this is a source-backed inventory of relevant test families and named high-value cases, not a completed case-by-case transcription of every mixed-container test in Loro. The compressed Diamond Types `test_data/conformance.json.br` was located but not decoded; its individual cases remain unconfirmed. These limitations should remain visible in the final report.

## 1. Algorithms

### 1.1 Weidner’s host-ordered “insert after X”

An insertion carries a newly generated stable character ID and the ID of its predecessor. The host inserts it **immediately after that predecessor**, looking up the predecessor among both live characters and tombstones. Deletion marks a specific ID deleted.

Consequences:

- Insertions with the same predecessor appear in **reverse host-arrival order**.
- Forward typing creates a chain: each new character names the preceding newly typed character. Independent forward-typed runs stay together.
- Backward typing repeatedly names the same predecessor. Interleaved arrivals of two backward-typed runs can interleave the resulting text.
- Clients reconcile optimistic edits by undoing pending operations, applying host operations, then replaying pending operations.

These are the article’s stated algorithm and behavior, not inferred CRDT properties. [Weidner article, sections listed above](https://mattweidner.com/2025/05/21/text-without-crdts.html).

This protocol does not promise that two different host-arrival orders produce identical text. It promises that clients consuming the same authoritative order reconcile to the same result. That distinction must survive the test-porting work.

### 1.2 RGA

For the conventional RGA/Causal Trees formulation discussed in Weidner’s article:

- An insertion records its left origin/predecessor.
- Conceptually, insertions form a predecessor tree.
- Same-parent children are ordered by **descending Lamport timestamp**, with a deterministic replica-ID tie-break.
- The sequence follows a depth-first traversal; deletion retains ordering structure.

Weidner explicitly explains the connection between reverse Lamport sibling order and reverse-order insertion in his “Decentralized Variants” section. The Fugue paper’s Table I distinguishes RGA’s proven forward non-interleaving from its backward-interleaving failures. [Article](https://mattweidner.com/2025/05/21/text-without-crdts.html); [paper, Table I and §III](https://arxiv.org/html/2305.00583).

**Illustrative derivation, not an executed upstream test:** A types `b`, then prepends `a`, so both have the start sentinel as left origin. B independently inserts `x` at start. If reverse timestamp/replica order places the siblings `a`, `x`, `b`, the merge is `axb`, splitting A’s backward-typed `ab`.

RGA’s counterclockwise/descending timestamp convention is not Fugue’s ascending ID sibling convention. A Lamport field does not justify substituting one for the other.

### 1.3 YATA as implemented by Yjs

Yjs items retain:

- immutable `origin`, identifying the insertion’s original left boundary;
- immutable `rightOrigin`, identifying its original right boundary;
- mutable linked-list `left` and `right` pointers;
- an ID containing client and clock.

These are distinct kinds of metadata: origin IDs are not merely the current list neighbors.

In `Item.integrate`, Yjs scans the conflict interval between the origin boundaries. Its `conflictingItems` and `itemsBeforeOrigin` sets keep track of ancestry/conflicts:

1. With equal left origins, smaller client IDs are passed first.
2. If the right origins also match and the existing item’s client would follow the new one, scanning stops.
3. With different left origins, the scan checks whether the existing item’s origin is among previously scanned items and whether it remains in the conflicting subset.
4. Other cases end the scan.

The implementation is therefore **not** “sort every character by `(leftOrigin, rightOrigin, clientID)`.” Descendant runs and the interval scan matter. `Y:src/structs/Item.js:168–235`.

Yjs splits blocks while preserving the original right boundary. The split tail’s left origin becomes the immediately preceding ID in the block. `Y:src/structs/Item.js:402–425`.

The paper reports:

- forward non-interleaving;
- no single-replica backward counterexample found;
- a multi-replica backward-interleaving counterexample.

The checked Fugue repository includes that counterexample:

1. Replica 3 inserts `b`.
2. Replica 1 sees `b` and inserts `a` before it.
3. Replica 2 independently inserts `x`.
4. The script documents the merged result as **`axb`**.

`F:yjs-interleave/index.js:3–20`; `F:README.md:41–43`; [paper, Table I](https://arxiv.org/html/2305.00583).

**Version qualification:** the reproducer documents the paper-era Yjs behavior. I did not execute it against the newly cloned Yjs HEAD. Treat its behavior on this HEAD as unconfirmed.

### 1.4 Fugue

Fugue maintains a tree with multiple left and right children per node.

Each node has:

- a unique ID;
- a value or deletion marker;
- a parent;
- a side, `L` or `R`.

The list is the traversal:

1. each left-child subtree;
2. the node;
3. each right-child subtree.

Same-side siblings are ordered by ascending ID. The simple reference compares replica/sender IDs and relies on its insertion invariant that same-side siblings never share a sender. `F:fugue-simple/src/index.ts:6–40,104–115,182–219`.

**Generation rule in the author’s current causal state:**

1. Find `leftOrigin`: the visible character preceding the insertion, or the start/root sentinel.
2. If `leftOrigin` has no right children, make the new node a right child of `leftOrigin`.
3. Otherwise, find the immediately following node **including tombstones**. This is the leftmost descendant of the first right child of `leftOrigin`.
4. Make the new node a left child of that following node.

The operation transmitted by the simple reference is already the resolved **`parent + side`** choice, not just a visible offset or a pair of current visible neighbors. `F:fugue-simple/src/index.ts:296–322`.

Deletion retains the structural node. The implementation updates visible subtree sizes while keeping ancestry. `F:fugue-simple/src/index.ts:11–31,119–124,325–334`; [paper, Algorithm 1](https://arxiv.org/html/2305.00583).

Fugue keeps common forward and backward runs together, but **original Fugue is not the paper’s maximally non-interleaving algorithm**. That stronger claim belongs to FugueMax.

### 1.5 FugueMax

FugueMax keeps Fugue’s tree and parent/side generation rule, with one important change:

- Left siblings retain ascending ID order.
- Right children also record a right origin.
- Right siblings are visited in the **reverse sequence order of their right origins**.
- Equal right origins are tied by ascending ID.

“Sequence order” here means order in the retained ordering structure, not lexical comparison of the right-origin ID. The end sentinel compares after all ordinary nodes.

`F:fugue-max-simple/src/index.ts:121–159,161–205,482–509`.

The paper’s §V-A defines the right origin using the element immediately after the left origin **including tombstones**. Definition 6 introduces FugueMax’s sibling-order change. Theorem 9 establishes maximal non-interleaving, and Theorem 10 characterizes the resulting semantics. [Paper](https://arxiv.org/html/2305.00583).

An equivalent origin-tree characterization in the paper is useful for our two-origin operation format:

1. Traverse the left-origin tree in preorder.
2. Order siblings using a postorder traversal of their right-origin forest.
3. Order forest roots with different right origins by reverse order of those origins.
4. Resolve equal-origin and remaining sibling ties by ID.

That is a global structural rule, not a standalone comparator over two ID strings.

The Diamond Types source explicitly describes its CRDT spans as **YjsMod / FugueMax** items generating identical merge behavior. Its spans store both origin boundaries, with later characters in a span acquiring the preceding character as left origin. `D:src/listmerge/yjsspan.rs:24–43`.

### What “maximal” does and does not mean

The paper proves that perfect forward and backward non-interleaving cannot both be required for every causal history. Definition 4 includes an explicit exception, justified by Lemma 5.

Accordingly:

- “FugueMax satisfies maximal non-interleaving” is defensible.
- “FugueMax never interleaves under any circumstances” is not.
- Tests should encode the formal exception rather than reject every output containing an apparent split.

[Paper, §V-B, Definition 4, Lemma 5, Figures 6–8](https://arxiv.org/html/2305.00583).

## 2. Anomalies table

The rows concern concurrent runs, not whether a single user’s basic local insertion works.

| Rule                               | Forward-typed runs at a common position                                  | Backward-typed runs                                               | Independent same-gap single inserts                         | Important qualification                                                      |
| ---------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Host insert-after, reverse arrival | Keeps independent forward chains together                                | Interleaved host arrivals can split the runs                      | Reverse host-arrival order                                  | Different authoritative schedules may legitimately produce different results |
| Conventional RGA                   | Forward non-interleaving                                                 | Backward interleaving possible                                    | Descending Lamport/replica tie-break                        | Left-origin ancestry alone does not preserve backward runs                   |
| Yjs/YATA                           | Forward non-interleaving                                                 | Paper reports multi-replica backward anomaly                      | Client-ID conflict ordering for the same integration points | Two origins do not, by themselves, make the algorithm FugueMax               |
| Original Fugue                     | Forward non-interleaving; ordinary backward examples also remain grouped | Better backward behavior than RGA/YATA; not the maximal guarantee | Ascending ID within same-side siblings                      | Cases with different right origins distinguish it from FugueMax              |
| FugueMax                           | Maximal forward property                                                 | Maximal backward property, with the paper’s necessary exception   | Ascending ID when both origins match                        | Reverse sequence order of right origins is essential                         |

Sources: [Weidner article, “Concurrent Insertions” and “Decentralized Variants”](https://mattweidner.com/2025/05/21/text-without-crdts.html); [Fugue paper, Table I and §V](https://arxiv.org/html/2305.00583); `F:fugue-simple/src/index.ts:104–115`; `F:fugue-max-simple/src/index.ts:121–159`; `Y:src/structs/Item.js:212–235`.

**Same-gap inserts are not themselves an interleaving anomaly.** The anomaly appears when an independent insertion splits an intended causal run. Tests must distinguish ordering preferences from broken run adjacency.

## 3. Required operation fields

### 3.1 Recommended semantic fields

This is a proposed Singapore contract, informed by the sources, rather than an existing upstream API.

| Field                                           | Purpose                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `documentId` and history/epoch identity         | Prevent applying operations to another document or a retired ordering history                           |
| Unique operation ID                             | Deduplication and acknowledgment                                                                        |
| Stable character ID or ID range                 | Reference each inserted element before acknowledgment; distinguish identity from its visible position   |
| Text payload and explicit atom-count convention | Define precisely how ID ranges map to Unicode content                                                   |
| `originLeft`                                    | The author’s insertion predecessor, with a start sentinel                                               |
| `originRight`                                   | The specified structural right origin, with an end sentinel                                             |
| `deps` / causal frontier                        | Describe the causal state in which the edit was authored; identify dependencies that must be available  |
| `lamport`                                       | Preserve a causally monotonic scalar for later algorithms and diagnostics; not a replacement for `deps` |
| Deleted IDs or explicit ID spans                | Delete the intended characters, not whatever later occupies an index range                              |
| Host sequence and acknowledgment metadata       | Identify the authoritative committed prefix and which local operations remain pending                   |
| Stable transaction/origin identity              | Group local edits and make collaborative undo attribution possible                                      |

The upstream structural basis is `F:fugue-simple/src/index.ts:34–45`; `F:fugue-max-simple/src/index.ts:121–159,482–509`; `D:src/listmerge/yjsspan.rs:24–49`. The reconciliation basis is [Weidner, “Client Side”](https://mattweidner.com/2025/05/21/text-without-crdts.html).

### 3.2 Can the host deterministically apply the rule?

**Yes**, with two viable implementations:

**A. Explicit reference-tree operations**

The author transmits immutable:

- `parent`;
- `side`;
- ID and payload;
- for FugueMax right children, `rightOrigin`.

The host integrates that structural choice. It does **not** regenerate the parent/side from its newer state.

This directly matches the simple references. `F:fugue-simple/src/index.ts:34–40,296–322`; `F:fugue-max-simple/src/index.ts:482–509`.

The host must validate the author’s structural choice against the author’s causal context, or treat clients as trusted. Received structure alone does not prove the edit was valid.

**B. Two-origin canonical integration**

Keep `originLeft`, `originRight`, IDs and dependencies as the public op format. Implement the equivalent FugueMax origin-structure integration and derive any parent/side representation internally.

Diamond Types demonstrates a two-origin representation for the FugueMax-equivalent behavior, but its surrounding causal-history machinery is part of the implementation. `D:src/listmerge/yjsspan.rs:24–49`; `D:src/listmerge/merge.rs:142–253`.

**Recommended:** B for the wire format. Keep A as the small, obviously understandable reference oracle if needed.

### 3.3 Traps to close before implementation

1. **Visible right neighbor is not necessarily the paper’s right origin.** A tombstone can be the required structural boundary. `F:fugue-simple/src/index.ts:311–318`; `L:crates/loro-internal/src/container/richtext/tracker/crdt_rope.rs:809–820`.

2. **Do not reconstruct authoring context from the current host sequence.** The host may have integrated concurrent characters the author never saw. The origins and dependency context must remain immutable.

3. **Do not reauthor origins during optimistic replay.** Replay must reuse the same semantic operation. Recalculating origins changes its meaning and jeopardizes a future host-free ordering path.

4. **Lamport clocks do not encode the dependency frontier.** Two operations can have comparable scalar clocks without one depending on the other.

5. **Do not reuse replica/counter IDs after restart.** Overlapping IDs with different content are a separate correctness/security problem. Loro has explicit tests for reused-peer conflicting imports. `L:crates/loro/tests/import_reused_peer_id.rs:72–136,310–434`.

6. **Specify span expansion.** A forward-inserted span should expand to per-character identities and a left-origin chain. Do not flatten backward typing into the same single forward insertion if doing so discards causal structure. `D:src/listmerge/yjsspan.rs:31–43`; `D:src/list_fuzzer_tools.rs:46–67`.

7. **Deletion is idempotent by target identity.** Concurrent deletes must not cause a neighboring character to disappear when replayed. Double-deletion tests are particularly valuable. `D:src/listmerge/merge.rs:1140–1163`; `L:loro-js/tests/text-interop.test.ts:144–173`.

8. **GC is a protocol decision.** Retaining payload bytes, retaining ordering IDs, and retaining undo history are separate choices. Offline edits and anchors can still refer to deleted characters.

9. **Host corrections require defined dependent-op behavior.** If the host rejects or rewrites a pending insertion, later pending operations may reference its IDs. This is not covered simply by selecting a CRDT placement rule. The article flags reconciliation trouble after flexible host rewrites. [Weidner, “Flexible Operations”](https://mattweidner.com/2025/05/21/text-without-crdts.html).

## 4. Test inventory

### Applicability key

- **Both:** useful for the host-ordered protocol now and a host-free CRDT later.
- **Host adapted:** reuse the workload, but assert convergence after consuming the same host log.
- **CRDT direct:** arbitrary admissible delivery/merge order independence.
- **Result:** final text, IDs, positions, events, or validity.
- **Specific:** depends on ordering semantics, codec, internal representation, or an API we may not adopt.

Effort estimates assume one shared adapter already supports replicas, local index-to-ID authoring, delivery, snapshots, anchors and undo. They are planning estimates, not measured implementation time:

- **S:** hours to roughly one day.
- **M:** roughly one to three days.
- **L:** several days or longer.

### 4.1 Loro

| Group and source location                                                                                                                                                                                                                                                                                                                                    | Assertions and cases to preserve                                                                                                                                                                                            | Nature                                                                    | Applicability                                                                       | Effort |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| **Direct interleaving tests** — `L:crates/loro-internal/tests/fugue.rs:5–89`                                                                                                                                                                                                                                                                                 | `test_forward_interleaving`, `test_backward_interleaving`, `test_forward_backward`, `test_yjs_interleave`. First three expect `Hello World!`; fourth expects `b12`, keeping the `12` causal run intact                      | Ordering-specific literal outputs plus result-level adjacency             | Both, once replica-ID tie-breaks match; CRDT additionally permutes merge order      | S      |
| **Origin selection around deletion/future spans** — `L:crates/loro-internal/src/container/richtext/tracker/crdt_rope.rs:800–841`                                                                                                                                                                                                                             | `get_origin_left_and_right`, `get_origin_left_and_right_among_tombstones`, `should_ignore_future_spans_when_getting_origin_left`                                                                                            | Structural/ordering-specific, exceptionally relevant                      | Both                                                                                | S–M    |
| **TS Fugue ordering/index regressions** — `L:loro-js/tests/fugue-index.test.ts:7–129`                                                                                                                                                                                                                                                                        | Long concurrent runs; insertion after a run; parameterized list/text older-origin case producing `AXYBN`; concurrent-root case producing `xaaaabn` across import orders                                                     | Ordering-specific outputs; probe-count checks are implementation-specific | Both for outcomes; port performance expectations as separately measured local tests | M      |
| **Text interoperability regressions** — `L:loro-js/tests/text-interop.test.ts:23–174`                                                                                                                                                                                                                                                                        | Remote deletion, insert before/after sibling subtrees, multi-run delete ordering, consecutive insertion merging, checkout after double deletion, text cursors                                                               | Mixed result and internal history layout                                  | Both for semantics; snapshot/block layout assertions need replacement               | M      |
| **General convergence fuzzer** — `L:crates/fuzz/src/crdt_fuzzer.rs:467–505,676–735`; `L:crates/fuzz/tests/small_fuzz.rs:8–48`; `L:crates/fuzz/src/container/text.rs`                                                                                                                                                                                         | Multiple sites; sync in several formats; tracker/history consistency; 2- and 5-site property tests; text actor actions                                                                                                      | Result convergence plus Loro-specific history invariants                  | Host adapted now; CRDT direct later                                                 | L      |
| **Fuzzer entry points** — `L:crates/fuzz/fuzz/fuzz_targets/{all,multi_sites_only,one_doc_fuzz,random_import,gc_fuzz,diff_calc,local_events,text-update}.rs`                                                                                                                                                                                                  | General schedules, one-document checkout, random import, GC, diff/application, event mirrors, text-update workloads                                                                                                         | Mixed                                                                     | Text-filtered workloads apply to both; host must replace peer-merge semantics       | M–L    |
| **Fixed fuzzer regressions** — `L:crates/fuzz/tests/test.rs:35–175,777–849,5630–5890,8793–10235,11159–13243`; `L:crates/fuzz/tests/{checkout_path,compatibility,update_text,shallow_json_repro}.rs`                                                                                                                                                          | Text update after deletion; Lamport/style issue; text deletion; sliced concurrent insert rollback; checkout/splice positions; tracker after diff; duplicate diff apply; state-only/shallow roots; export/import equivalence | Result-heavy, with Loro-specific history operations                       | Both where API exists; historical checkout is optional product scope                | L      |
| **Current JS differential fuzz** — `L:loro-js/tests/differential-fuzz.test.ts:18–89`; `L:loro-js/tests/richtext-differential.test.ts:6–26`                                                                                                                                                                                                                   | Fixed seeds for replay/checkout/snapshot/event mirrors; separate concurrent plain-text seeds with marks disabled; optional Rust oracle                                                                                      | Generic invariants plus Loro-specific oracle                              | Both after adapter rewrite; literal Rust comparison needs semantic compatibility    | M–L    |
| **Concurrent import regression suite** — `L:crates/loro/tests/concurrent_import.rs:25–723`                                                                                                                                                                                                                                                                   | Ping-pong convergence; fresh-replica replay; rollback; three-peer crisscross; partial rounds; detached imports; cursor after deleted target                                                                                 | Result-level, with Loro checkout/import APIs                              | Host adapted and CRDT direct                                                        | M      |
| **Unicode and position contract** — `L:crates/loro/tests/text.rs:21–626`; `L:crates/loro/tests/contracts/text_handler_semantics.rs:18–439`; `L:crates/loro/tests/contracts/text_richtext_unicode.rs:32–158`; `L:crates/loro-internal/tests/test.rs:941–1231`                                                                                                 | UTF-8/UTF-16/scalar conversion; multibyte insertion/deletion; zero-length deletion; boundaries; slicing/splicing/iteration; batch event positions                                                                           | Result/API-specific, not placement-specific                               | Both                                                                                | M      |
| **JS/WASM Unicode regressions** — `L:crates/loro-wasm/tests/richtext.test.ts:56–123,236–458,626–667`; `L:crates/loro-wasm/tests/basic.test.ts:130–149,1947–1959`                                                                                                                                                                                             | Emoji insert/delete, legal UTF-16 cursor boundaries, non-BMP atoms across peers, astral delete ID lengths, merged astral deletion events and undo                                                                           | Result and coordinate-contract specific                                   | Both                                                                                | S–M    |
| **Invalid operations and atomicity** — `L:crates/loro/tests/text_invalid_ops.rs:158–281`; `L:loro-js/tests/import-atomicity.test.ts:82–241`; `L:crates/loro/tests/apply_diff_atomicity.rs:103–384,804–890`; `L:crates/loro/tests/import_reused_peer_id.rs:72–434`                                                                                            | Out-of-range inserts/deletes; parked malformed ops unlocked by later imports; failed import leaves history/state/events/undo intact; duplicate/conflicting IDs                                                              | Result/protocol-specific                                                  | Both; especially host input validation                                              | M      |
| **Stable cursor recovery** — `L:crates/loro/tests/contracts/cursor_recovery.rs:8–176`; `L:crates/loro/tests/contracts/text_richtext_advanced.rs:249–314,623`; `L:crates/loro/tests/loro_rust_test.rs:797–976`; `L:crates/loro/tests/issue.rs:442–481`                                                                                                        | Anchor resolves after its target is deleted; side/bias serialization; rebuild without cache; Unicode atoms across peers; missing/pending targets; history retained after parent deletion                                    | Result/anchor-policy specific                                             | Both                                                                                | M      |
| **Collaborative text undo** — `L:crates/loro/tests/integration_test/undo_test.rs:312–411,558–807,1126–1175,1347–1426,1544–1914`; `L:crates/loro/tests/contracts/text_undo.rs:133–204`; `L:crates/loro-internal/tests/undo.rs:8–231`; `L:crates/loro-wasm/tests/undo.test.ts:6–369`                                                                           | Local undo amid remote edits; overlapping deletions; grouping conflicts; exclude origins; redo clearing; callback metadata; stack limits; cursor transforms; paused checkout/import behavior                                | Result with chosen undo policy                                            | Both, but requires actual collaborative undo design                                 | M–L    |
| **Tombstones/shallow history/GC** — `L:crates/loro/tests/integration_test/shallow_snapshot_test.rs:57–112,266–433,477–558,801–909`; `L:crates/loro/tests/shallow_snapshot_concurrency.rs:166–501`; `L:crates/loro/tests/legacy_text_delete_start_id.rs:60–85`; `L:crates/loro-wasm/tests/gc.test.ts:14–53`; `L:crates/fuzz/fuzz/fuzz_targets/gc_fuzz.rs:5–8` | Deleted-target boundaries; outdated updates rejected after history trimming; accepted updates depend on retained root; anchor success/failure across trimming; root-order independence; legacy delete boundary regression   | Result plus Loro’s explicit GC contract                                   | Both, after choosing our epoch/retention contract                                   | L      |
| **Encoding-independent replay** — `L:crates/fuzz/tests/compatibility.rs`; `L:loro-js/tests/{text-interop,rust-interop,state-snapshot,snapshot-checkout,version-transition,legacy-data}.test.ts`; `L:crates/loro/tests/loro_js_interop.rs:103–279`; `L:crates/loro/tests/moon_transcode.rs:1240–1622`                                                         | Equivalent state across snapshot/update/JSON forms and implementation languages; replay/history/cursor identity survives representation changes                                                                             | Result-level property; wire bytes are codec-specific                      | Both                                                                                | M–L    |
| **Text-update/diff functionality** — `L:crates/loro/tests/integration_test/text_update_test.rs:4–159`; `L:crates/loro/tests/contracts/text_large_import_diff.rs:4`; `L:crates/loro/tests/contracts/text_richtext_advanced.rs:18–81`                                                                                                                          | Empty/nonempty replacement, special characters, line endings, sparse edits, retain/insert/delete delta application                                                                                                          | Result-level                                                              | Both if Singapore exposes these editing APIs                                        | S–M    |
| **Performance regression workloads** — `L:crates/loro/tests/perf_text_insert_quadratic.rs:13`; `L:crates/loro/tests/perf_concurrent_import.rs:51,152`; `L:crates/loro/tests/perf_import_quadratic.rs:4`; `L:loro-js/tests/fugue-index.test.ts:7–55`                                                                                                          | Long insert sequences, long history followed by a small concurrent edit, large run placement                                                                                                                                | Workloads portable; timings/counters specific                             | Both; establish our own baseline                                                    | M      |

**Additional cross-cutting families worth preserving in the inventory:** failed-import rollback, fork-at-random-history, change-store split/compaction, pending dependency activation, event replay, and text parent/container deletion. Relevant entry points include:

- `L:crates/loro/tests/failed_import_state_rollback.rs:82–158`
- `L:crates/loro/tests/fork_at_random_history.rs:12`
- `L:crates/loro/tests/change_store_test.rs:11–57`
- `L:crates/loro-internal/src/oplog/pending_changes.rs:387–557`
- `L:crates/loro-internal/src/tests/replay_base.rs:64–495`
- `L:crates/loro/tests/fork_at_deleted_container.rs:78–417`

These do not all become plain-text tests unchanged. Container recreation, trees and movable lists require capabilities outside this lane.

**Caution:** Loro’s GC fuzzer explicitly skips complete-history sync checks when either document is shallow. Do not describe it as proving that arbitrary empty/offline replicas can merge with a trimmed document. `L:crates/fuzz/src/crdt_fuzzer.rs:473–479`.

### 4.2 Yjs

At the inspected commit, `y-text.tests.js` contains 49 exported test functions, `y-array.tests.js` 41, `undo-redo.tests.js` 26, and `relativePositions.tests.js` 20. Those counts include formatting, embeddings and non-text cases; they are not counts of ready-to-port plain-text tests.

| Group and source location                                                                                                               | Assertions and relevant cases                                                                                                                                                                                                             | Nature                                                                  | Applicability                                                          | Effort |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| **Shared convergence scheduler** — `Y:tests/testHelper.js:451–499,566–590`                                                              | Five users, random disconnect/reconnect, random message flushing; converged text/arrays; replay from merged updates; no unresolved pending dependencies                                                                                   | Result-level plus internal struct/state-vector equality                 | Host adapted; CRDT direct                                              | M      |
| **Plain-text deterministic cases** — `Y:tests/y-text.tests.js:1257–1286,1620–1779,1812–1847`                                            | `testBasicInsertAndDelete`, random positions, append, best-case runs, large fragmented document, incremental update workload, search-marker regression                                                                                    | Result-level; markers/performance internal                              | Both                                                                   | S–M    |
| **Plain sequence conflicts and late sync** — `Y:tests/y-array.tests.js:146–262`                                                         | `testDeleteInsert`, three concurrent conflicts, concurrent insert/delete, late insert sync, disconnected delivery, late deletion sync, insertion then merged deletion                                                                     | Result-level convergence; use character tokens in place of array values | Both; host schedule adaptation                                         | S–M    |
| **Text convergence parameterizations** — `Y:tests/y-text.tests.js:2043–2097`                                                            | `testRepeatGenerateTextChanges{5,30,40,50,70,90,300}`                                                                                                                                                                                     | Result-level randomized workloads                                       | Both                                                                   | M      |
| **Array convergence parameterizations** — `Y:tests/y-array.tests.js:556–663`                                                            | `testRepeatGeneratingYarrayTests{6,40,42,43,44,45,46,300,400,500,600,1000,1800,3000,5000,30000}`                                                                                                                                          | Result-level; filter to character sequences                             | Both                                                                   | M      |
| **Unicode split behavior** — `Y:tests/y-text.tests.js:1780–1804`                                                                        | `testSplitSurrogateCharacter`: insertion/deletion/formatting inside surrogate pairs while offline                                                                                                                                         | Yjs’s UTF-16 contract                                                   | Both as boundary workload; expected acceptance may deliberately differ | S      |
| **Relative position stability** — `Y:tests/relativePositions.tests.js:26–149`                                                           | Cases 1–7, association differences, anchor roundtrip, anchor with undo                                                                                                                                                                    | Result/anchor-policy specific                                           | Both                                                                   | S–M    |
| **Delta-position extension** — `Y:tests/relativePositions.tests.js:151–349`                                                             | Flat-text roundtrip, association through edits, concurrent edits, unresolvable positions, end-of-node; nested/attribute/subtree variants outside plain text                                                                               | Result/API-specific                                                     | Both for flat text                                                     | M      |
| **Collaborative undo** — `Y:tests/undo-redo.tests.js:39–199,349–429,447–580,626–743,802`                                                | Text undo; capture timeout; reject-update example; global scope; double undo; undo events; tracked classes/origins; type scope; undo until a change occurs; nested undo; consecutive redo; block undo; special deletion; doing-stack-item | Result with Yjs undo semantics                                          | Both, translate policy explicitly                                      | M–L    |
| **GC and deletion retention** — `Y:tests/y-array.tests.js:395–403`; `Y:tests/snapshot.tests.js:36–207`; `Y:src/structs/Item.js:384–393` | Reconnect after deletion; restoring deleted/left items; deleted-items snapshots; dependent changes; payload GC versus parent GC distinction                                                                                               | Result plus representation-specific checks                              | Both after retention policy                                            | M      |
| **Update merge/overlap/pending tests** — `Y:tests/updates.tests.js:110–126,237–349,398–587`; `Y:tests/encoding.tests.js:21–58`          | Merge updates, stress, pending updates, intersections, overlap with stub, GC’d encodings, struct references, state-vector treatment of skips                                                                                              | Codec/internal-specific with portable semantic core                     | Both for replay/dedup/dependency properties                            | M–L    |
| **Snapshot text tests** — `Y:tests/y-text.tests.js:1462–1518`; `Y:tests/snapshot.tests.js:9–234`                                        | Text at a snapshot, deletion after snapshot, restoring empty/basic/deleted history, update containment                                                                                                                                    | Result with historical-state API                                        | Both where history is supported                                        | M      |
| **Codec compatibility** — `Y:tests/compatibility.tests.js:23–46`; `Y:tests/testHelper.js:35–65`                                         | Array/map/text V1 fixtures; codec-switch harness                                                                                                                                                                                          | Existing Yjs codec-specific                                             | Port representation-independent semantic checks, not Yjs bytes         | M      |

Two qualifications change the port:

- **The current helper’s purported V2 switch falls back to V1**, with an explicit TODO. Do not claim all its random tests actually run both encodings. `Y:tests/testHelper.js:62–65`.
- **The helper compares Yjs internal stores, not only text.** Its `compareStructStores` checks original IDs, origins, linked neighbors and stored content. Those assertions should be replaced by our own structural invariants, not discarded without replacement. `Y:tests/testHelper.js:491–494,513–546`.

Formatting-only families such as `testRepeatGenerateQuillChanges*`, attributed renderers, XML, map undo, embeds and nested-node delta positions are outside the first plain-text port. They remain candidates for a later rich-text/container phase.

**Important Unicode incompatibility:** Yjs explicitly tests accepting edits inside UTF-16 surrogate pairs. Loro explicitly tests valid UTF-16 cursor boundaries. These are different contracts. Select Singapore’s atom unit and boundary policy before treating either suite’s expected output as authoritative.

### 4.3 Diamond Types

| Group and source location                                                                                                                                                        | Assertions and relevant cases                                                                                                                                                                                                                                                     | Nature                                                                        | Applicability                                                                             | Effort                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| **Local random editing oracle** — `D:src/listmerge/fuzzer.rs:8–31`; `D:src/list_fuzzer_tools.rs:17–107`                                                                          | `random_single_document`; compares every local edit with an independent rope; Unicode; forward/backward insertions; forward/backspace deletions                                                                                                                                   | Result-level; particularly clean reusable workload                            | Both                                                                                      | S–M                               |
| **Multi-branch merge fuzzer** — `D:src/listmerge/fuzzer.rs:34–175`                                                                                                               | Three branches; random edits and pair merges; periodic all-branch merge; fixed seed; longer/forever modes                                                                                                                                                                         | Result convergence plus internal branch equality                              | Host adapted; CRDT direct                                                                 | M                                 |
| **Operation-log merge fuzzer** — `D:src/list/oplog_merge_fuzzer.rs:79–84`                                                                                                        | Fixed-seed and unbounded merge variants                                                                                                                                                                                                                                           | Result/history convergence                                                    | Both with host transport adapter                                                          | M                                 |
| **Deterministic insertion/deletion regressions** — `D:src/listmerge/merge.rs:1011–1227`                                                                                          | `test_ff`, `test_ff_goop`, `test_ff_merge`, insert/deletion merge tests, concurrent insert, concurrent delete, `unroll_delete`, `backspace`, `ins_back`                                                                                                                           | Mixed FugueMax-specific ordering and result-level behavior                    | Both                                                                                      | S–M                               |
| **Repeated deletion/tombstone state** — `D:src/listmerge/merge.rs:1140–1213`; `D:src/listmerge/yjsspan.rs:52–69`                                                                 | Double deletion of the same character; retreat/advance of deletion state; backspace range behavior                                                                                                                                                                                | Internal tracker assertions plus portable idempotence/history behavior        | Both; retreat is not automatically collaborative undo                                     | M                                 |
| **Text op splitting/coalescing** — `D:src/list/operation.rs:234–305`; `D:src/list/op_metrics.rs:316–427`; `D:src/list/op_iter.rs:313–436`                                        | Backspace merges; insertion merges; positional splits; Unicode splitting; forward deletion truncation; splitting full entries                                                                                                                                                     | Span/representation-specific with portable semantic invariants                | Both                                                                                      | M                                 |
| **Branch/history basics** — `D:src/list/branch.rs:165–179`; `D:src/list/list.rs:230`; `D:src/list/oplog_merge.rs:184`; `D:src/list/eq.rs:205`                                    | Branch at version, early-version application, smoke insert/delete/merge, equality                                                                                                                                                                                                 | Result/history                                                                | Both where historical branches are supported                                              | S                                 |
| **Encoding deterministic tests** — `D:src/list/encoding/tests.rs:31–417`                                                                                                         | Encode/decode smoke; decode in parts; merge parts; unknown base error; deleted content; reordered encoding; shared agent across branches; repeated save/load; doc ID mismatch; overlap result frontier; unsorted parents; regression; empty/simple compatibility; malformed bytes | Codec-specific plus portable replay, atomicity, dedup and identity properties | Both                                                                                      | M–L                               |
| **Encoding fuzzers** — `D:src/list/encoding/fuzzer.rs:8–116`                                                                                                                     | Single-document encode/decode after edits; three-document full-patch exchange; fixed seed and ignored forever variants                                                                                                                                                            | Result/history invariance across serialization                                | Both                                                                                      | M                                 |
| **Causal graph/merge planning** — `D:src/listmerge/plan.rs:825–953`; `D:src/causalgraph/enc_fuzzer.rs:67–80`; `D:src/causalgraph/graph/tools.rs:1123,1304`                       | Fork/join planning, child encountered through multiple parents, randomized planning, encoded causal graphs, frontier/containment behavior                                                                                                                                         | Primarily implementation-specific                                             | Causal/dependency invariants apply to both; do not port planner internals wholesale       | L                                 |
| **Alternative listmerge2 engine tests** — `D:src/listmerge2/test_conversion.rs:437–485`; `D:src/listmerge2/index_gap_buffer.rs:1042–1114`; `D:src/listmerge2/yjsspan.rs:152–181` | Engine conversion/plans; gap movement; index/undiff splits; span consistency                                                                                                                                                                                                      | Internal data structure tests                                                 | Conditional: port only if adopting equivalent structures                                  | L; low priority                   |
| **Conformance generation** — `D:src/list/gen_random.rs:7–78`; `D:crates/dt-cli/src/main.rs:274–304,710–722`; `D:test_data/conformance.json.br`                                   | Seeded multi-branch histories; Unicode option; per-agent-order option; exported expected history/state                                                                                                                                                                            | Result corpus with ordering-specific expected values                          | Both after ID-space translation; direct cross-engine oracle only for compatible semantics | M–L; compressed corpus unexamined |

**Do not call Diamond Types’ tracker retreat “collaborative undo.”** The inspected list tests exercise historical state traversal and deletion accounting. I found no corresponding public collaborative text UndoManager or stable user-cursor suite in the inspected list sources. That is a scoped negative finding, not proof those capabilities are absent from every branch/version.

**Exporter warning:** Diamond Types’ exporter states that its simplified form discards direction information; converting a reversed insertion to `SimpleTextOp` contains a `todo!("Not reversing op")`. Prefer the native source workloads or full-history schema; do not assume every simplified JSON trace preserves backward insertion structure. `D:crates/dt-cli/src/export.rs:2–12,34–40,73–80`.

### 4.4 Fugue reference repository

| Group and source location                                                                                                 | Assertions and relevant cases                                                                                                  | Nature                                          | Applicability                                                            | Effort                       |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| **Yjs backward-anomaly example** — `F:yjs-interleave/index.js:3–20`                                                       | Three-replica `b`, then `a` before `b`, plus independent `x`; documented Yjs output `axb`                                      | Ordering-specific counterexample                | Both; target assertion should preserve `ab` adjacency, not endorse `axb` | S                            |
| **B1 sequential editing checks** — `F:crdt-benchmarks/js-lib/b1.js:19–21,65–188`                                          | Sequential text workloads checked against expected text and second replica                                                     | Result-level                                    | Both                                                                     | S                            |
| **B2 concurrent editing checks** — `F:crdt-benchmarks/js-lib/b2.js:60–175`                                                | Concurrent string insertion, random characters, random words, insert/delete; equal replica text and selected length assertions | Result convergence; not a full intention oracle | Host adapted; CRDT direct                                                | S–M                          |
| **B3 many-client text workload** — `F:crdt-benchmarks/js-lib/b3.js:20–69,120–134`                                         | Many concurrent clients inserting text; harness chiefly checks update-generation behavior                                      | Benchmark workload, weaker oracle               | Both after adding final ID/text convergence checks                       | M                            |
| **B4 real editing trace** — `F:crdt-benchmarks/js-lib/b4.js:101–115`; `F:crdt-benchmarks/js-lib/b4-editing-trace.js:5–17` | Real character-by-character editing trace; final text check                                                                    | Result-level                                    | Both, but dataset licensing unresolved                                   | S–M after license resolution |
| **Small reference algorithms** — `F:fugue-simple/src/index.ts`; `F:fugue-max-simple/src/index.ts`                         | Independent implementations usable as ordering oracles                                                                         | Algorithm-specific                              | Both for canonical placement; CRDT delivery permutations later           | M                            |

The Fugue repository is **not a comprehensive standalone test suite**: its root scripts build and run benchmarks, and its README describes benchmark reproduction. I did not find dedicated convergence fuzzers, collaborative undo tests, user-anchor stability tests, or GC tests there. `F:package.json:20–25`; `F:README.md:5–23,35–43`.

Loro’s four named interleaving tests are the cleaner immediate port of the intended examples.

### 4.5 What the adapter must preserve

For every upstream workload translated to ID-space operations:

1. Materialize the replica’s exact causal state.
2. Resolve its local insertion index to immutable origins.
3. Assign stable IDs in the chosen atom unit.
4. Resolve deletion ranges to the specific IDs being deleted.
5. Preserve dependency edges, backward typing, transaction boundaries, and delivery schedule.
6. Then encode the operation in our format.

**Do not convert an upstream position against the final merged text.** That changes the experiment.

Split assertions into:

- **Portable:** final content, live ID sequence, local edit correctness, anchor bias, deletion idempotence, snapshot replay, deduplication, event/application consistency.
- **Placement-specific:** literal concurrent ordering, left/right origin adjacency, FugueMax exceptions, author-ID tie-break.
- **Representation-specific:** Yjs structs, Loro blocks, Diamond Types tracker spans, byte encodings, probe counts.

For host-ordered testing:

> Given one authoritative host log, all clients converge after reconciliation and their pending queues settle correctly.

For host-free testing:

> Given the same accepted operation set and dependency graph, every admissible delivery/merge order produces the same semantic state.

The latter is not automatically required by a host-arrival-sensitive protocol. Keep separate test categories rather than weakening or conflating the assertion.

## 5. Licences and attribution

This is source inspection, not legal advice.

| Repository/subtree                                               | Exact inspected license declaration                                                                                                                                                        | Porting requirement and caveat                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loro root/public tests**                                       | MIT, `Copyright (c) 2023 Loro`. `L:LICENSE:1–21`                                                                                                                                           | Preserve copyright and permission/license text with copied or substantially adapted tests                                                                                                                         |
| **Loro nested diff implementation**                              | Apache-2.0. `L:crates/loro-internal/src/diff/LICENSE:1–3`                                                                                                                                  | Root MIT does not cover this subtree indiscriminately; apply Apache obligations if porting material from it                                                                                                       |
| **Yjs**                                                          | MIT, 2023 notice naming Kevin Jahns and RWTH Aachen’s Chair of Computer Science 5. `Y:LICENSE:1–23`                                                                                        | Preserve both listed holders and MIT permission text, not only the GitHub author name                                                                                                                             |
| **Diamond Types**                                                | ISC in package metadata and README. `D:Cargo.toml:1–11`; `D:README.md:51–53`                                                                                                               | ISC ordinarily requires preserving copyright and permission notices. No standalone full license/copyright file was found in this checkout; resolve exact notice/provenance before verbatim fixture redistribution |
| **Fugue simple/max-simple, reproducer, ordinary benchmark code** | MIT, 2023 Matthew Weidner and Martin Kleppmann. `F:LICENSE:1–23`                                                                                                                           | Preserve the notice and MIT text; README also identifies modified benchmark provenance from Kevin Jahns’ `crdt-benchmarks`, `F:README.md:35–37`                                                                   |
| **Fugue `fugue/` subtree**                                       | Apache-2.0, explicitly excepted from root MIT. `F:LICENSE:1`; `F:fugue/LICENSE:1–3,89–119`                                                                                                 | Include license; retain relevant notices; prominently mark changes; carry any applicable NOTICE. No NOTICE file was found in the inspected checkout                                                               |
| **Fugue `b4-editing-trace.js`**                                  | Explicitly excluded from root MIT. Header credits Martin Kleppmann and links its source, but contains no license grant. `F:LICENSE:1`; `F:crdt-benchmarks/js-lib/b4-editing-trace.js:5–17` | **License unresolved. Do not redistribute this dataset on the assumption the repo is uniformly MIT**                                                                                                              |

Practical implementation recommendation:

- Add a third-party test notices file containing full applicable license texts.
- Mark translated files with source repo, commit, original path/test name and the fact they were adapted to Singapore’s ID-space operations.
- Preserve relevant per-file notices.
- Separate proprietary/document-bearing trace payloads from synthetic test scenarios.
- Do not assume a benchmark dataset inherits the source-code license.

MIT does not explicitly require a prominent modification notice, but provenance is valuable for maintenance. Apache-2.0 does require marking changed files. `L:LICENSE:12–13`; `Y:LICENSE:14–15`; `F:fugue/LICENSE:94–119`.

## 6. Recommendation

### 6.1 Placement

**Use FugueMax as the canonical placement rule at the host, with immutable two-origin operations and causal dependencies.**

Reasons:

1. It gives the paper’s strongest specified non-interleaving behavior.
2. The operation format already plans to carry both origins.
3. Its behavior has an independent Diamond Types/YjsMod implementation to compare against.
4. It avoids changing the intended ordering later merely to satisfy the stronger suite.
5. Host authority remains intact: this does not require implementing a full decentralized transport now.

This is a recommendation, not an upstream claim. Its factual basis is [paper §V-C, Theorems 9–10](https://arxiv.org/html/2305.00583), `F:fugue-max-simple/src/index.ts:121–159`, and `D:src/listmerge/yjsspan.rs:24–43`.

**Acceptable simpler alternative:** original Fugue, explicitly named and tested as original Fugue. The paper itself values its simpler implementation. If selected, document its weaker guarantee and keep FugueMax-specific expected outputs in a separate category. Do not market either option as absolute “no interleaving.”

Avoid:

- plain reverse arrival as the permanent rule if backward-run preservation is a requirement;
- YATA solely because it has two origin fields;
- Lamport-sorted sibling order under the name “Fugue”;
- deriving origins from the host’s newest visible state.

### 6.2 Ranked suites to port first

| Rank   | Port                                                                                                                                  | Why first                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **1**  | Loro’s four `fugue.rs` cases; Fugue/Yjs three-replica counterexample; Loro tombstone-origin cases; Loro `AXYBN`/`xaaaabn` regressions | Tiny deterministic cases expose wrong parent/origin/tie-break semantics immediately                                       |
| **2**  | Yjs basic text, character-array conflict/late-sync tests, and relative-position cases 1–7; Loro Unicode and cursor-recovery contracts | Protect user-visible editing, reconnects and caret behavior without requiring a full multi-container runtime              |
| **3**  | Diamond Types local rope-oracle generator, backward insertion/backspace cases, repeated concurrent deletion                           | Independent local-state oracle and high-value span/identity edge cases                                                    |
| **4**  | Adapt Yjs’s five-user disconnect/message scheduler to one host plus optimistic clients                                                | Directly tests the approved architecture, including pending replay and late acknowledgment                                |
| **5**  | Loro and Yjs collaborative text undo groups                                                                                           | Prevent undo from erasing remote work; requires an explicit local-undo policy first                                       |
| **6**  | Diamond Types merge/conformance generators and Loro plain-text differential seeds                                                     | Broader randomized causal histories and independent placement checks; preserve algorithm-specific expectations separately |
| **7**  | Serialization-invariance, malformed-operation/atomicity and snapshot-replay groups                                                    | Ensure chunking, persistence, dedup and failed imports do not alter semantic ordering                                     |
| **8**  | GC/shallow-history suites, after choosing retention/epoch behavior                                                                    | Upstream suites implement different contracts; premature copying can encode the wrong offline/undo guarantees             |
| **9**  | Large-run/fragmentation workloads and many-client benchmarks                                                                          | Establish our own measured bounds; upstream timings and counters are not portable                                         |
| **10** | B4 real document traces                                                                                                               | Useful realistic workloads, but dataset license must be resolved first                                                    |

### 6.3 Tests we must add ourselves

The upstream suites do not substitute for host-protocol tests. Add:

- local pending insertion referencing another unacknowledged insertion;
- remote insertion received before local acknowledgment;
- acknowledgment carrying both newly committed remote edits and the local accepted edit;
- duplicate submit/ack/broadcast delivery;
- reconnect with a host log gap;
- host rejecting an insertion that later pending operations reference;
- host normalization or correction of an accepted edit;
- snapshot load followed by replay of the same pending operations;
- deleted-origin insertion before and after reconnect;
- caret/selection anchors during rollback and replay;
- undo while earlier edits remain pending;
- causal dependency not yet submitted/committed;
- epoch change or GC invalidating an offline operation.

These are recommendations derived from the approved host/pending-replay architecture, not claims that the upstream repositories contain equivalent cases.

### 6.4 Verification and remaining uncertainty

Completed:

- Read `CLAUDE.md` and loaded `fregat-local`.
- Verified `/work` mount/free space; recorded logical capacity and the 1.7 TiB physical VDO backing size.
- Cloned and pinned all four authorized repositories.
- Inspected algorithm generation/integration code, test definitions/oracles, licenses and nested-license exceptions.
- Confirmed `git status --short` in `/work/projects/platform` remained empty.
- Removed the temporary inventory file created under `/work/tmp/collab-research-B/`.

Not performed, intentionally:

- No upstream or Fregat test execution.
- No builds/installations.
- No timing or performance claims.
- No direct or proxy model/API calls.
- No compressed-corpus decoding.
- No proof that current Yjs HEAD reproduces the paper-era anomaly.
- No complete individual-case enumeration of every text-bearing mixed-container Loro test.
- No Markdown report file creation, due to this worker’s higher-priority output restriction.
