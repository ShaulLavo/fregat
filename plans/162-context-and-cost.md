# Plan 162: Context and cost that tell the truth

## Status and authorization

- Status: PROPOSED — the owner approved the direction on 2026-09-25 ("some good ideas, plan
  that, but we like our ticker"). D1–D3 accepted as recommended the same day.
- Priority: P2 in the UI refresh lane.
- Effort: M. One adapter mapping, a wider context payload, a session filter on the usage read,
  and popover and usage-page changes.
- Risk: LOW. Everything is display. Server changes deploy with `bun run deploy --server`.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Research:
  [ai-elements.md](../docs/ui-research/ai-elements.md) item 2,
  [tinkerers-ui.md](../docs/ui-research/tinkerers-ui.md) item 2,
  [scrimui.md](../docs/ui-research/scrimui.md) (the `cost-meter` and `context-usage` rows),
  [creative-tim.md](../docs/ui-research/creative-tim.md) items 1–2 and
  [neon-ui.md](../docs/ui-research/neon-ui.md) item 8.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

- **The context ring says what fills the window.** Input, cached input and output (with reasoning
  inside output) appear as rows, and so does Claude's own split: system prompt, tools, memory
  files and messages. Rows a provider did not report are left out, never shown as zero.
- **100 % means the point where the provider compacts or stops**, not the raw window, so the
  last 20 % of the ring is room the user can actually use.
- **An estimate says it is one.** A snapshot the provider did not measure is marked, not rounded
  into a fact.
- **The popover shows what this session has cost so far**, on the same `TickerNumber` as the
  ring and the meter.
- **The usage page shows its arithmetic:** quantity × rate, the estimate labelled as an estimate,
  sub-cent amounts with real digits, a long model list folded after the top rows, and no unpriced
  day that looks like a quiet one.

**Kept, deliberately:** `TickerNumber` stays on live totals. Scrim UI's `cost-meter` says not to
animate a subtotal counting up mid-stream, because a smoothly counting number looks settled. Our
ticker does not count through made-up intermediate values. It rolls the digits to the value the
provider actually reported, so every number on screen is a real reading.

## What Plan 141 already covers (not repeated here)

[Plan 141](141-usage-and-rate-limits.md) Phases 1–3 shipped the quota meter
(`features/chat/components/usage-limits-meter.tsx`), per-turn recording (`provider_usage_turns`,
`ProviderUsageRecorder`) and Settings › Usage (`features/settings/components/usage-section.tsx`).
These honesty rules are already true there:

- **Unknown is not $0.** A model with no cost of its own and no price reads "No price"
  (`formatModelCost`, `features/settings/utils/usage.ts:39`), and the headline states the tokens
  it leaves out (`usage-summary.tsx`, `unpricedTokens`).
- **Cached input is priced at the cache rate** (`priceCost`, `apps/server/src/provider/usage-history.ts:163`).
- **Reasoning is counted inside output.** The row stores output including reasoning, plus
  reasoning on its own.
- **Staleness is stated** on the meter ("Checked 4m ago", "may be out of date").

Plan 141 Phase 4 (backfill) and Phase 5 (reset credits) stay there. This plan owns the context
ring, the session total, and the usage page's presentation.

## What arrives today

- **Codex** sends `thread/tokenUsage/updated` with `last` and `total` breakdowns (`inputTokens`,
  `cachedInputTokens`, `outputTokens`, `reasoningOutputTokens`, `totalTokens`) and
  `modelContextWindow` (`adapters/codex-protocol/generated/schema.gen.ts:2301-2321`).
  `tokenUsageSnapshot` (`apps/server/src/provider/adapters/codex.ts`, just below the
  `:3242` comment) already maps all four into the payload. No segment split exists.
- **Claude** sends two snapshots per turn:
  1. On the result message, `claudeTokenUsage(message.usage)` (`claude.ts:2632`), which spreads
     the raw snake_case record (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
     `cache_read_input_tokens`) and adds `usedTokens` as their sum. It carries no window.
  2. `emitContextUsage` (`claude.ts:2054-2080`) calls `query.getContextUsage()` and forwards only
     `maxTokens` and `totalTokens`. The SDK's response
     (`SDKControlGetContextUsageResponse`, `@anthropic-ai/claude-agent-sdk` `sdk.d.ts`) also
     carries `categories[]` (`name`, `tokens`, `kind: 'used' | 'free' | 'buffer' | 'deferred'`,
     where `buffer` is the compaction reserve), `rawMaxTokens`, `percentage`, `memoryFiles`,
     `mcpTools`, `systemPromptSections` and `agents`. All of that is dropped today.
- **The web** parses one schema (`packages/client-core/src/chat/context-usage.ts`). It reads
  camelCase fields only, so Claude's snake_case per-turn fields never parse. It then discards
  input, output, reasoning and cached tokens anyway: `ContextUsage` keeps only `usedTokens`,
  `maxTokens`, `ratio`, `totalProcessedTokens` and `compactsAutomatically`.
  `context-usage-ring.tsx` shows one percentage and a "used / max" line.
- **The usage page** formats cost with `formatUsd`, which prints `<$0.01` under a cent. The model
  list shows every model. The day chart (`usage-day-chart.tsx`) draws cost bars whenever any cost
  exists, so a day with only unpriced Codex usage draws no bar and reads as a quiet day.
- `MockProviderAdapter` (`adapters/mock.ts`) emits no token usage, so no scenario can drive the
  ring.

## 1. Context breakdown

- **Adapter edge.** `claudeTokenUsage` maps to the camelCase fields: `inputTokens`,
  `cachedInputTokens` (cache read), a new `cacheWriteTokens` (cache creation) and `outputTokens`.
  It keeps `usedTokens` and drops the raw spread, so the payload has one shape per field.
  `emitContextUsage` forwards `categories` as `{ name, tokens, kind }`. It is optional in the schema:
  Codex never sends it.
- **Client.** `ContextUsage` keeps `inputTokens`, `cachedInputTokens`, `cacheWriteTokens`,
  `outputTokens`, `reasoningOutputTokens` (each `number | null`) and `segments` (a list or null).
  `contextUsageForActivities` carries the newest known breakdown the same way it already carries
  the newest known window: Claude's two snapshots each hold half the picture.
- **Popover** (`context-usage-ring.tsx`):
  - One `role='meter'` bar split into segments, then one legend row per segment (Tinkerers'
    `token-meter`). Segments come from Claude's `kind: 'used'` categories. The `buffer` category
    is drawn as the reserve at the end of the bar, and `free` is the track. `deferred` rows are
    listed below the bar, because they are not in the window. Classify on `kind`, never on the
    English `name` (the SDK's own instruction).
  - When there are no segments (Codex), a token-type block instead: input, cached, output, and
    "of which reasoning" under output. A row the provider did not report is omitted.
  - The warning tint starts before the bar is full. `contextUsageTone`'s 70 % and 90 % stay, but
    they are now measured against D1's window.
- Everything in the popover follows the existing rules: `tabular-nums`, `TickerNumber` only for
  values that update under a stable element, and theme tones (`bg-muted` track, status tokens for
  the fill).

## 2. Fullness against the usable window (D1)

- **Claude:** the reserve is the `buffer` category. First measure what `percentage`,
  `totalTokens / maxTokens` and `rawMaxTokens` mean on a live session. The SDK may already exclude
  the buffer, and dividing twice would be the bug.
- **Codex:** the TUI subtracts a 12 000-token baseline from both sides
  (`percent_of_context_window_remaining`, `references/codex/codex-rs/protocol/src/protocol.rs:2446`).
  Core caps the window at `effective_context_window_percent` of the model window
  (`core/src/session/context_window.rs:85`). Check whether app-server's `modelContextWindow` is
  already the effective window before applying either.
- The popover names the reserve ("Reserved for compaction: 13k"), so the ring's 100 % has a
  stated reason.

## 3. Estimates are marked

- Claude's result-message snapshot is the turn's summed usage. On a turn that makes several API
  calls that is not occupancy. Confirm it on a multi-tool turn. If it overstates, the ring shows
  it only until `getContextUsage` lands, marked `estimated: true`. The ring then shows `~` before
  the number and the popover says "estimate until Claude reports".
- Any snapshot without a window keeps today's "window size unknown" wording.

## 4. This session's total

- A session filter on the usage read. Either `GET /providers/usage/history` gains `sessionId`, or
  a sibling `GET /providers/usage/session/:id` goes through `ProviderUsageHistoryReader`. Both use
  one grouped query over `provider_usage_turns`, priced exactly as the page prices.
- The web reads it through a query in `features/chat/utils/query-keys.ts`. It refetches when the
  session's turn settles, the same trigger the meter uses.
- The popover row reads "This session: 1.2M tokens · $0.84". Cost uses `TickerNumber`. Unknown
  cost says "No price", never `$0.00`. Unpriced tokens are named, as the page does.
- A per-turn `tokens · $cost` suffix on the work log (Creative Tim) is not included. The session
  total answers "what did this cost" without a number on every row.

## 5. Usage page honesty

In `features/settings/components/usage-*.tsx` and `features/settings/utils/usage.ts`. The div-bar
chart stays. Neon's charts are recharts, which we are not adding.

- **Sub-cent digits.** Under a cent, `formatUsd` shows two significant digits (`$0.0042`) instead
  of `<$0.01`. It still shows `$0.00` only for a real zero.
- **Estimates labelled.** The headline reads "Estimated cost". The Claude figure is the CLI's own
  estimate, and a price-based figure is the user's price.
- **Quantity × rate.** A `price`-sourced model row's `title` (and an expanded detail, if D3 adds
  one) reads `1.2M in × $1.25 + 400k cached × $0.125 + 90k out × $10 per 1M`. A `provider`-sourced
  row says "Claude's estimate".
- **Recording lag stated.** A footer line says a turn is counted when it ends, and that a child
  agent's usage lands with its parent's next turn end (Plan 141's known gap). There is no
  metering-lag note like Neon's: we record locally, with no billing delay to disclose.
- **Top N, then the rest.** The model list shows the top 5 by cost (then tokens). The rest fold
  into a single "12 more · $0.31" row that expands in place. A muted totals row closes the list.
- **No unpriced day reads as quiet.** When the bars measure cost, a day with only unpriced usage
  draws a muted marker at the baseline, labelled "4.1M unpriced tokens" in its tooltip.
- **Units never add.** Tokens and dollars never share a total. The chart caption names its unit,
  as it already does. The headline's token count stays separate from its cost.
- **Hover dims the rest; the legend filters (D3).** A one-line stacked share bar above the model
  list. Hovering a segment or its model row dims the other segments instead of growing anything.
  With D3, clicking a model row removes it from the bar and the day chart, and the last visible
  model cannot be removed.
- **Magnitude in the row.** A 2 px `bg-muted-foreground` data bar under each model row's cost,
  proportional to its share. This is a mark, not a divider, so the `hairlines` census stays green.

## Decisions

Decided 2026-09-25: the owner accepted every recommendation below ("whatever seems best"). The
alternatives stay only as a record of what was weighed.

- **D1 — where 100 % is.** Recommended: the usable window, meaning the raw window minus the
  provider's reserve (Claude's `buffer`, Codex's effective window), with the reserve named in the
  popover. Alternative: keep the raw window and draw the reserve as a marked zone on the ring.
- **D2 — where the session total lives.** Recommended: the context ring's popover, because a
  session's spend is a property of the conversation, like its context. Alternative: a row in the
  session menu or the rail's hover card.
- **D3 — legend as filter on the usage page.** Recommended: yes. It is cheap, and it answers "what
  does this week look like without the big model". Alternative: hover dimming only.

## Order

1. Adapter mapping and the wider payload: both adapters, `context-usage.ts`, and usage emission in
   `MockProviderAdapter` so scenarios can drive the ring. Deploy `--server`.
2. The popover breakdown (section 1) and the estimate mark (section 3).
3. D1 measurement on live Claude and Codex sessions, then the usable-window ratio.
4. The session total (section 4).
5. The usage page (section 5).

Each step lands green on its own.

## Verification

- `packages/client-core` tests for `context-usage.ts`:
  - Claude's snake_case per-turn record maps to camelCase
  - categories classify by `kind`
  - the newest breakdown and the newest window combine across the two Claude snapshots
  - unreported fields stay null
  - the estimate flag survives
- Adapter tests for `claudeTokenUsage` and the `getContextUsage` forwarding, with a captured
  `SDKControlGetContextUsageResponse` fixture.
- `ProviderUsageHistoryReader` tests for the session filter against a real in-memory database,
  reusing Plan 141's fixtures.
- `usage.ts` tests: the sub-cent format, the top-N fold, and the unpriced-day marker.
- Scenarios:
  - `chat-usage-meter` gains the context popover with segments (driven through the mock
    adapter's new emission) and the session total
  - `settings-usage` gains the folded model list, the unpriced-day marker and the sub-cent row
  - `look` on both surfaces in both colour modes, with the screenshots read back
- `bun run gates`. `bun run deploy --server`, then `GET /platform/release`.

## Not in this plan

- The quota meter, recording, backfill and reset credits ([Plan 141](141-usage-and-rate-limits.md)).
- recharts and any chart library.
- Neon's `cost-estimate-card` allowances: we have no plan allowances to net against.
