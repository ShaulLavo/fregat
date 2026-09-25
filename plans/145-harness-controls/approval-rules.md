# 145 · Approval rules

- Status: IMPLEMENTED 2026-09-25, all five steps; D1 and D2 as recommended. PR #29.
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

## Progress

- Step 1, measured 2026-09-24 against `claude` 2.1.281 through the SDK: answering
  `{ behavior: 'allow' }` asked twice for the same Bash call in one session. Returning the
  suggestions rewritten to `session` asked once. The old "Allow for this session" did not hold.
- The CLI's suggestions mix destinations. A Bash call proposes its rule at `localSettings`, plus a
  `session`-scoped Read or `addDirectories` grant for the paths it touches. "Always" moves only the
  non-session entries (`localSettings` for the project, `userSettings` for everywhere) and leaves
  the harness's session grants alone. A command that reads outside the working directory is
  therefore asked about again in a new session, which is also what the CLI does.
- Real run: "Always allow in this project" wrote `Bash(touch marker-145.txt)` to
  `.claude/settings.local.json`, and a new session ran the command without asking.
- The new decision is `acceptAlwaysInProject`; `acceptAlways` means everywhere (Claude
  `userSettings`, Codex elicitation `always`). Claude offers "for this session" only when suggestions
  exist, and the always pair only when one is not session-scoped and `suppressAlwaysAllowRule` is
  unset. `respondApproval` rejects any decision the request did not offer.
- Wide event: `chat.pipeline.claude_session.approval.resolved` carries decision, destinations and
  rule count, never the rules.
- UI: scenario `claude-approval-rules` drives the real CLI (Haiku) through the panel on a
  disposable repository. It asserts the six options, the rule in `settings.local.json`, and a second
  session that is not asked. It passed on an isolated dev pair 2026-09-25.
- Step 3 needed no schema refresh. The adapter does not generate Codex's server requests; it reads
  approval params loosely, and the installed 0.156.1 sends `proposedExecpolicyAmendment` on
  `item/commandExecution/requestApproval`. With one, the approval offers `Always allow "<prefix>"`
  (`acceptAlways`), answered `{ acceptWithExecpolicyAmendment: { execpolicy_amendment } }`; Codex
  writes it to `~/.codex/rules/default.rules`. Without one, the default options stand. Every Codex
  approval now carries its options, and `respondApproval` refuses one it did not offer.
- Scenario `codex-approval-rules` drives real Codex the same way, restoring the rules file byte for
  byte. Both scenarios passed on an isolated dev pair 2026-09-25.

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
