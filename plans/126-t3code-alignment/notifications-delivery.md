# Session notifications

EXT-06 browser implementation shipped in `20260920T153923Z-b915d3e0-plan126-stash-notices-history` and passed headed browser verification.

The coordinator watches canonical summaries for every connected owner. Initial and reconnect history establish a baseline; only synchronized shell streams become live. Attention follows the shared approval/input/runtime/background status policy, with failed turns classified as input notices. Completed timestamps and attention keys suppress duplicate delivery; archived sessions are silent.

Registry settings default off: `chat.notificationMode` controls native presentation and sound; `chat.inAppNotificationsEnabled` enables focused-window toasts for another session. An Open session action targets the scoped owner. Native presentation requires a hidden or unfocused page and granted permission; the settings control requests permission from a user gesture. The browser favicon counts pending native notices and clears on focus, native-mode changes and owner removal. Native click focuses the window and opens the owner/session. Sound unlocks from pointer/keyboard gestures, ignores focus, and rechecks the live mode after asynchronous decoding. Enabled setting changes retain the cursor and audio context. Listeners and audio are disposed with the coordinator.

The two sound files come from pinned T3 Code `7445aa733ada33e45289e5aa5055f79142556513`; its MIT notice is shipped in `public/licenses/t3code-notifications.txt`.

Checks:

- `bun scripts/parity/notifications.ts`: 900 comparisons against the actual extracted pinned decision block.
- Four focused tests cover native tags/permission/refusal/click/owner/focus cleanup, gesture unlock and mode changes, owner/reconnect tracking and real-engine completed turns.
- Three real-server shell tests prove caught-up streams become live and snapshot/replay data stay nonlive until the synchronized frame.
- Web and scripts typechecks, focused lint and the design census pass.
- Headed native browser proof: `/work/tmp/fregat-evidence/20260920T154618Z-scenario-session-notifications/`, completed in 5.9 seconds with no browser or application warnings/errors. Focused-other-session toast navigation, actual native Notification construction, one pending favicon badge, native click/focus cleanup, silent reload and archived completion all pass. Screenshots were read; the toast capture waits for its entrance animation and visibly shows the title, session and Open session action. Both native processes exited and both sessions/provider/settings were cleaned up.
- Headless Chromium denied notification permission and emulated focus on the source tab. The headed scenario grants permission and disables Chromium focus emulation before switching tabs. No application workaround was added for the verification host.

Host limitations: no macOS/Windows desktop bridge, dock/taskbar badge or activation claim. Headless browser notification construction does not prove visible operating-system popup delivery or audible speaker output. The single connected live owner cannot prove cross-machine navigation; owner identity is covered by scoped-key tests.
