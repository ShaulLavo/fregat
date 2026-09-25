# Workspace indexing: what we index, and what should index us

Status: **research — no implementation scope yet.** Requested 2026-09-13.

A workspace index already exists and is substantial: [`apps/server/src/fs/workspace-index.ts`](../apps/server/src/fs/workspace-index.ts), 1435 lines, a gitignore-aware file index with a watcher, coalesced updates, readiness states, content-kind sniffing and character bags for fuzzy matching. What does not exist is an answer to the question several plans are now queuing behind: **what else belongs in an index, who owns it, and what is allowed to depend on it.**

This is a research plan. It ends in a decision record and a scope, not in code. It exists in `plans/` rather than `docs/` so it stays in the inventory instead of quietly aging out. [Root PLAN.md](../PLAN.md) owns scheduling.

## What is indexed today

| Piece          | Current state                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit           | One entry per filesystem entry: path, basename, extension, size, mtime/birthtime, type and target type, hidden, gitignored, default-ignored, stale flag, version.  |
| Classification | `fileKind` of `source`/`document`/`config`/`image`/`binary`/`other`, and `contentKind` sniffed from the first 512 bytes.                                           |
| Freshness      | A watcher with 25 ms coalescing and a 500-event rebuild threshold, and an explicit readiness state — `cold`, `building`, `ready`, `stale`, `failed`.               |
| Search         | `charBag` per entry supports fuzzy path matching. Content search is separate and shells to ripgrep (`search-rg-parser.ts`) with a fallback (`search-fallback.ts`). |
| Not indexed    | Language identity beyond extension. Symbols. Content. Links between documents. Anything derived from parsing.                                                      |
| Ownership      | Server-side, per workspace, in memory. No persistence across restarts.                                                                                             |

## Consumers waiting on an answer

These are the reason this plan exists. Each one wants something the current index does not hold.

| Consumer                                                             | What it needs                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grammar and theme prefetch                                           | A language census. The editor currently preloads all 53 Shiki grammars and every theme after first paint (`EDITOR_SHIKI_PRELOAD_LANGUAGES` in [`shiki-languages.ts`](../apps/web/src/features/editor/utils/shiki-languages.ts)). A TypeScript project needs four. VS Code loads a grammar on the first file of that language; we want to be earlier than that without being exhaustive. |
| [Plan 088](088-native-code-intelligence.md) native code intelligence | Semantic retrieval, symbol lookup, project memory. The heaviest consumer and the one most likely to dictate the storage answer.                                                                                                                                                                                                                                                         |
| [Plan 108](108-markdown-modes.md) Obsidian mode                      | A document graph: links between notes, backlinks, tags. Obsidian's vault index, in our terms.                                                                                                                                                                                                                                                                                           |
| Search                                                               | Whether content search stays a ripgrep shell-out or gains an index, and what that would cost to keep fresh.                                                                                                                                                                                                                                                                             |
| Tooling and agents                                                   | What an agent can ask about a workspace without reading every file.                                                                                                                                                                                                                                                                                                                     |

## Questions this plan must answer

