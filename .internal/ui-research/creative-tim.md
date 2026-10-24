# Creative Tim

<https://www.creative-tim.com/> · open repo <https://github.com/creativetimofficial/ui> · clone `references/creative-tim-ui` (20eb87b) · fetched registry items in `references/creative-tim-ui-r/`

## What it is

A long-running template vendor. The site is mostly commercial: a Club subscription ($29–89/mo), Material Tailwind / David UI PRO, hosted agents ("OpenClaw", "Hermes", Galichat), n8n templates, and an AI app builder. **Skip all of that.** The one relevant piece is **Creative Tim UI**, a shadcn/ui block registry (they claim 435+ blocks in about 50 categories), installable with `npx @creative-tim/ui add <name>` or `shadcn add https://www.creative-tim.com/ui/r/<name>.json`, and indexed at <https://www.creative-tim.com/ui/llms.txt>.

## License, stack, deps

- The GitHub repo is **MIT**. It holds only 168 items (53 shadcn `ui` + 111 blocks: ecommerce, blog, FAQ, contact, footers, testimonials, modals, account, web3, cruds, and 3 AI blocks).
- The **registry serves more than the repo**. Free items return 200 from `/ui/r/<name>.json`. PRO items return **401** without an API key; examples are `ai-chat-streaming-01`, `ai-assistant-panel`, `command-palette-modal` and `api-keys-manager`. Free registry items carry no license in the payload, so assume the MIT site terms apply, but check before copying code.
- Stack: shadcn on **Radix** (`@radix-ui/react-*`), **lucide-react**, Tailwind v4, raw palette colours (`text-emerald-600`, `border-amber-200`), cards with borders. Charts use `recharts`. None of this matches our Base UI, Phosphor, tokens-only, no-divider rules, so **nothing is copy-paste**. Everything is a port.
- The agent blocks are **mock demos**: `setTimeout` chains, `Math.random()` token counts, hardcoded "GPT-4o" events. They are UI sketches, not reusable components.

## Catalog (relevant, free unless noted)

| Block                                                                      | What                                                                                                                    | Link                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ai-agent-activity-01`                                                     | Event feed (task/tool/token/message/error) with running **token and cost totals**                                       | <https://www.creative-tim.com/ui/r/ai-agent-activity-01.json> |
| `ai-workflow-status-01`                                                    | Multi-agent pipeline nodes with status and per-node tokens                                                              | `/ui/r/ai-workflow-status-01.json`                            |
| `ai-multi-step-agent-01`                                                   | Plan → execute → verify phases with a timeline                                                                          | `/ui/r/ai-multi-step-agent-01.json`                           |
| `ai-tool-use-01`                                                           | Tool calls with inputs, outputs and duration                                                                            | `/ui/r/ai-tool-use-01.json`                                   |
| `ai-code-assistant-01`                                                     | Prompt → highlighted diff → apply                                                                                       | `/ui/r/ai-code-assistant-01.json`                             |
| `ai-file-attachment-01`, `ai-document-qa-01`                               | Attachments with drag-drop; answers with footnote citations                                                             | `/ui/r/…`                                                     |
| `agent-management-{list,create,detail,tasks,analytics}-01`                 | Full pages: agent list, create wizard, detail with activity log, **kanban task board**, analytics (cost, tokens, table) | <https://www.creative-tim.com/ui/blocks/ai-agents/pages>      |
| `kpi-sparkline-cards`                                                      | KPI cards with sparklines (recharts)                                                                                    | `/ui/r/kpi-sparkline-cards.json`                              |
| `magazine-oversized-words`                                                 | Editorial layout with giant words and **`@chenglou/pretext`** text flow                                                 | `/ui/r/magazine-oversized-words.json`                         |
| `hero-*`, `pricing-*`, `footers-*`, `faqs-*`                               | Generic marketing sections                                                                                              | llms.txt                                                      |
| PRO: `ai-chat-streaming-01`, `ai-assistant-panel`, `command-palette-modal` | Not accessible without a key                                                                                            | skip                                                          |
| `skills/creative-tim-ui`                                                   | Their agent skill: "95% rule", restraint, research-first                                                                | repo                                                          |

## Steal list (ranked)

| #   | Idea                                                                                                              | Platform surface                                                                                                   | How                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1   | **Token and cost aggregation over an event feed.** A per-event `tokens · $cost` suffix, with totals in the header | Plan 141 usage meter: per-turn usage rows and Settings › Usage (`features/chat`, usage page)                       | Port the idea. We already have real numbers; borrow the "running total on the work log" presentation |
| 2   | **Agent analytics page** (cost over time, tokens per agent, table)                                                | Settings › Usage, and a future per-session usage view                                                              | Port the idea (layout only; we would not add recharts without a decision)                            |
| 3   | **Kanban task board for agents** (`agent-management-tasks-01`)                                                    | Agent workbench lane (plans 139–145): sessions or worktrees as cards by state (running, waiting on approval, done) | Port the idea                                                                                        |
| 4   | **Plan → execute → verify timeline** (`ai-multi-step-agent-01`)                                                   | Chat plan and todo rendering, and `plan-follow-up-banner.tsx`                                                      | Port the idea. Compare with brainless `claude-todo-list`                                             |
| 5   | **Multi-agent pipeline view** (`ai-workflow-status-01`)                                                           | Subagent tree (`agents-row.tsx` / `agent-row.tsx`)                                                                 | Port the idea                                                                                        |
| 6   | **Footnote citations** (`ai-document-qa-01`)                                                                      | Assistant markdown when agents cite files or URLs (`assistant-markdown-link.tsx`)                                  | Port the idea                                                                                        |
| 7   | `magazine-oversized-words` (pretext text flow)                                                                    | `apps/site` "the name" and "why" sections, if the site goes editorial                                              | Port the idea                                                                                        |
| 8   | Hero, pricing and footer blocks                                                                                   | `apps/site`                                                                                                        | Skip. The site already has a stronger identity than these templates                                  |
| 9   | Everything commercial (OpenClaw, Hermes, Club, PRO)                                                               | none                                                                                                               | Skip                                                                                                 |

## Cost / risk

- There is no code worth copying. Every block needs a full restyle (Radix → Base UI, lucide → Phosphor, palette → tokens, borders → tone) and its mock logic removed. Treat these as **screenshots with source**.
- Free vs PRO is only visible by probing the registry (401). Don't copy from a PRO preview page.
- Low quality relative to our bar: `Math.random()` at runtime, no pending, empty or error states, and no loading primitives.

## Open questions

- Is a Usage analytics view (cost and tokens over time, by agent or provider) wanted beyond the Plan 141 meter? That is the best idea here.
- Is a kanban-style overview of sessions or worktrees wanted in the agent workbench lane?
