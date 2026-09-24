# 145 · Approval rules

- Status: PROPOSED.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

Approving a tool call can save a rule, so the same call is not asked about again. "Allow for this
session" holds for the rest of the session on both providers. Rules live in each harness's own
rule store, not in a Platform copy.

## What exists today

- Decisions: `accept`, `acceptForSession`, `acceptAlways`, `decline`, `cancel`
  (`packages/contracts/src/orchestration-runtime.ts`). `DEFAULT_APPROVAL_OPTIONS` offers Cancel,
  Deny, "Allow for this session" and Allow; `pending-approval-panel.tsx` renders the request's
  options.
- Claude: `respondApproval` throws on `acceptAlways` ("This approval does not offer permanent
  access.", `apps/server/src/provider/adapters/claude.ts` ~717). `claudePermissionResult` sends
  `acceptForSession` exactly like `accept`: `{ behavior: 'allow', updatedInput }` with no
  `updatedPermissions`. The `suggestions` the SDK passes to `canUseTool` are never read.
- Codex: `acceptAlways` works only for MCP elicitation (`utils/codex-elicitation.ts` maps it to
  `always`); command and permission approvals throw on it (`codex.ts` ~3092). `acceptForSession`
  maps to `scope: 'session'` for `item/permissions/requestApproval`.

## Harness support

- Claude (verified in `sdk.d.ts`): `canUseTool` receives `suggestions?: PermissionUpdate[]`,
  documented as "if presenting the user an option 'always allow' … this full set of suggestions
  should be returned as the `updatedPermissions`". `PermissionUpdate` destinations are
  `userSettings | projectSettings | localSettings | session | cliArg`.
- Codex (verified in the installed 0.156.1 schema, absent from our pinned schema):
  `acceptWithExecpolicyAmendment` on command approvals, carrying the request's
  `proposedExecpolicyAmendment`; also `applyNetworkPolicyAmendment`.

## Decisions

- **D1 — Where a Claude rule is written.** Recommended: offer "Always allow in this project"
  (`localSettings`, `.claude/settings.local.json`) and "Always allow everywhere" (`userSettings`).
  Never `projectSettings`: that file is committed, so the rule would ship to everyone who clones
  the repository.
- **D2 — Is there a Platform rule editor?** Recommended: no, not in this plan. The rules are the
  harness's files; a later plan can show them. This plan only writes them from an approval.

## Steps

1. Verify first: in approval-required mode, approve a Bash call with "Allow for this session", then
   trigger the same call. Record whether Claude asks again. If it does, fix that before anything
   else by returning the `session`-destination suggestions for `acceptForSession`.
2. Claude: keep the `suggestions` on the pending approval; map `acceptForSession` to
   `updatedPermissions` rewritten to `session`, and the D1 decisions to the same suggestions with
   `localSettings` / `userSettings`. Offer the always options only when suggestions exist.
3. Codex: after the schema refresh (see the index), offer "Always allow this command" when the
   request carries `proposedExecpolicyAmendment`, answering `acceptWithExecpolicyAmendment`.
4. The request's options come from the adapter, so the panel shows only decisions that provider
   can honour. Delete the `acceptAlways` throw paths that become reachable-by-design.
5. Add the chosen destination and rule count to the approval wide event. Do not log tool input.

## Verification

- Server tests through the Claude `createQuery` seam: `acceptForSession` returns `session`
  updates; the always decisions return the chosen destination; no suggestions means no always
  option.
- Real run: approve with "Always allow in this project", confirm `.claude/settings.local.json`
  gained the rule and a new session does not ask. Remove the rule afterwards.
- `bun run agent:browser look` on the pending approval panel for both providers.

## Not copied

- LLM-judged risk (`chatToolRiskAssessmentService.ts` in VS Code): nondeterministic.
- OpenCode's generated bash arity table (`permission/arity.ts`): let each harness match its rules.
- A fourth "approve everything" mode: full-access already is that.
