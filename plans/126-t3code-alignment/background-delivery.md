# Background liveness and periodic cleanup

Implementation in progress for RUNTIME-07 and the background status portion of LIFE-03. This is not a whole-group parity claim.

The provider service now tracks live child agents and monitor tasks separately from its parent turn. Nested agents can outlive a parent. Idle or completed tasks leave the live set, and late metadata cannot resurrect them. Runtime start, exit and successful stop clear the registry. Claude task updates retain their known task type, and completed task-tool items clear their synthetic activity.

The shell publishes the derived status. Pending approvals and user questions outrank background work; a completed parent can show Working or Monitoring. The registry is process-owned and is rebuilt from current native events after restart.

The reaper checks every five minutes, joins overlapping sweeps, and skips live background work. It rechecks each candidate after earlier asynchronous stops and checks eligibility again after awaiting a pending launch. Shutdown clears the timer and waits for its sweep.

Verification so far:

- `bun scripts/parity/background.ts`: 720 transition comparisons against the actual pinned upstream liveness function, with three negative controls.
- Focused provider registry, reaper and service tests pass. A real mock-adapter runtime survives the thirty-minute boundary, is reclaimed by the next periodic sweep without another launch, and leaves no timer after shutdown.
- Claude SDK-boundary tests exercise monitor progress, completion and late metadata.
- Rail model and streaming tests pass, including background precedence and no render churn for message deltas.

Live native-child proof passed on release `20260920T142351Z-b915d3e0-plan126-ordering-questions`: `/work/tmp/fregat-evidence/20260920T142923Z-scenario-background-liveness`. The browser showed a completed parent still Working while its child ran, then Ready after native child idle; late metadata and reload kept it Ready. Screenshots were inspected, fixtures cleaned, and no application warnings/errors were captured. Monitor-only native Codex wire proof is unavailable in the current adapter protocol; the Claude SDK boundary and registry cover its classification. Automatic session settlement remains separate work.
