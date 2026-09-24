# Plan 141: Usage, cost and rate limits

## Status and authorization

- Status: PROPOSED — Phase 1 (the meter) ready; Phases 2–4 start with a short research step.
- Priority: P1 for the meter, P2 for the usage page and history.
- Effort: S for Phase 1, M overall. Reset-credit redemption (Phase 5) is L and gated.
- Risk: LOW for display. HIGH only for Phase 5, which spends an account resource.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey (T3 Code,
  Orca, Codex, OpenCode, Crush, Serena).
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

The user can see how much of each account's plan window is left and when it resets, before the
agent stops mid-task. Later, a usage page answers "what did this week cost, per model" from data
Platform already receives.

## What exists today

- Both adapters already emit `account.rate-limits.updated`: Claude from the SDK's
  `rate_limit_event` (`apps/server/src/provider/adapters/claude.ts:849`), Codex from
  `account/rateLimits/updated` (`apps/server/src/provider/adapters/codex.ts:1122`, `:1409`).
- The payloads are typed upstream but passed through untyped. Claude's `SDKRateLimitInfo` carries
  `status` (`allowed | allowed_warning | rejected`), `rateLimitType` (`five_hour`, `seven_day`,
  `seven_day_opus`, …), `utilization`, `resetsAt` and overage fields. Codex's
  `CodexRateLimitSnapshot` (`codex-protocol/generated/schema.gen.ts:103`) carries `primary` and
  `secondary` windows, `credits` and `planType`.
- The web hides the event: `account.rate-limits.updated` is in `QUIET_ACTIVITY_KINDS`
  (`apps/web/src/features/chat/utils/activity-visibility.ts:9`). No quota UI exists.
- `context-usage-ring.tsx` (`apps/web/src/features/chat/components/`) shows context occupancy
  only, from `conversation.token-usage.updated` (`orchestration/provider-runtime-ingestion.ts:898`,
  `tokenUsageActivity` at `:1238`).
- Claude token usage is summed in `claudeTokenUsage` (`claude.ts:2429`). Nothing reads the SDK
  result's `total_cost_usd` or per-model `modelUsage` (each entry has `costUSD`, cache read and
  creation tokens, `contextWindow`).
- On-demand reads exist but are unused: Codex `account/rateLimits/read` is not in
  `codex-protocol/generate.ts`, and the Claude SDK exposes
  `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` (the name is the warning).

### Plan 126 rows

- `plans/126-t3code-alignment/runtime.md` RUNTIME-08 (account usage windows plus reset-credit
  redemption) and `interaction.md` INTERACTION-07 (quota limits shown apart from context) describe
  the same chain. **This plan owns both.** When a phase lands, mark the row in Plan 126's ledger as
  moved to Plan 141 with the phase that closed it. INTERACTION-07 closes with Phase 1; RUNTIME-08
  closes with Phase 5.
- `docs/t3code-chat-parity-gap-analysis.md` "Deliberate non-parity" rejected
  `adjacent-usage-analytics`: a transcript-scanning and pricing pipeline is a product of its own,
  and price tables go stale. Both reasons have weakened. Claude now reports its own cost estimate
  per model (`modelUsage[].costUSD`), so no price table is needed for Claude; T3 answered
  staleness by making prices user-editable (`usagePriceForm.ts`). The structural alternative the
  rejection proposed, recording per-turn tokens we already receive, is what Phase 3 does. Update
  that row to point here when Phase 3 starts.

## What the references do

| Reference | Feature                                                              | Paths                                                                                                             |
| --------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| T3 Code   | Usage page, per-model breakdown, editable prices, limits in composer | `apps/web/src/routes/usage.tsx`, `apps/web/src/components/usage/`, `apps/server/src/usage/`, `docs/user/usage.md` |
| Orca      | Rate-limit windows and usage per provider                            | `src/main/rate-limits`, `src/main/claude-usage`, `src/main/codex-usage`                                           |
| Codex     | `/usage`, on-demand `account/rateLimits/read`                        | `codex-rs/app-server-protocol/src/protocol/common.rs:1309`                                                        |
| OpenCode  | `stats` command, cost per session                                    | `packages/opencode/src/cli/cmd/stats.ts`                                                                          |
| Crush     | `stats` command                                                      | `internal/cmd/stats.go`                                                                                           |

