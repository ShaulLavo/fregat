# Query failures and render boundaries

In Platform, query/mutation failures are ordinary pane state. Follow AGENTS.md: render
pending before error before empty through shared primitives, and let retry call Query.
Use `RenderErrorBoundary` for render bugs. Do not add `throwOnError` or move every query
under Suspense to imitate a generic Router example.

For another application that deliberately uses Suspense queries, connect the error
boundary's reset with `useQueryErrorResetBoundary`. This permits retry; it is not equivalent
to deleting every errored cache entry. Keep the boundary below content that must stay mounted.
A suspense query with cached data can retain that data on a background error; do not assume
every failed fetch is thrown.

For a route-owned required read:

```tsx
loader: async ({ context: { queryClient } }) => {
  await queryClient.query(postQueries.list())
}
```

Let its failure reach the route's error UI. A loader retry must rerun loading, using the
installed Router retry/invalidation API; simply resetting a render boundary is insufficient.
If suspense consumers are present, reset their Query error boundary too.

For an optional route warmup, use explicit rejection handling and retain the pane's normal
query error UI. A preload failure should not make an otherwise valid destination unavailable.
See [imperative queries](imperative-queries.md) and the
[Router integration guide](https://tanstack.com/router/latest/docs/guide/external-data-loading).
