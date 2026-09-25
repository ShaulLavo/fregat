# Plan 170: Language census for grammar and theme prefetch

Status: **proposed — split out of [Plan 110](110-workspace-indexing.md) question 7.** Decided 2026-09-25: owner — split the language census into its own small plan. [Root PLAN.md](../PLAN.md) owns scheduling.

## Why

The editor preloads every Shiki grammar and every theme after first paint
(`EDITOR_SHIKI_PRELOAD_LANGUAGES` in
[`shiki-languages.ts`](../apps/web/src/features/editor/utils/shiki-languages.ts), consumed by
`features/editor/state/syntax-highlighting.ts`). A TypeScript project needs about four grammars.
VS Code loads a grammar on the first file of that language; the goal is to be earlier than that
without being exhaustive.

Plan 110 names this the smallest consumer of a workspace index: a fold over extensions that
[`workspace-index.ts`](../apps/server/src/fs/workspace-index.ts) already holds, nearly free, and a
measurable win (110 questions 4 and 7).

## Scope

1. **The census.** Per workspace, count entries per language from what the index already holds.
   No new reads, no parsing. It inherits the index's readiness states (`cold`, `building`,
   `ready`, `stale`, `failed`), and a consumer can ask for them.
2. **The consumer.** The editor's grammar and theme prefetch reads the census and preloads the
   languages the workspace contains. When the census is not `ready`, it falls back to today's
   behaviour (110 question 6).
3. **The measurement.** Before and after, on a real repository: grammars loaded, bytes fetched and
   time to first highlighted paint, per [AGENTS.md § Optimization](../AGENTS.md#optimization-and-performance-work).

## Open questions

1. Where does the census cross to the client: a query of its own, or a field on an existing
   workspace response?
2. Which extensions count, and how are ignored and default-ignored entries treated?
3. Is there a floor below which a language is not prefetched?

## What this plan does not do

- It does not answer Plan 110's other questions (storage, symbol index, document graph,
  content classification). Those stay in 110's research.
- No change to the index's watcher or search behaviour.
