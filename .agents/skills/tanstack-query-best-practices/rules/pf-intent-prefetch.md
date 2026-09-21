# Prefetch on navigation intent

Use the same query options and owning client as the destination. Choose freshness in
those options so a consumer does not immediately refetch a successful warmup.

```tsx
const queryClient = useQueryClient()
const warm = () => {
  void queryClient.query(postQueries.detail(postId)).catch(() => undefined)
}
```

Call `warm` from the existing hover/focus affordance where likely navigation justifies the
work. Query records errors; this optional handler intentionally does not surface them.
Required reads should propagate errors instead. See [imperative queries](imperative-queries.md).

For a TanStack Router Link, prefer `preload="intent"` with a query-backed loader rather than
both a loader and a second event-handler fetch. Set `defaultPreloadStaleTime: 0` so Query
controls freshness. Arbitrary buttons and command actions do not become preload triggers
just because `defaultPreload` is configured; use `router.preloadRoute()` explicitly if needed.

Preloading must not select a tab, open a native picker, start a terminal, or mutate server
state. Measure the path before adding prefetch everywhere. Let Router/Pacer own any needed
intent delay instead of duplicating timers without cleanup.

[Official prefetching guidance](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
