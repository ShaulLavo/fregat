# Plan 141: Usage, cost and rate limits

## Status and authorization

- Status: PHASES 1–4 IMPLEMENTED (meter 2026-09-24; per-turn recording, the usage page and
  backfill 2026-09-25). Phase 5 (reset credits) waits for the owner: it spends account credit.
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
- **D3 — Cost source.** The CLI's own estimate wins. Otherwise standard API rates come from
  models.dev, refreshed in the background with a persisted cache and bundled fallback. Each
  turn saves its cost and rate snapshot. Unknown prices stay null. The manual price setting
  and editor were removed; Usage is a report in Settings, not a registry entry.
- **D4 — History source.** Recommended: record from ingestion going forward. Scanning provider
  transcripts to backfill is a research question, not a default.

## Research phase (before Phase 2)

Reference notes gathered 2026-09-25, for the row shape:

- OpenCode stores `cost` and `tokens {input, output, reasoning, cache{read,write}}` on each assistant
  message and each step, and rolls them onto the session row with signed SQL increments
  (`packages/core/src/session/projector.ts`). Prices come from models.dev with a bundled fallback;
  input is charged net of cache reads and writes.
- Crush overwrites session token counts per step (they are context size, not totals) and only
  sums cost; its stats queries count top-level sessions only.
- Orca scans `~/.claude/projects/**/*.jsonl` and Codex rollouts incrementally (mtime, size, byte
  offsets), dedupes Claude rows by `messageId:requestId`, and prices with hard-coded tables.
- Claude's `total_cost_usd` is cumulative per `query()` and resets on `/clear`: read the latest,
  never sum. `get_usage.session.model_usage` carries the same per-model totals on demand.

- What each provider reports per turn and per session: Claude `result.usage`, `modelUsage`,
  `total_cost_usd` (cumulative per `query()`, resets on `/clear` and resume — read the latest,
  never sum); Codex token-usage notifications.
- Where the server can persist per-turn rows (what store the orchestration projections use) and
  what one row costs.
- Whether imported sessions (`orchestration/session-discovery.ts`) carry usage worth backfilling.
- Deliverable: a short section appended here with the row shape and store, then Phases 2–4
  refined.

### Research outcome (2026-09-25)

- **What arrives.** Claude's result carries `modelUsage` per model — covering subagents and
  auxiliary calls, with the CLI's `costUSD` — cumulative per `query()`. Its `usage` field is the main
  loop only, so it is not the source. Codex's `thread/tokenUsage/updated` carries `total` per thread
  (root and each child agent), cumulative; Codex reports no cost. Both keep counting across a
  resume: Claude continues "the total its transcript saved", Codex restores `token_info` from the
  rollout (`codex-rs/core/src/session/mod.rs`, `last_token_info_from_rollout`).
- **So a turn is a difference.** Adapters emit `usage.totals` at the end of each turn: the running
  totals per model, each tagged with its scope (Claude conversation id, which `/clear` changes;
  Codex thread id). The recorder subtracts a persisted baseline per session, scope and model.
  A total below its baseline is a restart and counts in full; an all-zero reading (a crashed
  query) is ignored; a resumed scope with no baseline seeds one and records nothing, so a
  conversation older than the recorder never lands as one enormous turn.
- **Row and store.** `provider_usage_turns` in the platform SQLite database, keyed by session,
  turn and model: provider instance, driver, account key, `recorded_at`, input (excluding cache),
  output (including reasoning), cache read, cache write, reasoning, and `cost_usd` (the provider's
  estimate, null for Codex). Not a projection and not tied to the session row: spent money stays
  spent after a session is deleted. One row is about 200 bytes; `provider_usage_baselines` holds
  one small row per session, scope and model.
- **Imported sessions.** Backfill is possible: Claude transcripts carry `message.usage` per
  assistant row (deduplicate by `messageId:requestId`, as Orca does) and Codex rollouts carry
  `token_count` events. Neither carries a cost for Codex. That stays Phase 4.
- **Utility generations are recorded too** (2026-09-25). Title and commit-message generation run
  as text-generation tasks that never reach runtime listeners, so `ProviderService.subscribeUsage`
  carries usage from every turn it runs, each labelled `turn`, `title` or `commit-message`
  (`purpose` column, migration 22). T3 counts Claude's only by accident — `claude -p` leaves a
  transcript its scanner reads, unlabelled — and never Codex's, which runs `--ephemeral`.
- **Known gaps.** A child agent's usage lands with the next root turn end. The first turn after resuming a pre-recorder conversation
  is not recorded (its baseline is seeded instead).

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

