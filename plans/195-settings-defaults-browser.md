# Plan 195: Browse Settings defaults in UI and JSON

## Status and scope

- Status: APPROVED, 2026-09-27. Implementation has not started.
- Inspected at: Platform `37e7171df`. Recheck the source map below before implementation, especially concurrent Settings focus work.
- Outcome: Defaults is a searchable, read-only reference with UI and JSON views. Changing the scope preserves the chosen view. Changing the view preserves the scope.
- Size: M, one bounded Settings feature. Web only. No registry value changes, server endpoints, account operations, or native client work.
- This plan does not reopen Settings focus, Wallpaper scrolling, or Theme studio work. Preserve their fixes.

## User experience

Use the existing User, Workspace, and Defaults scope tabs and the UI/JSON toggle. Apply these transitions:

| Starting state          | Action                            | Result                                                                       |
| ----------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| User or Workspace, UI   | Select Defaults                   | Defaults UI, with the existing search text                                   |
| User or Workspace, JSON | Select Defaults                   | Defaults JSON                                                                |
| Defaults, either view   | Select User or Workspace          | Selected scope, same view                                                    |
| Defaults, UI            | Select JSON                       | Defaults JSON                                                                |
| Defaults, JSON          | Select UI                         | Defaults UI                                                                  |
| Any scope/view          | Close, reopen, or reload Settings | Restore the saved scope and chosen view using existing workspace persistence |

View preference changes only through an explicit view action. If someone explicitly switches to JSON while reading Defaults, returning to User keeps JSON. There is no separate remembered mode per scope and no temporary forced mode to restore.

Defaults UI has a short read-only explanation, the usual search and category layout, and one entry per registry key. Each entry shows its name, key, description, scope, and exact default value. Show restart, deprecation, internal visibility, and registry read-only information where applicable. Include keys unavailable in the current environment as reference entries with their applicability explained. JSON already includes every registry key; both views must describe the same set.

Use static text and existing read-only display primitives. Keep values selectable and readable at normal contrast. A boolean can show On or Off alongside its literal value. Preserve enum identifiers, empty strings, `null`, empty arrays, and empty objects distinctly. Show arrays and objects as formatted JSON with an accessible disclosure for long content. Expanded values wrap or scroll within their own region; a narrow phone must never lose the full value. Provide a labelled Copy value action when selection alone is awkward. Copying must preserve the exact JSON value.

Defaults has no setting editors, reset actions, row write menus, account connections, machine management, model discovery, Theme studio launcher, or operational Usage/MCP/Push sections. Search and disclosures remain interactive. Defaults JSON keeps its existing editor search, selection, copying, and read-only save capability.

## Decisions and alternatives

**Use a dedicated read-only entry renderer backed by registry descriptors.** Reuse names, descriptions, category grouping, search matching, spacing tokens, and suitable display primitives. Reuse of appearance alone does not justify mounting live setting widgets.

The owner's suggestion of static or disabled inputs is worth separating:

- Static values are the default. They are legible, selectable, and do not imply an available edit action.
- A read-only text field may be useful for a long scalar if it improves selection. It must have a label and must not summon the phone keyboard while merely opening or switching views.
- Disabling the current form is rejected. Disabled controls lose normal interaction and often contrast. More importantly, several composite widgets read live accounts or resolved settings and own mutations internally. A disabled fieldset would leave the wrong data source and hidden side effects in place.

A smaller alternative is to keep Defaults JSON-only and preserve the user's preferred mode separately. It fixes the surprising return-to-JSON behavior, but it still forces phone users into a document to look up a value. The owner chose the searchable UI plan. Do not add the temporary JSON exception on the way to this design.

## Source map and current hazards

Paths in this section are relative to `apps/web/src/features/settings/`, except where stated.

