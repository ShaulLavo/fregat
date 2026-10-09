# Let the query owner control cancellation

The query owns its in-flight request. A component or speculative navigation is one
consumer of that work; another consumer may still need it. Cancellation and permission
to publish a result are separate decisions.

Verified with query-core 5.104.0: setting `enabled: false` does not cancel an existing
request, and becoming stale does not abort it. When the final observer leaves, Query
cancels and reverts the query if its function consumed the supplied `signal`. Without
signal consumption, a successful in-flight read can finish and warm the cache.

Pass Query's signal to a transport that supports cancellation:

```tsx
const options = queryOptions({
  queryKey: ['search', searchTerm],
  queryFn: async ({ signal }) => {
    const response = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`, {
      signal,
    })
    return response.json()
  },
})
```

An aborted signal only stops underlying work when the transport honors it. Query
cancellation does not prove that a remote process stopped. Keep admission budgets and
resource disposal with the owner that can observe completion.

| Event                                                            | In-flight behavior                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| One observer leaves while another remains                        | Shared work continues.                                                                          |
| Final observer leaves after the query function consumed `signal` | Query cancels and reverts; a signal-aware transport aborts.                                     |
| Final observer leaves without signal consumption                 | The current read can complete and populate the cache.                                           |
| Query key changes                                                | The observer moves; the old query follows its remaining ownership and signal-consumption rules. |
| `enabled` becomes false                                          | Automatic fetching is disabled; an existing request is not canceled by this change alone.       |
| Cached data becomes stale                                        | Staleness affects freshness decisions; it does not itself cancel work.                          |
| `queryClient.cancelQueries()`                                    | Explicitly cancels matching queries, including ones with other consumers.                       |
| A refetch starts                                                 | Inspect `cancelRefetch` and existing data/in-flight state; cancellation is not unconditional.   |

Use explicit cancellation when the domain operation requires it, such as protecting an
optimistic cache write from an older read. Narrow the query filter and await cancellation
before writing. Avoid broad cancellation just because a hover, tab, or route was abandoned.
For shared preparation, let the existing query/resource owner account for its consumers.

Keep stale results from updating the wrong UI through result-changing query keys and,
for imperative publication, the current intent or generation check. A useful obsolete
read may remain cacheable while losing permission to select a tab or replace visible data.

Sources: [Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation),
[Inside a TanStack Router Navigation](https://tanstack.com/blog/tanstack-router-navigation-lanes).