Delivered 2026-09-24. `ProviderUsageWindow` and the per-account snapshot live in
`packages/contracts/src/provider-usage.ts`. Each adapter maps its own payload at the edge
(`apps/server/src/provider/utils/usage-windows.ts`), so `account.rate-limits.updated` carries typed
windows and the `runtime_event` wide event names them as `id:status`. `ProviderUsageStore` folds
them per account. The key is a hash of the driver and its credential paths, so instances that share
a home share one meter. `GET /providers/usage` serves the store. A Codex session reads
`account/rateLimits/read` when it opens; the generator now handles parameterless requests. The
composer gauge sits beside the context ring, refetches when the drafting session's turn settles, and
opens a popover with one row per window. Evidence: scenario `chat-usage-meter`, unit tests for both
mappings, the merge, the store and the web helpers.

Revised 2026-09-25 after comparing T3 Code, Orca and Codex's own TUI:

- **Probes seed the store.** The SDK documents `rate_limit_event` as "emitted when rate limit info
  changes", and T3's fixtures show rejections arriving without a utilization, so events alone leave
  Claude's meter empty. Adapters now have `readUsage()`: Claude runs `get_usage`
  (`usage_EXPERIMENTAL…`, `skipBehaviors`) on the never-yielding probe, Codex runs
  `account/read` then `account/rateLimits/read`. `ProviderUsageStore.read()` probes an account at
  most once per five minutes, only while something asks, and waits at most 6 s. A failed probe keeps
  the known windows; an API key or signed-out home is `unsupported` and shows nothing. The Codex read
  at session open is gone: the probe replaced it. Measured on the dev server: Claude 1.2 s (session,
  weekly, Fable), Codex 2.8 s.
- **A rejection is a stop only when nothing pays for it.** Claude overage (`overageStatus`,
  `isUsingOverage`, `overageInUse`), Claude extra usage, and Codex credits turn a spent window into
  `warning`. A rejection without a utilization updates only the status unless it stops the turn.
- **The overage-included bucket is named by `get_usage`** (`model_scoped[].display_name`); the stream
  event is dropped until a probe has named it.
