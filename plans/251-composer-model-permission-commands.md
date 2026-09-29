# Plan 251: Composer, model and permission commands

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-32, composer, models and permissions. Size: L.
- Depends on Plans 206 and 220, focused widget commands.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.json` and `206-zed-translation.json`.

## Outcome

Expand the composer, paste clipboard text, cycle favorite models and supported thinking options,
open option menus, and answer the focused permission request from the keyboard.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `agent::ExpandMessageEditor` toggles expanded composer layout. `agent::PasteRaw` invokes text
  paste directly, bypassing pasted-context conversion. `agent::ToggleOptionsMenu` opens the agent
  panel's options menu, which is distinct from model options.
- `agent::CycleFavoriteModels` cycles favorite models; `agent::CycleThinkingEffort` cycles
  advertised thought levels. `agent::ToggleThinkingEffortMenu` opens their picker.
  `agent::ToggleThinkingMode` changes thinking when the model permits it. These model changes
  check thread availability. `agent::ToggleFastMode` changes supported speed and may open the
  provider's confirmation menu.
- `agent::OpenPermissionDropdown` opens the pending tool's permission choices.
  `agent::AllowOnce`, `agent::AllowAlways` and `agent::RejectOnce` answer that request using
  offered permission kinds and selected granularity.

Sources: [thread_view.rs, expansion](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/thread_view.rs#L2374),
[model controls](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/thread_view.rs#L12347),
[speed control](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/thread_view.rs#L12097),
[permissions](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/thread_view.rs#L2481),
[permission menu](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/thread_view.rs#L12073),
[message_editor.rs, raw paste](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/message_editor.rs#L1344),
[agent_panel.rs, options](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/agent_panel.rs#L3592).

## Existing Fregat behavior

`apps/web/src/features/chat/components/model-options-menu.tsx` already uses typed option
descriptors and respects prompt-controlled effort. `hooks/use-model-picker.ts` and the
`models.favorites` registry entry own model selection. `components/pending-approval-actions.tsx`
calls `hooks/use-pending-requests.ts` with the provider's actual offered decision.
`components/chat-input-editor.tsx` owns paste interception. Chat paths share the
`apps/web/src/features/chat/` prefix. `packages/client-core/src/chat/providers/options.ts`
contains option helpers; `packages/client-core/src/commands/chat.ts` contains adjacent commands.
Expanded layout and this full command set need wiring. No Editor engine change is required.

## Design

Register explicit `chat.*` composer/model/menu commands and `chat.approval.*` decisions in the
Plan 206 table. Publish `Chat`, `Chat > Editor`, pending-request and open-menu contexts. Add
platform bindings as preset data; Plan 254 later supplies `InlineAssistant > Editor` model
cycling. The same narrow actions drive buttons and commands.

Select options through provider descriptors, including allowed values, availability and
prompt locks. Decline unsupported speed/thinking commands. Permission commands resolve the
focused request ID and offered decision at execution time; accepted/submitting requests cannot
be answered again. Use the existing mutation owner and settle its projection. Raw paste inserts
clipboard text as one composer undo operation and retains mentions already in the draft.
Register any new persistent knob in `packages/contracts/src/settings/keys.ts`; execution
defaults use application or machine scope. Expanded layout remains per-browser view state.

## Steps

- [ ] Add failing focused command tests for provider options, request identity and raw paste.
- [ ] Expose narrow actions for composer expansion, panel options, model choices and permissions.
- [ ] Add capability-driven cycles/toggles and controlled menus using `@workspace/ui` primitives.
- [ ] Register commands, contexts, presets and hints; run settings-reference generation if needed.
- [ ] Verify fixture scenarios and gates, then commit and deploy.

## Acceptance

- Focused chat command/component tests cover zero/one/multiple favorites, unsupported options,
  prompt-locked effort, draft preservation and the next permission replacing an answered request.
  A fixture offering only allow-once/reject-once never exposes persistent approval.
- Extend `chat-model-favorites` and `approval-two-tabs`; add `chat-composer-commands` for
  expansion, raw paste and menus. Verify all twelve commands with fixture capabilities,
  focus restoration and read-back screenshots.
- Run `bun run gates`; run heavy checks and `agent:browser scenario` through the wave slot
  wrapper. Use fixture catalogs/providers and explicit free ports.

## Out of scope

New provider options, billing flows, provider authentication and TUI composer design.
