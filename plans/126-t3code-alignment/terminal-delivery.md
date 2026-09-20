# Terminal lifetime delivery

The detached ten-minute kill timer is removed, including its constructor option and test-only overrides. Disconnecting the last viewer stops process-name polling but retains the PTY and its worktree/provider lease. Explicit close, shutdown and actual process exit remain the cleanup boundaries. This matches the pinned terminal manager's attach unsubscribe behavior at `7445aa733ada33e45289e5aa5055f79142556513`, `apps/server/src/terminal/Manager.ts:2778`.

The focused terminal suite passed 46 cases after removal. An additional real native-shell case then passed with the 31-case service suite: set a shell variable, disconnect, advance the timer clock eleven minutes, reconnect and read the same variable. The fake-PTY case also verifies detached output replay and explicit shutdown. Agent tests retain exclusive provider ownership while detached and release it after confirmed process exit. Server typecheck passes.

This first lifetime slice was followed by the history, clear and restart deliveries below. Full attach snapshots remain open EXT-05 work; these deliveries do not close that group.

## Persistent history and shared clear

Migration 20 stores raw terminal chunks in SQLite, keyed by the same worktree/terminal ownership key as the live PTY. Retention is 8 MiB and 5,000 lines, with 16 KiB coalesced chunks. Appends commit before broadcast, preserving invalid and split UTF-8 bytes; a byte-limit cut avoids replaying a partial leading character. Persistence failures produce a visible error and structured operation warning. Reopened server-owned shells replay retained output and explicitly say a new process started.

Clear now commits history removal and broadcasts a reset to every viewer before asking the shell to redraw. It shares the owner's operation queue with Open and Kill, preventing clear-during-open from restoring an old in-memory snapshot. Explicit tab closure removes history after confirmed process exit and lease cleanup; shutdown and natural exit retain history. Kill returns an error when process/lease/history cleanup remains unconfirmed. The client checks that error response. The old Ctrl+L menu hint is removed because Ctrl+L remains a shell repaint and does not clear shared saved history.

Focused evidence: 35 service cases pass, including a real shell retained across an eleven-minute simulated disconnect, service restart, shared clear, concurrent open/clear, and injected history-delete failure. The earlier terminal/agent-history/migration run passed 69 cases before the final deletion-failure case was added. Four real-database history tests pass, including reopen, raw bytes, transaction rollback, line limits and 20 comparisons with the actual pinned `BoundedTerminalHistory` class. Thirteen terminal menu cases pass. Server/web typechecks and changed-file lint pass. `terminal-history` is registered for live proof in the next release.

An independent review found the open/clear race, orphaned history on tab closure and swallowed kill failure; all three have focused cases. Complete attach snapshot/sequence semantics, history control-sequence filtering and host-equivalence checks remain open. This delivery does not close EXT-05.

Live proof on `20260920T153923Z-b915d3e0-plan126-stash-notices-history`: `/work/tmp/fregat-evidence/20260920T154534Z-scenario-terminal-history/`. Four inspected screenshots and socket frames show owned shell output, a second viewer plus reconnect replay, Clear reaching both viewers, and an empty replay after reload. Cleanup returned 200 for the owned terminal's clear and kill. The log window includes older orchestration/LSP teardown entries, with no terminal error. This proves shared viewer/reconnect/clear behavior; service/database restart persistence is covered by the local real-database tests, not a live production restart scenario.

## Restart shell

Restart replaces the native process immediately, clears saved history and resets every attached viewer while retaining their connections and dimensions. The owner operation queue serializes restart with open, clear and kill. Failure closes all old viewers and reports the operation error. The TUI consumes the shared clear frame too.

All 38 service tests and 16 agent terminal/history tests pass, including a real shell variable disappearing after restart while its viewer connection survives. Web, server, contracts, client-core, TUI and scripts typechecks pass. The extended `terminal-history` scenario checks two viewers and fresh shell state after restart; live proof is recorded below.

Live restart proof on `20260920T155743Z-b915d3e0-plan126-final-batch`: `/work/tmp/fregat-evidence/20260920T160608Z-scenario-terminal-history/`. All five steps pass. The inspected final screenshot shows `RESTART_AFTER_unset`; recorded frames confirm both viewers receive a fresh ready frame and cleared history. Owned cleanup returned 200 for clear and kill. The single terminal warning is the owned shell receiving SIGHUP during explicit termination. This proves shell restart, not a production-service restart persistence scenario.
