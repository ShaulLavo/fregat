# Composer opt-in controls

The bounded INTERACTION-11 Plan/context defaults unit is deployed in `20260920T155743Z-b915d3e0-plan126-final-batch` and verified in the browser. Rich text, send shortcut modes and large-paste folding remain open.

`chat.planModeEnabled` and `chat.contextWindowMeterEnabled` default false. Plan controls and built-in `/plan` and `/default` commands require the setting and a selected provider whose `showInteractionModeToggle` is not false. The submitted interaction mode uses the same policy. Hidden controls leave the stored unsent preference intact; a submitted message captures its effective mode once. Existing plan display/follow-up and provider quota windows are unchanged. Context occupancy is gated in both the composer and stage header.

Checks: the actual pinned `resolveComposerInteractionMode` matches all 20 flag/provider/mode combinations; focused control, command and composer-layout tests pass. Web and script typechecks, changed-file lint and design census pass. `composer-defaults` is registered for native browser verification, including real token-usage publication and captured native collaboration mode.

The same registry edit adds `chat.responseStreamingMode` and `chat.projectResponseStreamingModes` for the independently owned response-delivery implementation; that unit owns its behavior and evidence.

Browser evidence: `/work/tmp/fregat-evidence/20260920T160544Z-scenario-composer-defaults/` completed in 3.36s. All three screenshots were inspected. The native fixture published valid token usage; default-hidden occupancy became visible at 11% in both composer and header. The Plan menu and slash command appeared only after opt-in. Hiding and restoring controls retained the unsent Plan preference; submitting with controls hidden produced native `collaborationMode.mode: default`. The selected fixture provider was verified in the browser's real `/providers` response before the drive.

Calibration failures were confined to verification setup: the first drive dismissed a menu before focus settled; the second fixture omitted required token-usage counters; the third selected a newly registered provider before its browser snapshot was available. The scenario now waits for menu dismissal, emits the full native usage shape, and the shared native helper reloads and checks provider discovery after external registration. Doctor passed before the final drive. These failures did not require production changes.

Cleanup removed the owned session and provider, restored both settings, and confirmed all three native processes exited. The final run recorded unrelated Git PR lookup and an older title-fixture session reaper warning; no composer or usage-schema errors appeared. The opt-in screenshot catches the menu's exit transition, while the Plan chip and both occupancy readings are visible. The other two screenshots show the controls hidden.