- **Expiry and staleness.** A window whose reset has passed leaves the answer, on the server and live
  in the client. `checkedAt` replaces `updatedAt`; the popover says "Checked 4m ago" and, past
  fifteen minutes (Codex's `/status` threshold), "may be out of date".
- **Thresholds.** The provider's status wins; otherwise warning from 75% (Codex's floor), red at 100%.
- **Long turns.** A running session refetches every 60 s, every 15 s once a window passes 90%
  (Codex's TUI polls 60/30/15/5 s by band).
- **The stop is explained.** A Codex turn failing with `usageLimitExceeded` says which limit and when
  it resets, plus the next step for workspace credit or spend stops, instead of OpenAI's sentence.
  A Claude rejection that parks the turn emits one runtime warning per window and reset.

Not copied: Orca reads Claude's OAuth token from the keychain or `.credentials.json` and calls
`api.anthropic.com/api/oauth/usage`, falling back to typing `/usage` into a hidden terminal. The SDK
call reads the same data without touching credentials. T3's pooled hub accounts are out of scope.
T3's pace marker (use ahead of or behind elapsed time) belongs to Phase 3.

### Phase 2: Record usage per turn

Delivered 2026-09-25. `usage.totals` from both adapters (`utils/usage-totals.ts`),
`ProviderUsageRecorder` (`provider/usage-recorder.ts`) subscribed beside the usage store, migration
21 with both tables. Tests cover the delta rules (restart, zeroed reading, resumed scope, separate
models, a repeated turn end adding) against a real in-memory database, and both adapters' emission.
Each recording joins the `chat.pipeline.provider_usage.recorded` event with models, tokens and cost.

### Phase 3: Usage page

A settings-style tab (a `ToolPane` with `bg-background` at the call site) with totals, per-model
and per-day breakdowns, and the price editor from D3. Pending before empty; `LoadingState` for
the first load. Reads `provider_usage_turns` through one aggregate query (range, group by day and
model, local-day boundaries from the client's offset). Codex rows price from the D3 setting at read
time, never stored, so a corrected price corrects history. Consider T3's pace marker on the
plan-window rows. Record text-generation turns first if their cost should appear.

Delivered 2026-09-25 as Settings › Usage rather than a new tab kind: a tab kind would have
dragged document identity, codecs and the address grammar into something that is not a
document, and the settings widget machinery already hosts whole sections (Machines,
Providers). The `usage.modelPrices` key (application scope, widget `usage`) is the D3 price
list; its row renders the page. `GET /providers/usage/history?days&utcOffsetMinutes` is one
grouped read (`ProviderUsageHistoryReader`): viewer-local days, per-model rows with a
`costSource` of `provider`, `price` or `none`, purposes, distinct turns, and `unpricedTokens`
so a total never hides what it leaves out. The page: 7/30/90-day range, headline, a one-series
day chart (cost, or tokens when nothing is priced) with a label per bar, model and purpose
rows, and a price editor for every model with no cost of its own. `workspace.showUsage` and
the meter popover's "View usage" open it. Scenario `settings-usage` asserts the real read is
200, then drives a fixed month; `chat-usage-meter` follows "View usage". Windows now carry `windowMinutes` (Codex
`windowDurationMins`; Claude's from its ids: `five_hour` 300, `seven_day…` 10080), so each
gauge row shows T3's pace marker: a tick where even spending would stand, and "Ahead of
pace · runs out in 2d 6h" when use outruns time (hidden once a window is spent). The
composer's control row is one line at every width: the model name is the only element that
shrinks (Button is `shrink-0` by default, so the picker says `shrink`), under 520px labels
give way to icons in two steps, and under 300px the two read-only gauges hide so every action
keeps its place. Scenario `chat-composer-narrow` drags the chat side panel from 600 to 200px
and fails on any control that leaves the row or wraps.

### Phase 4: History across sessions

The research found usable data (see the outcome above). Backfill writes the same rows, with a
source column so an imported turn is never counted twice when a session is later continued here.

Delivered 2026-09-25 (lane L3). Import writes what an imported chat spent. After discovery imports
a session's history it calls `ProviderService.importSessionUsage`, which asks the adapter's
`readSessionUsage` and hands the turns to the recorder through `subscribeImportedUsage`.

- Claude: the discovery worker reads the transcript files themselves, since the SDK's messages
  carry no timestamps. It reads `<config>/projects/*/<session>.jsonl` and its `subagents/` files,
  bills each API response once by message id, and gives subagent responses to the prompt that was
  running.
- Codex: the rollout path comes from `thread/read`. It is streamed, only the usage lines are
  parsed, and a turn is the growth of the thread's running totals. On a 228 MB rollout the turns
  summed exactly to the final total (443 ms).

Rows are `source: 'import'` (migration 26), keyed `import:<prompt>`, and priced from the catalog.
A re-read replaces only its own rows. A session continued here is never imported again, and its
first live totals only seed a baseline, so nothing is counted twice. Import now invalidates the
usage report. Tests: `utils/tests/imported-usage.test.ts` and `tests/usage-recorder.test.ts`.
Scenario `claude-usage-import` imports a fixture instance's transcript and reads 3k tokens,
2 turns and $0.0070 on the usage page. Gaps: Codex child-agent rollouts are separate files and
are not read, and a session imported before this build gets its usage when its history next changes.

### Phase 5: Reset credits (gated)

The RUNTIME-08 action: account-keyed serialization and an idempotency key, as a TanStack mutation
with a `scope`. Automated tests use boundary fixtures; nothing consumes a real credit.

## Verification

- Pure mapping tests for both payload shapes with captured fixtures and synthetic values.
- `MockProviderAdapter` emits `account.rate-limits.updated` so a scenario can drive the meter;
  `bun run agent:browser look` on the composer with a warning-state window; add a scenario under
  `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
- `bun run logs` shows the snapshot event with window kinds.
- Server changes deploy with `bun run deploy --server`.

## Out of scope and not copied

- T3's third-party usage proxy (`apps/server/src/usage/cliproxyApi.ts`).
- A hosted price feed. Prices come from the CLI or the user.
- Per-tool statistics (Serena's dashboard); revisit after Phase 3.

### Automatic pricing (2026-09-25)

Replaces the manual pricing implementation described in Phase 3. `ProviderPriceCatalog` reads
models.dev through TanStack Query, retains the last good catalog in SQLite, and falls back to
`provider/model-prices.json` offline. Refresh the bundled snapshot with
`bun apps/server/scripts/update-model-prices.ts`. Model lookup uses provider and exact model ID.

The recorder pins standard API rates and their retrieval time to each turn. Repeated completion
events keep the original rate, and changing the catalog never reprices recorded history. The
provider's own estimate takes precedence. Context-dependent and service-tier billing cannot be
derived from cumulative turn tokens, so catalog amounts are labelled Estimated API cost. Older
turns without a recorded cost remain unknown; no price is invented for historical usage.

Settings retains the searchable Usage report without a dummy registry key. Unknown-only totals,
days and purposes stay null, while mixed totals disclose excluded tokens. The browser scenario
checks provider, catalog and unknown rows and the removal of price inputs.
