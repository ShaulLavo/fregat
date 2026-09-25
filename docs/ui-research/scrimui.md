# Scrim UI: survey and the hidden idea

Source: https://scrimui.dev/components, repo `jackyrwj/scrim-ui` (free tier MIT, © 2026 Scrim UI;
Pro components live in a private repo under a commercial licence and are not in the clone).
Cloned at `references/scrim-ui` (HEAD 9a7671a, 2026-09-25). Components are single-file React +
Tailwind, **dependency-free by rule** (inline SVG, no Radix), shipped through a shadcn registry
(`/r/<name>.json`).

## Catalog

- **Components (55 in `src/showcase/`, 29 in the public registry).** They fall into ten fixed
  categories:
  - prompt input: prompt-input, attachments, model selector, prompt-editor
  - messages: user-message, streaming-message, streaming-markdown, markdown-message,
    message-actions, response-versions, error-message
  - reasoning: reasoning, reasoning-steps, reasoning-level, thinking-indicator
  - tool calls: tool-call, search-tool-call, code-execution, tool-toggle, generative-ui,
    generated-media
  - sources: source-card, source-list, citation-ui, citation-popover
  - agents: agent-status, agent-plan, agent-run-timeline, agent-handoff, approval-gate,
    approval-request
  - files: file-upload, context-files, context-picker, context-usage, artifact-preview,
    edit-diff-view
  - voice: voice-input, voice-waveform, voice-conversation, voice-call-controls
  - memory: memory-chip, memory-list, memory-suggestion, memory-toast
  - feedback and safety: response-rating, inline-correction, confidence-answer,
    output-comparison, eval-results, moderation-flag, refusal-message, cost-meter,
    conversation-sidebar
- **Tools (all run in the browser):** chat and voice mockup to PNG, a theme generated from one
  brand colour, token counter, pricing calculator, MCP config builder, system-prompt builder,
  model switcher, response diff, screenshot framer.
- **Icons:** `src/lib/icon-guide.ts` gives one Lucide icon per AI concept: "Lucide ships 2034
  icons and no opinion about which of them means 'tool call'".
- **Inspiration:** breakdowns of ChatGPT, Claude, Perplexity, Cursor, Notion AI, Lovable,
  Gemini and Replit, plus four decision guides: streaming vs. full reply, when to pause for
  approval, long-task progress, and interrupting the agent.
- **Prop explorer:** every component page regenerates the call site as you change props.

## The hidden idea: each component page lists its failure modes

The components themselves are ordinary. The idea is in each `page-config.tsx`: two arrays,
**`usage`** and **`mistakes`**, which list the hostile states the component exists to survive.
The component's props are shaped so that the wrong implementation is hard to write. Each
component is a **contract about state honesty**, not a visual.

The best example, `approval-gate.tsx`, reads as a lifecycle rather than a card:

- **It owns no decision.** `outcome` is a projection of the run's event log, identical in every
  tab and replayed on reconnect. `submitting` is the only local state, and it means "a request
  is in flight from _this_ tab". It is not an optimistic outcome.
- **`request.id` is the idempotency key.** It collapses two tabs, a double click and a retried
  fetch into one decision on the server.
- **`outcome.stale`.** The server recorded the answer after the run stopped waiting, so the
  action never happened. The card must not render a green tick.
- **`connection: live | reconnecting | offline`.** While reconnecting, a pending gate says it
  might already have been decided elsewhere.
- **`expiresAt` is derived, never stored.** The expired render is still correct on a reload
  months later.
- **The buttons stay visible, disabled, while submitting.** Hiding them makes "sent" and
  "ignored" look the same. The countdown is not announced to screen readers.

How we compare: `pending-approval-actions.tsx` / `pending-request-feedback.tsx` already split
`submitting` from `accepted` ("Response sent. Waiting for agent…"). We have no **stale/late**
state, no **connection-aware** pending state, and no **expiry** rendering. Plan 145 (approval
rules) is where these belong.

The same kind of contract appears across the catalog. The ones that apply to us:

| Component          | Rule worth taking                                                                                                                                                                                                                                                                                                               | Our surface                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| streaming-markdown | Completeness is positional: only the tail can be incomplete. Speculatively close the tail's constructs (which remend already does for us). **When the tail is ambiguous, hold it:** a lone `#`, a single backtick, or a table row with no separator yet renders nothing for one token instead of rendering wrong and correcting | `packages/markdown/src/utils/heal.ts` heals but never holds           |
| agent-run-timeline | Stable event ids. A retry **appends a linked event** and never mutates the failed one. Consecutive successes fold into countable clusters; waiting, running, failed and approval events **never fold**. Follow the tail only when the reader is at the bottom                                                                   | `work-log.ts` collapse, `timeline-viewport`                           |
| cost-meter         | Unknown is not `$0.00`. Cached input is priced at the cache rate. Reasoning tokens are already inside output tokens. Under a cent, show more digits. **Don't animate a subtotal counting up mid-stream**: a smoothly counting number looks settled                                                                              | Plan 141 usage meter; check where `TickerNumber` animates live totals |
| context-usage      | Measure fullness against the window **minus a reply reserve**. Break the usage down by segment, with an eviction rank. Name the segment that goes first. Carry an `estimated` flag instead of silently rounding                                                                                                                 | `context-usage-ring.tsx` shows one percentage                         |
| edit-diff-view     | Key decisions by hunk id, never by index, because a streaming diff re-splits itself. **An incomplete hunk cannot be accepted.** Render the model's structured hunks rather than re-diffing snapshots. "Copy result" is a function of the decisions                                                                              | agent diff review, git diff                                           |
| agent-plan         | Never delete abandoned steps; mark them. No percentage over a list whose length changes. Don't key by index                                                                                                                                                                                                                     | plan cards                                                            |
| response-versions  | Never jump the reader to the newest version while they are reading an older one. A stopped stream is partial and must say so                                                                                                                                                                                                    | regenerate / queued messages                                          |
| source-list        | "No sources" must not look like "failed to load"                                                                                                                                                                                                                                                                                | the same rule as our pending-before-empty rule                        |

## Steal list

1. **A `Mistakes` block per primitive and per agent surface.** Put it in a short doc next to
   the verify-fregat feature map, and turn each hostile state into a scenario: two tabs, a
   reload mid-approval, a late decision, a reconnect. This is the reusable idea, and it matches
   our "Loading and empty states" and "no silent misses" rules.
2. **Approval gate states:** `stale` (late decision), `connection`-aware pending, derived
   expiry, and the decision id as idempotency key. Feed them into Plan 145.
3. **The markdown hold rule**, added to `heal.ts`. It is small, and it lets `token` streaming
   mode run without flicker.
4. **Timeline folding rule:** only successes fold, and a retry appends. Check `work-log.ts`
   against it.
5. **Context and cost honesty:** reply reserve, per-segment breakdown, unknown ≠ zero, no
   count-up animation on live subtotals.
6. **The concept → icon registry.** One icon per agent concept, kept in one file (Phosphor for
   us). It stops the same idea from getting three different icons across features.
7. **Decision guides** ("when to pause for approval", "interrupting the agent") are good
   reading for the agent-workbench lane. Their source is in `src/lib/inspiration.ts`.

Skip: the visuals (generic shadcn look), the voice and memory sets, and the tools, which are
marketing utilities.
