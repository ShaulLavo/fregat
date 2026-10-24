# Manifest UI (ui.manifest.build): teardown

Source: https://ui.manifest.build, repo `mnfst/manifest-ui`. MIT, "Copyright (c) 2026 MNFST, Inc".
Cloned at `references/manifest-ui` (HEAD d54d1a8, 2026-02-18). Sources are in `registry/<category>/*.tsx`,
and the registry is `https://ui.manifest.build/r/registry.json`. It has no `llms.txt` (404).

## 1. What it is

- A shadcn registry of **blocks for ChatGPT Apps / MCP Apps**: widgets that an MCP server returns and a chat
  host renders inline under a tool call. It is commerce- and content-shaped (products, orders, events, posts).
- **Stack:** Next 16, React 19.1, Tailwind v4, **Radix** (`@radix-ui/react-*`), lucide, leaflet, and
  `@modelcontextprotocol/ext-apps` (the MCP Apps SDK, widget side).
- **Conventions:**
  - Every block takes four grouped props: `data` (content), `actions` (`on*` callbacks), `appearance` (variants
    and labels) and `control` (loading, selection, disabled). See `registry/types.ts`.
  - Every block renders demo data when `data` is omitted.
  - `appearance.displayMode` is `'inline' | 'pip' | 'fullscreen'`, the three host display modes.
- `lib/host-api.tsx` is a `HostAPIProvider` that wraps `useApp()` from `ext-apps/react`. It exposes theme,
  displayMode, toolInput, toolOutput and widgetState, plus `requestDisplayMode`, `sendFollowUpMessage`,
  `callTool` and `openExternal`. It falls back to local preview defaults.

## 2. Catalog (33 registry items)

Links are `https://ui.manifest.build/blocks/<category>`, and sources are in `registry/`.

| Category      | Blocks                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| form          | contact-form, date-time-picker (Calendly-style), issue-report-form                                                          |
| payment       | order-confirm, payment-confirmed, amount-input                                                                              |
| list          | product-list (list/grid/carousel/picker), **table** (single/multi-select, inline vs fullscreen with pagination and filters) |
| selection     | option-list, tag-select, quick-reply                                                                                        |
| status        | progress-steps, status-badge                                                                                                |
| miscellaneous | stat-card, hero                                                                                                             |
| blogging      | post-card, post-list, post-detail                                                                                           |
| messaging     | message-bubble (text/image/voice/reactions), chat-conversation                                                              |
| social        | x-post, instagram-post, linkedin-post, youtube-post                                                                         |
| map / events  | map-carousel (leaflet), event-card/list/detail, ticket-tier-select, event-confirmation                                      |

## 3. Ranked steal list

1. **The MCP Apps host contract** (idea; this is the reason to look at Manifest at all). Tool results that ship a
   UI resource are rendered in an iframe inside the chat. The host then answers `requestDisplayMode` (inline /
   picture-in-picture / fullscreen), `sendFollowUpMessage`, `callTool` and host-context changes (theme). Manifest is
   the widget side. We would be the host.
   Destination: a sandboxed tool-result row in `features/chat/components/timeline-row.tsx` / `activity-row.tsx`,
   where "fullscreen" opens an editor tab and "pip" docks to the side panel (`chat-side-panel.tsx`). This is a
   feature decision, not a component port (see the questions below).
2. **Inline to expand for heavy tool output** (port the idea). Source: `list/table.tsx`.
   Inline is a compact card with the first rows and an expand control (`Maximize2`). The expanded view has
   pagination and column filters. We have the same problem with large tables, JSON and diffs in chat. The inline
   row should cap, and "expand" should open the full view in a tab, not grow the timeline.
   Destination: `features/chat/components/assistant-markdown.tsx` (tables) and the tool detail sections.
3. **Quick replies** (port the idea only). Source: `selection/quick-reply.tsx`.
   Pill buttons that send a canned response. They fit `plan-follow-up-banner.tsx` ("Implement" / "Revise")
   and the welcome view's starters. `pending-user-input-card.tsx` already covers option answers better
   (steps, digits, custom answer), so skip `option-list`.
4. **`progress-steps`** (skip). Our `composer-active-plan.tsx` already does this with more state.
5. **Grouped `data/actions/appearance/control` props** (skip). They are useful for LLM-generated widget props, but
   they fight our flat typed props and provider-first command rule.
6. **Everything else** (skip). The commerce, social, events, maps and blog blocks have nothing that maps to an IDE.

## 4. Cost and risk against our design language

- **Radix, not Base UI**, so nothing can be copied as-is. The code is basic: `rounded-full border` pills, raw
  `border-border` everywhere, `text-[10px]`, `bg-foreground` for the selected state, and no density tokens. The
  only value is the host contract and the display-mode vocabulary.
- An MCP Apps host means a sandboxed iframe plus a postMessage bridge in chat. That is a security surface: CSP,
  no same-origin, and scope rules like the settings "execution" boundary. It is a plan-sized piece of work.

## 5. Open questions for the owner

1. Do we want to be an **MCP Apps host** (render tool-provided UI inside chat), and do Claude Code and Codex even
   surface those resources to us through their SDKs?
2. When a tool result is too big for the timeline, should "expand" open a workspace tab (editor area) or the chat
   side panel?
