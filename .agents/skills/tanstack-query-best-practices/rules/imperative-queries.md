# Imperative queries and deprecated API migration

Verified against installed query-core 5.102.8 and the
[current prefetching guide](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching).
Check the consuming package's installed API before applying to another project.

| Previous API                       | Replacement                                                   | Required decision                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchQuery(options)`              | `query(options)`                                              | Preserve freshness, retry, cancellation, and return value. New execution applies `select`; the old method returned query-function data.                     |
| `prefetchQuery(options)`           | `query(options).then(() => undefined).catch(() => undefined)` | Preserve its non-rejecting `Promise<void>` contract when callers rely on it. A fire-and-forget warmup can use `void query(options).catch(() => undefined)`. |
| `ensureQueryData(options)`         | `query(options)` with explicit freshness                      | The old default returned any cached value, including stale data. Use a per-call `staleTime: 'static'` only when that is the intended behavior.              |
| `fetchInfiniteQuery(options)`      | `infiniteQuery(options)`                                      | Preserve page parameters, page count, and result/selection semantics.                                                                                       |
| `prefetchInfiniteQuery(options)`   | `infiniteQuery(options)` with explicit rejection handling     | Preserve optional-warmup behavior and a void result where required.                                                                                         |
| `ensureInfiniteQueryData(options)` | `infiniteQuery(options)` with explicit freshness              | Audit cached pages and revalidation as for ordinary ensure calls.                                                                                           |

## Required data versus optional warmup

```ts
// Required read: the caller handles failure.
const result = await queryClient.query(options)

// Optional warmup: Query retains failure; the event handler does not reject.
void queryClient.query(options).catch(() => undefined)

// Optional warmup that must settle before proceeding, returning void.
await queryClient
  .query(options)
  .then(() => undefined)
  .catch(() => undefined)
```

Do not attach a catch to every migration: required route reads, saves, and admission reads
must not silently succeed on failure. Do not return a generic fallback from the query
function merely to suppress an error; that would cache the fallback as successful data.

## Freshness is a behavioral migration

`query(options)` uses freshness. A per-call `staleTime: 'static'` accepts any existing
cached data; it does not rewrite every observer's options. Use it only for an explicit
cache-presence contract, not to stop an unexpected refetch. `Infinity` still permits
invalidation-driven fetching; `'static'` is a different policy.

The old `revalidateIfStale: true` contract returned cached data immediately and refreshed
stale data in the background. Remove that obsolete option and implement the chosen policy
explicitly. For an unselected raw-data options factory:

```ts
const cached = queryClient.getQueryData(options.queryKey)
if (cached === undefined) return queryClient.query(options)
void queryClient.query(options).catch(() => undefined)
return cached
```

The background call retains the real `staleTime`, so fresh data is reused. An existing
observer may already own this refresh; avoid a second path if it suffices. Selected data
requires consistent transformation on both branches. Do not assume the example above is
correct for options containing `select`.

Do not use `use(queryClient.query(...))` as a replacement for hooks: imperative calls need
not return a stable promise identity. Use `useQuery` or the project's approved suspense API.

## Verification

Test the actual owner: concurrent same-key callers execute once; fresh data is reused;
stale data follows the chosen policy; failures propagate or are intentionally swallowed;
and cached raw data remains distinct from selected results. Cover missing data,
revalidation, and page parameters for any ensure/infinite call being migrated.

During a repository-wide migration, include tests and examples. Add a narrow executable
lint/check against deprecated member calls, including optional/computed access and aliases
supported by the codebase. Test that it rejects a representative forbidden call and accepts
the replacement. Do not ban unrelated methods merely because their name contains “fetch”.