1. **One index or several?** A file index, a symbol index and a document graph have different freshness costs, different rebuild triggers and different failure modes. Merging them is a coupling decision, not a convenience.
2. **Where does it live?** In memory per workspace as today, on disk per workspace, or in the existing database under `apps/server/src/db`. Persistence changes startup, invalidation and correctness-after-crash.
3. **What is the freshness contract?** Today's readiness states are honest about staleness. Any new layer needs the same, and consumers need to be able to ask rather than assume.
4. **What is cheap enough to index eagerly?** A language census is a fold over extensions the index already holds — nearly free. A symbol index is a parse of every file. These are not the same decision and should not be made together.
5. **What does it cost on a large repository?** The existing [`bench:workspace-search`](../apps/server/scripts/workspace-search-benchmark.ts) is the precedent: any proposal arrives with a measurement, per [AGENTS.md § Optimization](../AGENTS.md#optimization-and-performance-work).
6. **Who may depend on it?** An index that the editor cannot boot without is a different thing from one that makes the editor faster. The prefetch consumer must degrade to today's behaviour when the index is cold.
7. **Does a language census need its own answer first?** It is the smallest consumer, it is nearly free, and it unblocks a measurable win. It may deserve to be split out and shipped ahead of the rest rather than waiting for the whole design.
8. **Should content classification be ours at all?** `contentKind` is sniffed by hand in [`workspace-index.ts`](../apps/server/src/fs/workspace-index.ts): one 512-byte read, five image magic numbers (PNG, JPEG, GIF, WebP, BMP), then a NUL-and-control-byte heuristic for everything else. [`file-type`](https://www.npmjs.com/package/file-type) recognises several hundred binary formats from the same kind of header read. These are two decisions, not one — it can replace the image arm and give every entry a real MIME type, but it detects **binary** formats only and says so, so the text-versus-binary verdict that most consumers actually read stays ours either way.

## Research steps

1. Read the existing index end to end and write down its actual invariants, not its intended ones — especially what `stale` means to a consumer and when a rebuild is triggered.
2. Survey prior art with the same discipline used for markdown in Plan 107: how VS Code's workspace symbol provider, ripgrep, and an Obsidian vault index each handle freshness and scale. Clone what is readable into `/work/projects/references/`.
3. **Read `file-type`, then decide what we want from it (question 8).** Treat it as source material first and a dependency second. It is `22.1.0`, MIT, ESM-only, `node >= 22`, 138 KB unpacked, four transitive dependencies (`strtok3`, `token-types`, `uint8array-extras`, `@tokenizer/inflate`), and server-side only — nothing here touches the first-load budget Plans 106–109 own.

   The detection is not a framework, which is what makes it minable: `source/index.js` is one linear `fromTokenizer` chain of `check([bytes], {offset})` calls against a peeked buffer that grows only as far as a format demands (3 bytes for gzip, 32 for the common set, more for the deep ones), and `source/supported.js` is a 370-line extension and MIME inventory. Signatures lift out one at a time under MIT with attribution.

   Three outcomes are open, and the study picks **per arm**, not once for the whole package:
   - **Depend** — we get several hundred formats and their maintenance, and a dependency in the index's hot path.
   - **Lift the signatures we can name a consumer for** — their table, our pass, no dependency, and we own the bytes we copied.
   - **Leave it** — the five image signatures we have are all anything asks for today.

4. **Design the escalation, not a shorter read.** The 512-byte prefix is cheap and stays — one read per entry is not the cost worth tuning. The open question is what happens when 512 bytes do **not** settle the answer, which today is nothing: `sniffBytes` returns its best guess from the prefix and the entry keeps it.

   Make pass one return three outcomes instead of two: settled, settled-as-`unknown`, or **undecided with a named reason** — which format family the prefix matched and how many more bytes that family needs. Only the third class earns a second read, and the reason is what bounds it.

   The escalation tiers are not uniform, and `file-type` is the evidence for what each costs:
   - **A longer prefix.** Some formats just want more header — their stream helper samples 4100 bytes by default, and ISO 9660 wants ~32 KiB. A second bounded read, nothing more.
   - **A walk.** Zip containers are the expensive tier and the common one: `.docx`, `.xlsx`, `.odt`, `.jar`, `.apk` and `.epub` are all `PK\x03\x04` in the first four bytes, so the prefix can tell you _it is a zip_ and never which one. `detectors/zip.js` is 648 lines that walk local file headers forward looking for the entry that names the format, with explicit `maximumUntrustedSkipSizeInBytes` and `maximumZipEntrySizeInBytes` caps. That shape — bounded walk, hard caps, give up and stay generic — is the part worth copying whatever we decide about the package.
   - **Give up deliberately.** `unknown` after a capped escalation is a real verdict and must be storable as one, or the next cold build pays the same cost again for the same file.

   Then cap it, because an index escalation is a per-entry cost on a cold build: how many entries in a real repository reach pass two at all, what the tail looks like, and what the ceiling is before the build is simply slower for a distinction nobody reads.

   Two things to keep straight while doing it:
   - **Ordering inside pass one is a correctness matter, not a speed one.** A NUL settles `binary`, but every image has a NUL early — so signatures must run before the NUL scan, as `sniffBytes` already does. Any reshuffle preserves that or silently deletes the `image` arm.
   - **Escalate only for a distinction a consumer asked for.** `.docx`, `.jar` and `.iso` all land on `binary` today and nothing complains. If no consumer wants better, the correct escalation budget is zero — and recording _that_, with the tiers priced so a future consumer can reopen it cheaply, is a complete answer to this step rather than a dodge.

5. **Cost and correctness, on a real large repository.**
   - **Correctness first.** Run the candidate and today's classifier over every entry and diff the verdicts. A source file newly called binary is a regression, not an improvement — it disappears from search and from open. Every disagreement is explained before adoption, not after.
   - **Read cost.** Today is one 512-byte read per entry. A tokenizer-driven chain reads more, and some formats want considerably more (`file-type`'s own stream helper samples 4100 bytes by default; ISO 9660 wants 32 KiB). Cold-build cost is the number that decides this, per [AGENTS.md § Optimization](../AGENTS.md#optimization-and-performance-work).
   - **What the extra formats are worth.** A MIME type per entry is only valuable if a consumer asks for one. Name the consumer or drop the arm — archives, video and documents all land on `binary` today and nothing complains.
   - **The half nothing covers.** Text-versus-binary, encoding, and the `unknown` state stay ours whatever we adopt. If the answer is a dependency _and_ the heuristic, say so and price both.
6. Cost each candidate _index layer_ — language census, symbol index, document graph — on that same repository, cold and warm. Step 5 costs the classifier; this costs the layers above it.
7. Answer the eight questions above in a decision table.
8. Split the result into executable plans, and say explicitly which consumers each unblocks.

Completion: a decision record with numbered decisions, a cost table from a real repository, and a list of the executable plans this becomes.

## What this plan does not do

- No implementation of anything. It produces decisions and follow-up plans.
- No change to the existing index, its watcher, or search behaviour.
- It does not pre-empt [Plan 088](088-native-code-intelligence.md). If that plan's semantic retrieval dictates the storage answer, this plan records that and defers.
