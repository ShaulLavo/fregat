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

## Research steps

1. Read the existing index end to end and write down its actual invariants, not its intended ones — especially what `stale` means to a consumer and when a rebuild is triggered.
2. Survey prior art with the same discipline used for markdown in [Plan 107](107-workspace-markdown.md): how VS Code's workspace symbol provider, ripgrep, and an Obsidian vault index each handle freshness and scale. Clone what is readable into `/work/projects/references/`.
3. Cost each candidate layer on a real large repository, cold and warm.
4. Answer the seven questions above in a decision table.
5. Split the result into executable plans, and say explicitly which consumers each unblocks.

Completion: a decision record with numbered decisions, a cost table from a real repository, and a list of the executable plans this becomes.

## What this plan does not do

- No implementation of anything. It produces decisions and follow-up plans.
- No change to the existing index, its watcher, or search behaviour.
- It does not pre-empt [Plan 088](088-native-code-intelligence.md). If that plan's semantic retrieval dictates the storage answer, this plan records that and defers.
