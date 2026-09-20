# LIFE-12 bounded common actions

The shared session row/header menu now offers Copy Path, Copy Branch when known, and Copy Session ID. Values come from the owning rail item: worktree path, branch, and raw session ID. Existing clipboard feedback reports success or failure. The existing New Session action preserves the selected session's worktree.

The pinned `threadActionMenu.logic.ts` at `7445aa733ada33e45289e5aa5055f79142556513` defines these copy actions and project settings. It does not define a duplicate-session action. Local settings currently lack an owner-scoped project destination; a global settings shortcut would not establish that behavior, so Project settings remains open.

Thirteen pure menu tests and six existing real-server menu component tests pass. The `session-navigation` browser scenario now checks actual clipboard path, branch and ID values and captures the menu. Live copy and navigation steps passed on `20260920T151610Z-b915d3e0-plan126-titles-files`, evidence `/work/tmp/fregat-evidence/20260920T152347Z-scenario-session-navigation/`. All four screenshots were inspected; actual clipboard values matched owner path, branch and session ID. All three disposable sessions were removed. No application warn/error events occurred in this run.

Remaining LIFE-12 work includes meaningful abandoned drafts in the rail, recovery after reload, inline orphaned-worktree cleanup accounting for archived/surviving references, and session-owned terminal cleanup mapping. Ordinary local terminals belong to worktrees, so deleting every shell in the worktree would be incorrect. Existing durable provider/blob deletion cleanup remains in place. This unit does not establish full LIFE-12 conformance.
