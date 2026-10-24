# Workspace indexes and large-folder opening

The server owns one workspace index per root. Each client's project event stream holds its
root's scope through `apps/server/src/fs/workspace-index-scopes.ts`. `files.searchIndexLimit`
bounds retained indexes, and `files.searchIndexIdleMinutes` controls their warm lifetime after
the last holder leaves. Two clients can use different roots without superseding each other.
The old server-global open generation and `superseded` response are removed.

Recursive watching is bounded by `files.watchDirectoryLimit`. Roots that exceed the available
watch budget open with limited live updates; opening a directory refreshes its listing. Watch
worker failure releases its allocation, and settings changes rebalance existing roots. Unreadable
children have explicit access states rather than making the whole root fail to open.

A pending workspace switch retains the previous subject and shields it during the switch.
Directory prefetch admits at most four concurrent speculative listings and skips excess guesses;
a click may share the same query, so speculative eviction cannot cancel its load.
