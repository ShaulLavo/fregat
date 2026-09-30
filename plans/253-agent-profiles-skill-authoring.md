# Plan 253: Local agent profiles and skill authoring

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-34, agent profiles and skill authoring. Size: L. Depends on Plans 206 and 251.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.json` and `206-zed-translation.json`.

## Outcome

Create and select reusable agent profiles, browse local skills, and create or edit a skill
through a form whose fields and save action are keyboard accessible.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `agent::ManageProfiles` opens profile management with create/fork, model, tool and MCP
  configuration. `agent::ToggleProfileSelector` opens the advertised ACP mode picker or the
  native profile selector, according to the active agent.
- `agent::ManageSkills` opens the agent-skills Settings page.
- `skill_creator::FocusNextField` and `skill_creator::FocusPreviousField` move focus through
  the skill form. `skill_creator::SaveSkill` validates name, description and body, resolves
  the destination scope at save time, writes `SKILL.md`, then refreshes discovery.

Sources: [manage_profiles_modal.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/agent_configuration/manage_profiles_modal.rs#L179),
[thread_view.rs, selector](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/thread_view.rs#L12435),
[agent_panel.rs, skills page](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/agent_panel.rs#L3534),
[skill_creator.rs, save](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/settings_ui/src/pages/skill_creator.rs#L619)
and [field focus](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/settings_ui/src/pages/skill_creator.rs#L872).

## Existing Fregat behavior

`apps/web/src/features/chat/utils/composer-skills.ts` queries provider skill/slash-command
catalogs; opening discovery can spawn a provider CLI. `apps/server/src/provider/routes.ts`
and `packages/contracts` own the catalog contract. The settings registry in
`packages/contracts/src/settings/keys.ts` and the existing model/runtime-mode controls supply
profile inputs. Local profile CRUD and a skill authoring form need implementation. Editor
package changes are unnecessary; existing hosted editors can render skill contents.

## Design

Add `chat.manageProfiles`, `chat.manageSkills`, `chat.toggleProfileSelector` and
`skills.focusNextField`, `focusPreviousField`, `save` to the command table. Preset rows target
`Chat`, `Chat > Editor`, `SkillCreator` and `SkillCreator > Editor`. Form focus commands use
the actual enabled field order; an open picker retains its deeper context.

Profiles store typed provider/model options, access mode, enabled tools and MCP references.
Validate each selection against the active provider; keep secrets in the secret store. New
execution defaults and authoring destinations are registry entries with application/machine
scope. User-authored global skills use `~/.agents/skills`, preserving consumer symlinks;
project skills use the provider-supported registered project destination. Show each skill's
source and editability. Plugin- and OS-managed skills retain their owners.

Create scoped server file operations for validated names and destinations, collision handling
and atomic save. Support editing an existing authored skill without dropping unedited front
matter. Save resolves the selected scope and returns a catalog refresh. Reads use queries;
profile/skill writes use scoped mutations and settle both management and composer caches.
Features import shared contracts and owners through allowed package/shared paths.

## Steps

- [ ] Add failing profile round-trip and skill-save tests over temporary files and fixture catalogs.
- [ ] Register profile/destination settings and implement scoped file/profile operations.
- [ ] Build profile management and skill authoring with shared fields, list rows and error states.
- [ ] Wire commands, focus contexts and presets; generate the settings reference.
- [ ] Verify keyboard workflows, cache settlement and gates; commit and deploy server changes.

## Acceptance

- Focused server tests cover invalid names, destination escape, duplicate names, scope changes
  before save and atomic failure. Profile tests cover unsupported capabilities and secret references.
- Add `agent-profiles-skills` to `scripts/agent/scenarios/` with a fixture catalog and temporary
  skill root. Create/fork/select a profile, navigate fields, save/edit a skill and observe its
  refreshed composer entry. No provider CLI/account runs. Read screenshots and cache evidence.
- Run `bun run settings:reference:check`, touched tests and `bun run gates`. Heavy checks use
  the wave slot wrapper; agent servers use explicit free ports.

## Out of scope

Skill marketplace installation, automatic model-written skills, provider login and TUI management.
