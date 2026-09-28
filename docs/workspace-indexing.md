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
a click may share the same query, so speculative eviction cannot cancel its load. See
[prefetch ownership](prefetch-every-press.md) for current consumers.

## Evidence and remaining work

The retired [two-client plan](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/plans/173-two-devices-one-workspace.md)
records the `workspace-two-roots` scenario and ownership decisions. The retired
[large-folder plan](https://github.com/ShaulLavo/fregat/blob/8ca59fd7df915cccae0f3b920b8746c7a7651956/plans/175-large-folder-open.md#progress-2026-09-26)
records the watch-worker, unreadable-child, switch and prefetch scenarios plus review fixes.
These are historical measurements, not a new certification of the current build.

[Plan 110](../plans/110-workspace-indexing.md) owns further index capabilities;
[170](../plans/170-language-census.md) owns language census and remaining measurement;
[177](../plans/177-prefetch-every-press.md) owns intent preparation. Their open work remains in
those plans.
