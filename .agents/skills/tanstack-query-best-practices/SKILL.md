---
name: tanstack-query-best-practices
description: Use TanStack Query for async reads, resource loading, caching, and mutations in React or non-React code. Apply when adding or migrating query ownership, retries, preloading, or operation state.
---

# TanStack Query

## Check the API before choosing a pattern

Resolve the installed `@tanstack/query-core` version through the consuming package, then
read its declarations/source and current official docs. Do not assume all v5 releases
have the same APIs or that an old Router example is current Query guidance.

Verified on 2026-09-21 with query-core/react-query 5.102.8: use `queryClient.query()`
and `queryClient.infiniteQuery()` for imperative execution. The old fetch, prefetch,
and ensure methods are deprecated. Read [imperative queries](rules/imperative-queries.md)
when migrating them; error propagation, freshness, and `select` behavior differ.
If another project lacks the replacement, report the version constraint rather than
inventing a compatibility wrapper or silently upgrading dependencies.

## Choose ownership first

- React uses Query hooks; non-React code uses query-core clients and observers. Keep
  async pending/error state and retry policy there instead of in promise maps or stores.
- Use queries for reads, including local resource acquisition. Use mutations for effects
  and settle affected queries before success resolves. Follow the repository's intent
  queues and domain transaction rules rather than wrapping them in another mutation.
- Match cache scope to resource identity: environment, browser, or owned instance.
  Query GC does not dispose sockets, database handles, or highlighters.
- Include every result-changing input in keys. Share options between consumers and
  preloaders. Feature keys belong with the feature under this repository's AGENTS.md.
- Query functions resolve a defined value. For opaque runtime objects, choose
  `structuralSharing: false`, explicit disposal, and no persistence/dehydration.
- Local acquisition may need `networkMode: 'always'`; remote reads need their actual
  connectivity policy. Do not make all queries static or disable retries globally.
- Preserve stream projections, edit state, locks, and operation ordering. They are
  domain behavior, not redundant query caches.

## Read the relevant rules

- Imperative execution/migration: [imperative-queries](rules/imperative-queries.md).
- Key identity: [dependencies](rules/qk-include-dependencies.md),
  [serializability](rules/qk-serializable.md), [factories](rules/qk-factory-pattern.md).
- Cache policy: [freshness](rules/cache-stale-time.md), [retention](rules/cache-gc-time.md),
  [invalidation](rules/cache-invalidation.md), [placeholder data](rules/cache-placeholder-vs-initial.md).
- Operations: [mutation settlement](rules/mut-invalidate-queries.md),
  [mutation state](rules/mut-mutation-state.md), [optimism](rules/mut-optimistic-updates.md).
- Loading: [intent preloading](rules/pf-intent-prefetch.md),
  [error handling](rules/err-error-boundaries.md), [cancellation](rules/query-cancellation.md),
  [network mode](rules/network-mode.md), [page parameters](rules/inf-page-params.md).
- Only for SSR/persistence work: [dehydration](rules/ssr-dehydration.md),
  [persistence](rules/persist-queries.md).

Project instructions take precedence over generic examples, especially feature ownership,
render boundaries, loaders, and mutation settlement. Verify real cache behavior with the
installed client; a typecheck alone cannot prove freshness or deduplication.
