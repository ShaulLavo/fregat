# scenario editor-fast-scroll

After startup settles, wheel-scroll in 1,200px sweeps and alternating 6,000px jumps.
duration: 15348ms
result: failed: waitFor: Timeout 15000ms exceeded.
Call log:

- waiting for locator('[cmdk-item][data-selected="true"]').filter({ hasText: 'viewport-colors.ts' }) to be visible

steps:
failure capture: after scenario execution; scenario cleanup may have run
failure screenshot: /work/worktrees/platform/singapore-viewport-first/editor/docs/performance/singapore-viewport-first-2026-10-08/atomic-replacement/fregat/20261008T160620Z-scenario-editor-fast-scroll-bV2qp1/failure-after-scenario.png
failure metadata: /work/worktrees/platform/singapore-viewport-first/editor/docs/performance/singapore-viewport-first-2026-10-08/atomic-replacement/fregat/20261008T160620Z-scenario-editor-fast-scroll-bV2qp1/observed.json
problems:

- console warnings: ["No available adapters.","[.WebGL-0x1d5c0a57e000]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels"]

logs (warn+, 2026-10-08T16:06:20.774Z..now): none
api server: http://localhost:35749, throwaway state /tmp/fregat-agent-G7tp2x (removed after the run)
full log: /work/worktrees/platform/singapore-viewport-first/editor/docs/performance/singapore-viewport-first-2026-10-08/atomic-replacement/fregat/20261008T160620Z-scenario-editor-fast-scroll-bV2qp1/2026-10-08.jsonl