- `components/scope-tabs.tsx`: selecting Defaults writes `json` into the shared view store. Remove that coupling.
- `components/view-toggle.tsx`: selecting UI while in Defaults changes scope to User. Remove that coupling too.
- `state/view-store.ts`, `state/scope-store.ts`, and `state/reload.ts`: hold scope/view and restore workspace state. Preserve their ownership rather than introducing another preference store.
- `hooks/use-held-display.ts`: forces Defaults to JSON and waits for a live settings document/projection plus the matching editor buffer. Defaults UI needs registry readiness; Defaults JSON needs its generated buffer. Neither requires successful live settings resolution.
- `hooks/use-settings-json-document.ts`: seeds Defaults through `utils/defaults-file.ts`, but activates only for the stored JSON view and reads the settings document unconditionally. Reconcile its activation and data dependencies with the new display model.
- `state/selection.ts`: distinguishes displayed form/JSON state for document commands. Keep displayed selection authoritative during a held transition.
- `hooks/use-reload-view.ts`: captures scope, view, search, category, and scroll. The new reference must participate without capturing a different subject's scroll position.
- `components/setting-row.tsx` and `hooks/use-settings-projection.ts`: render effective values after layer, intent, and theme resolution. Those values cannot supply the Defaults reference.
- `state/scope-store.ts`: `writableSettingsScope('default')` returns `user`. `components/page.tsx` currently passes that fallback to `PageActions`, so Defaults can expose Reset all user settings. Remove this implicit conversion and migrate callers to a structurally writable branch.
- `components/category-section.tsx`: mixes registered rows with operational sections. Defaults needs registry-only categories.
- `utils/form-categories.ts` and `packages/client-core/src/settings/search.ts`: search editable rows and fold child keys into their owner. Defaults requires key-level matching, including folded keys, without duplicating or silently dropping entries.
- `packages/contracts/src/settings/defaults-document.ts`: the existing JSON reference iterates `SETTING_IDS` and serializes `descriptorFor(id).default`. This is the authoritative meaning of default for the UI too.

## Implementation units

### 1. Define the reference data and readonly rendering

- [ ] Recheck the current registry, search utilities, and composite widget behavior. Record any drift in this plan before changing implementation.
- [ ] Build a pure registry entry projection under the Settings feature's `utils/`. Derive types from `SettingId` and the existing descriptor contract. Retain the raw typed default value alongside display metadata.
- [ ] Match keys, names, descriptions, categories, keywords, and serialized default values. Reuse existing scoring primitives where they fit; add a key-level path when row folding would change the results. Keep editable-form search behavior unchanged.
- [ ] Render entries under `components/` using shared UI primitives and density tokens. Share label/value presentation where it helps, without passing editing providers or mutation callbacks into reference entries.
- [ ] Ensure every `SETTING_IDS` member occurs once. Show plain registry values even when the active theme, workspace override, or system color mode resolves to something else. Explain contextual identifiers such as system mode using descriptor text, without replacing them with today's effective result.
- [ ] Keep deferred search and existing staged mounting where helpful. Search and counts must use the complete registry before rows mount. Avoid loading editors, font previews, wallpaper galleries, or account widgets to display a static default.

### 2. Connect scope, view, and document ownership

- [ ] Model the displayed subject so writable settings UI, Defaults UI, and JSON documents have explicit data requirements. Keep a writable target only on writable branches; eliminate Defaults-to-User conversion at write call sites.
- [ ] Make scope changes select scope only, and view changes select view only. Remove the forced JSON condition for Defaults from held display.
- [ ] Give Defaults UI a registry-only rendering branch in `SettingsPage`. Hide editing/page actions before their hooks and widgets mount. Keep operational categories in the writable UI branch.
- [ ] Gate view-specific queries and editor-buffer work by the requested subject. Defaults UI must render if settings loading fails or user JSON is malformed. Defaults JSON must seed from `defaultsLayerFile()` without waiting for a server layer. Preserve subscriptions owned elsewhere that keep writable settings synchronized.
- [ ] Hold header, scope highlight, toggle, and content together while a newly selected writable subject or JSON buffer becomes ready. Never show a Defaults header over User values. A failed requested subject must become visible with its error state.
- [ ] Preserve dirty User and Workspace JSON buffers when leaving and returning. Defaults has no writable buffer capability. Align document command selection with the displayed subject, including the fallback before a display registration exists.
- [ ] Persist the selected scope and explicit view through existing reload ownership. Preserve search/category state and restore matching scroll state. Do not treat Defaults UI as a project-specific or operational category view; render a clear empty/filter state when the current category has no registry entries.
- [ ] Enable Defaults UI wherever the Settings UI can render, including a page without an editor tab. Keep JSON available only when an editor document host exists. Preserve the preferred view if that host is temporarily absent.