## Scope

1. A quota meter per provider account, fed by the events above.
2. A usage page: tokens, cache savings, cost, per model and per day.
3. History that survives server restarts and covers imported sessions where the data exists.
4. Reset-credit redemption, only after an explicit owner go-ahead.

## Decisions

- **D1 — Where the meter lives.** Recommended: in the composer beside the context ring, visibly a
  different thing (T3 does the same). A warning surfaces when any window reports
  `allowed_warning` or `rejected`, through the existing notice tones, not a new banner style.
- **D2 — Key the state by account, not instance.** Recommended, as RUNTIME-08 already requires:
  two instances sharing a credential home share one meter. The instance-to-account mapping comes
  from the snapshot's account probe; never log or send credentials.
- **D3 — Cost source.** Recommended: the CLI's own estimate where it exists (Claude
  `modelUsage[].costUSD`), a user-editable price only for models with no estimate (Codex). Prices
  are one settings-registry entry, `application` scope, registered in the same pass as the page
  that reads it.
- **D4 — History source.** Recommended: record from ingestion going forward. Scanning provider
  transcripts to backfill is a research question, not a default.

## Research phase (before Phase 2)

- What each provider reports per turn and per session: Claude `result.usage`, `modelUsage`,
  `total_cost_usd` (cumulative per `query()`, resets on `/clear` and resume — read the latest,
  never sum); Codex token-usage notifications.
- Where the server can persist per-turn rows (what store the orchestration projections use) and
  what one row costs.
- Whether imported sessions (`orchestration/session-discovery.ts`) carry usage worth backfilling.
- Deliverable: a short section appended here with the row shape and store, then Phases 2–4
  refined.

## Phases

### Phase 1: Quota meter

1. Contracts: a normalized `ProviderUsageWindow` (`kind`, `utilization`, `resetsAt`, `status`)
   and a per-account usage snapshot. Map Claude's `SDKRateLimitInfo` and Codex's
   `CodexRateLimitSnapshot` into it in pure, tested functions.
2. Server: keep the latest snapshot per account from the existing events. Add Codex
   `account/rateLimits/read` to the generated methods for an explicit refresh. Leave the
   experimental Claude usage call out unless events prove too sparse.
3. Web: read the snapshot through a TanStack query; the meter uses `TickerNumber` and
   `tabular-nums` for percentages and reset countdowns. The raw activity stays hidden in the
   timeline.
4. Log: the snapshot update joins the existing wide event with window kinds and status, never
   account identifiers.

### Phase 2: Record usage per turn

Store the per-turn rows chosen in the research phase, from ingestion.

### Phase 3: Usage page

A settings-style tab (a `ToolPane` with `bg-background` at the call site) with totals, per-model
and per-day breakdowns, and the price editor from D3. Pending before empty; `LoadingState` for
the first load.

### Phase 4: History across sessions

Backfill from imported sessions only if the research found usable data.

### Phase 5: Reset credits (gated)

The RUNTIME-08 action: account-keyed serialization and an idempotency key, as a TanStack mutation
with a `scope`. Automated tests use boundary fixtures; nothing consumes a real credit.

## Verification

- Pure mapping tests for both payload shapes with captured fixtures and synthetic values.
- `MockProviderAdapter` emits `account.rate-limits.updated` so a scenario can drive the meter;
  `bun run agent:browser look` on the composer with a warning-state window; add a scenario under
  `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
- `bun run logs` shows the snapshot event with window kinds.
- Server changes deploy with `bun run deploy --server`, which drops live terminal and agent
  sessions; say so first.

## Out of scope and not copied

- T3's third-party usage proxy (`apps/server/src/usage/cliproxyApi.ts`).
- A hosted price feed. Prices come from the CLI or the user.
- Per-tool statistics (Serena's dashboard); revisit after Phase 3.
