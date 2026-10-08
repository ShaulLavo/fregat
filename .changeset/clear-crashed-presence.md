---
'@singapore-editor/collaboration': patch
---

Clear remote carets, names, and selections immediately on confirmed departure or membership eviction, retaining each peer's clock floor to reject delayed state replays. `Session.disconnect` now retains membership during the configured suspicion timeout so brief link interruptions preserve presence; reconnecting republishes current local presence, including removals made while disconnected, without waiting for regular renewal.

Custom `PresenceObserver` implementations must provide `connected()` to handle new or restored links.