### 3. Prove the behavior and ship the implementation

- [ ] Add focused tests for registry parity and value formatting: boolean, enum, empty string, multiline text, null, list, and object. Give live User/Workspace values obvious differences and prove Defaults still shows registry defaults.
- [ ] Cover the transition table, reload persistence, and returning to an unsaved User JSON buffer. Replace the current `tests/defaults-tab.test.tsx` expectation that UI leaves Defaults.
- [ ] Exercise delayed or failed settings reads and malformed User JSON. Defaults UI and JSON remain readable; returning to User exposes the correct pending/error state. Verify the whole header/body swap on delayed transitions.
- [ ] Assert zero settings writes, account operations, machine operations, and preview mutations while searching, expanding, copying, and switching Defaults views. Exercise page menus and command/save paths, not just disabled DOM controls.
- [ ] Add a real `agent:browser` scenario with selectors in `scripts/agent/selectors.ts`. At desktop and phone widths 320, 390, and 430, open Defaults from UI and JSON, search a folded key, expand a long value, copy it, and switch back to each writable scope.
- [ ] Verify keyboard navigation, accessible names, selected text/full value recovery, no document overflow, and the existing mobile focus policy. Opening or switching a reference view must not automatically open the software keyboard. Check mobile WebKit and read back screenshots with Defaults values visible.
- [ ] Run the narrow tests and required repository gates. Commit implementation paths, push, deploy the web build to Mesh, and inspect `/platform/release` plus the live reference view. Record evidence and any physical-device limits before marking this plan complete.

## Boundaries and completion

This plan adds a reference view, not a second settings engine. It does not compute a hypothetical effective environment, preview defaults in the app, offer Apply all defaults, or add a comparison/diff mode. Reset and editing remain explicit actions in writable scopes.

Planning is complete when this file and its index entry are pushed. Runtime work starts in a separate task. Implementation is complete when the transition table, exact registry values, read-only behavior, and mobile/desktop evidence pass, and the committed change runs on Mesh.

## October 2026 issue follow-ups

Status: Approved, retained by [Plan 336 closeout](issue-closeout-2026-10.md).
These are remaining execution items. Closing their tracker records does not certify a fix
or change acceptance of an earlier delivered milestone. Each original thread retains its
full reproduction, comments and historical artifacts. Source links below pin the reviewed
main revision; recheck them before implementation.

### Issue 946

Source: [#946: Unconfirmed: appearance Reset leaves a saved opacity override](https://github.com/ShaulLavo/fregat/issues/946), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/946#issuecomment-6050629364).
Current owner: [apps/web/src/features/settings/tests/appearance-rows.test.tsx](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/apps/web/src/features/settings/tests/appearance-rows.test.tsx).

PR #943 CI 37712886021 job 113102652349 retained workbench.surface.contentOpacity after Reset under a theme. Ten full-file controls passed. An actual trace showed theme.uncustomize and scalar reset serialized by settings-document scope; after acknowledged sequence 4 both cache and persisted data lacked the key. No cause fix was justified. Reproduce the exact theme/reset composition with mutation owner, scope, revision, acknowledgement and post-settlement observation. Preserve Reset behavior and assertions. This follow-up expands the Settings plan to that integration boundary; the separately claimed backend #563 remains untouched.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.
