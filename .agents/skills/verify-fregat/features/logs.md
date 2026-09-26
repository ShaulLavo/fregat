# Logs

The structured log viewer in the sidebar.

## Sub-features

Event list with live tail, timeline and totals, search, and time range, level, source and area filters.

## How to get to it (user POV)

The Logs button in the sidebar rail.

## How to drive it

`logs-search-no-flicker` opens the pane, types a search one key at a time and samples every frame. The step label must read `blank-frames-0`: a filter change keeps the last events, totals and timeline up until the new answer lands.

`logs-panel` checks per-row and context-menu copying against the clipboard, clearing entries, row expansion, and keyboard navigation and context-menu access. Clearing affects only the panel; copying the visible list exports the filtered entries as JSONL.

`scenario tail-follow` scrolls the list away from the newest line, makes lines arrive through logged API requests, requires the "N new lines" pill and the same row under the top edge, then presses the pill and requires the list back at the top and following.
