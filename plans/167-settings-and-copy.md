# Plan 167: Settings defaults, setting details, and copy that says what things are

## Status and authorization

- Status: PROPOSED — READY; D1–D4 decided by the owner on 2026-09-25. The owner asked for it the
  same day, after reading the `lsp.semanticTokens.delta` row.
- Part D (`dependsOn`) landed 2026-09-26 (wave 2, lane S): registry field and check, the
  resolver and `DEFAULT_SETTING_VALUES` read a boolean child as off under an off parent, the row is
  indented and disabled with "Applies while <parent> is on", schema hover and reference name the
  parent, scenario `settings-dependent-row`. First users: `lsp.semanticTokens.delta` under
  `lsp.semanticTokens.enabled`; `editor.history.persistDays` and `persistBudget` under
  `editor.history.persist` (non-boolean children keep their value; only the row is disabled).
- Parts A and B landed 2026-09-26 (wave 2, lane S): see "Part A results" below. `details` is on
  42 rows, shown behind an info icon (scenario `settings-row-details`), in schema hover and in the
  reference's per-category Details lists.
- Part C steps 1–2 landed 2026-09-26 (wave 2, lane S): `contrastPhrase` in `@workspace/utils/copy`
  is the one pattern; `settings-copy.test.ts` runs it over every registry text field and
  `errors:census` over each catalog entry's `message`, `why` and `fix` (four fixed). Step 3, the UI
  sweep, is next.
- Already landed with this plan: `lsp.semanticTokens.delta` defaults to on, its description is
  rewritten, and `AGENTS.md` has a **Copy** section (say what a thing is; never what it is not).
- Effort: L. Three independent parts; each is its own phase and can ship alone.
- Risk: LOW for parts B and C (text and one new optional descriptor field). Part A changes
  behaviour for anyone on defaults; only rows that are not sensible change (D4).
- Planned at: Platform `a3274e1d`, 2026-09-25.
- Server-read keys (`lsp.*`, `chat.keepImportedSessionsUpdated`, …) ship with
  `bun run deploy --server`; everything else with `bun run deploy`.

## Outcome

- Every setting's default was chosen on purpose, and the reason is written down.
- Every setting whose default rests on a measurement, a trade-off or a server quirk shows that
  reasoning in a details tooltip on its row, and in `settings.json` hover. A self-explanatory
  setting has no icon.
- No string the app shows describes a thing by what it is not, and a gate keeps it that way for
  the text the registry and the error catalogs own.

## Part A — the defaults audit

Nobody has gone over the defaults as a set. Each was picked by whoever added the key, often in
a commit about something else.

### Method, per setting

1. Read the registry entry and its comment in `packages/contracts/src/settings/keys.ts`.
2. Find why the default is what it is: `git log -S"'<id>'" --oneline`, the commit that added it,
   and the plan it cites (plans are deleted when done, so read them at the parent of the deleting
   commit, as `git show <sha>^:plans/<file>`).
3. If the reason is a claim that can be measured (cost, latency, flicker), measure it on this
   machine and note the numbers. They become the row's details (Part B).
4. Keep a sensible default as it is. Change one that stands out as not sensible, and name it in
   the commit message and the report with one sentence of reason (D4).

One commit applies every change and regenerates `schema.json` and `docs/settings-reference.md`
(`bun run settings:schema && bun run settings:reference`).

### Inventory

80 rows (81 keys; `models.order` is edited through the `models.hidden` row). The notes are what
is already known; an empty note means the row is still unread.

| Setting                                       | Default                                            | Scope       | Shown    | Note                                                                                                            |
| --------------------------------------------- | -------------------------------------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `chat.followUpBehavior`                       | `"queue"`                                          | application | user     |                                                                                                                 |
| `chat.planModeEnabled`                        | `false`                                            | application | user     |                                                                                                                 |
| `chat.contextWindowMeterEnabled`              | `false`                                            | application | user     | The meter shipped in Plan 141 and is off.                                                                       |
| `chat.responseStreamingMode`                  | `"paragraph"`                                      | application | user     |                                                                                                                 |
| `chat.projectResponseStreamingModes`          | `{}`                                               | application | internal |                                                                                                                 |
| `chat.notificationMode`                       | `"off"`                                            | application | user     |                                                                                                                 |
| `chat.inAppNotificationsEnabled`              | `false`                                            | application | user     |                                                                                                                 |
| `chat.textGenerationModel`                    | `{"providerInstanceId":"codex","model":"gpt-5.6-…` | application | internal | Codex gpt-5.6 generates commit messages; Codex is out of credit until 2026-09-26 and falls back.                |
| `chat.projectTextGenerationModels`            | `{}`                                               | application | internal |                                                                                                                 |
| `chat.sessionSortOrder`                       | `"updated_at"`                                     | application | user     |                                                                                                                 |
| `chat.confirmSessionDelete`                   | `true`                                             | application | user     |                                                                                                                 |
| `chat.projectGrouping`                        | `"repository"`                                     | application | user     |                                                                                                                 |
| `chat.projectGroupingOverrides`               | `{}`                                               | application | internal |                                                                                                                 |
| `environments.machines`                       | `{}`                                               | machine     | user     |                                                                                                                 |
| `workbench.colorTheme`                        | `"system"`                                         | window      | user     |                                                                                                                 |
| `workbench.theme`                             | `null`                                             | application | user     |                                                                                                                 |
| `workbench.theme.customizations`              | `{}`                                               | application | internal |                                                                                                                 |
| `tui.theme.colors`                            | `"theme"`                                          | application | user     |                                                                                                                 |
| `workbench.palette`                           | `"graphite"`                                       | application | user     |                                                                                                                 |
| `editor.codeTheme.dark`                       | `"dark-plus"`                                      | window      | user     |                                                                                                                 |
| `editor.codeTheme.light`                      | `"light-plus"`                                     | window      | user     |                                                                                                                 |
| `workbench.reduceMotion`                      | `false`                                            | window      | user     |                                                                                                                 |
| `workbench.fontFamily`                        | `"bundled:inter"`                                  | window      | user     |                                                                                                                 |
| `workbench.density`                           | `"compact"`                                        | window      | user     |                                                                                                                 |
| `workbench.surface.opacity`                   | `80`                                               | window      | user     |                                                                                                                 |
| `workbench.surface.contentOpacity`            | `50`                                               | window      | user     |                                                                                                                 |
| `workbench.surface.blur`                      | `9`                                                | window      | user     |                                                                                                                 |
| `workbench.surface.saturation`                | `160`                                              | window      | advanced |                                                                                                                 |
| `workbench.surface.continuousSeams`           | `false`                                            | window      | user     |                                                                                                                 |
| `workbench.wallpaper`                         | `{"enabled":true,"source":{"kind":"desktop"}}`     | application | user     |                                                                                                                 |
| `workbench.tree.indentGuides`                 | `"always"`                                         | window      | user     |                                                                                                                 |
| `editor.fontFamily`                           | `"bundled:jetbrains-mono"`                         | window      | user     |                                                                                                                 |
| `editor.fontSize`                             | `13`                                               | window      | user     |                                                                                                                 |
| `editor.lineHeight`                           | `24`                                               | window      | user     |                                                                                                                 |
| `editor.tabSize`                              | `4`                                                | window      | user     |                                                                                                                 |
| `editor.history.retainedStates`               | `200`                                              | application | user     |                                                                                                                 |
| `editor.history.persist`                      | `true`                                             | application | user     |                                                                                                                 |
| `editor.history.persistDays`                  | `30`                                               | application | user     |                                                                                                                 |
| `editor.history.persistBudget`                | `67108864`                                         | application | advanced |                                                                                                                 |
| `editor.diff.viewMode`                        | `"stacked"`                                        | window      | user     |                                                                                                                 |
| `editor.inputRoute`                           | `"edit-context"`                                   | application | advanced |                                                                                                                 |
| `terminal.integrated.fontSize`                | `12`                                               | window      | user     |                                                                                                                 |
| `terminal.integrated.scrollback`              | `10000`                                            | window      | user     |                                                                                                                 |
| `terminal.integrated.cursorBlinking`          | `true`                                             | window      | user     |                                                                                                                 |
| `editor.retainedTextBudget`                   | `67108864`                                         | machine     | advanced |                                                                                                                 |
| `editor.unicodeHighlight.ambiguousCharacters` | `true`                                             | window      | user     |                                                                                                                 |
| `editor.unicodeHighlight.invisibleCharacters` | `true`                                             | window      | user     |                                                                                                                 |
| `editor.unicodeHighlight.allowedCharacters`   | `""`                                               | window      | user     |                                                                                                                 |
| `editor.minimap.enabled`                      | `true`                                             | window      | user     |                                                                                                                 |
| `editor.guides.indentation`                   | `true`                                             | window      | user     |                                                                                                                 |
| `editor.syntaxHighlighting.enabled`           | `true`                                             | window      | user     |                                                                                                                 |
| `editor.decode.mode`                          | `"off"`                                            | window      | advanced |                                                                                                                 |
| `search.defaultMatchMode`                     | `"literal"`                                        | window      | user     |                                                                                                                 |
| `search.caseSensitive`                        | `false`                                            | window      | user     |                                                                                                                 |
| `search.wholeWord`                            | `false`                                            | window      | user     |                                                                                                                 |
| `search.maxResults`                           | `20000`                                            | window      | user     |                                                                                                                 |
| `search.maxResultFiles`                       | `20000`                                            | window      | advanced |                                                                                                                 |
| `search.quickOpenLimit`                       | `80`                                               | window      | advanced |                                                                                                                 |
| `chat.keepImportedSessionsUpdated`            | `true`                                             | machine     | user     |                                                                                                                 |
| `chat.defaultRuntimeMode`                     | `"full-access"`                                    | application | user     | New sessions run with full access and ask for no approvals.                                                     |
| `chat.defaultInteractionMode`                 | `"default"`                                        | application | user     |                                                                                                                 |
| `logs.defaultTimeRange`                       | `"1h"`                                             | window      | advanced |                                                                                                                 |
| `logs.slowThresholdMs`                        | `500`                                              | window      | advanced |                                                                                                                 |
| `developer.simulatedLatencyMs`                | `0`                                                | application | advanced |                                                                                                                 |
| `window.transparency`                         | `"compositor"`                                     | machine     | user     |                                                                                                                 |
| `files.autoSave`                              | `"off"`                                            | window      | user     |                                                                                                                 |
| `files.autoSaveDelay`                         | `1000`                                             | window      | user     |                                                                                                                 |
| `files.showHidden`                            | `false`                                            | window      | user     |                                                                                                                 |
| `lsp.experimental.tyForPython`                | `false`                                            | machine     | advanced |                                                                                                                 |
| `lsp.idleTimeoutMs`                           | `120000`                                           | machine     | advanced |                                                                                                                 |
| `lsp.downloadRuntimes`                        | `true`                                             | machine     | advanced |                                                                                                                 |
| `lsp.servers`                                 | `{}`                                               | machine     | internal |                                                                                                                 |
| `lsp.languageServers`                         | `{}`                                               | machine     | internal |                                                                                                                 |
| `lsp.semanticTokens.enabled`                  | `false`                                            | machine     | advanced | Off because identifier colour can land on unpainted text for up to 1.5 s. Delta does nothing while this is off. |
| `lsp.semanticTokens.delta`                    | `true`                                             | machine     | advanced | Turned on 2026-09-25 (this plan's first commit).                                                                |
| `lsp.semanticTokens.servers`                  | `{}`                                               | machine     | internal |                                                                                                                 |
| `providers.instances`                         | `[]`                                               | application | user     |                                                                                                                 |
| `models.hidden`                               | `[]`                                               | application | user     |                                                                                                                 |
| `keybindings.preset`                          | `"default"`                                        | application | user     |                                                                                                                 |
| `keybindings.overrides`                       | `{}`                                               | application | user     |                                                                                                                 |

### Rows to look at first

- `lsp.semanticTokens.enabled` gates `lsp.semanticTokens.delta`. With it off, the delta default
  changes nothing. Its comment gives the reason for off: a warm server answers before the
  highlighter, so identifier colour can land on otherwise unpainted text for up to 1.5 s. Check
  whether that is still true since the first-paint snapshot and E035's token store.
- `chat.defaultRuntimeMode` is `full-access`. That fits the owner; its details say so.
- `chat.contextWindowMeterEnabled` shipped in Plan 141 and is off.
- `chat.textGenerationModel` points at Codex, which has no credit until 2026-09-26. The provider
  fallback covers it; check whether the default should be the model that usually answers.

### Part A results (2026-09-26)

All 105 keys read (the inventory above predates 25 of them: `chat.sendShortcut`,
`chat.activeFileContext`, `chat.pushNotifications`, the `chat.autoSettle*`, `git.*`, `workbench.sounds.*`,
`workbench.feel`, `editor.markdownView`, `files.picker.view`, `files.watchDirectoryLimit`,
`developer.*Minutes`, `models.favorites`).

- **Changed:** `chat.contextWindowMeterEnabled` defaults to on. It was off only to match T3 Code's
  default; the meter and its popover (what fills the window, compaction reserve, session cost) are
  built and nothing else shows them.
- **New `dependsOn`:** `chat.defaultInteractionMode` under `chat.planModeEnabled` (the composer forces
  default mode while plan mode is off, so the row had nothing to pick).
- **Kept, with the reason in `details`:** every other default. `lsp.semanticTokens.enabled` stays off:
  on a first open with no saved paint the host notifies contributions before syntax is requested
  (`Editor.ts` document notify, then syntax request) and the semantic layer paints without waiting
  for syntax, so the 1.5 s race is still there; reopening with a saved paint is safe (the
  provisional view skips range highlights). Turning it on needs the Editor to hold semantic paint
  until syntax has painted once.
- **Inventory note corrected:** `chat.textGenerationModel` picks the session-title model only;
  commit messages have their own fallback chain in `commit-message-generator.ts`.
- **Copy fixed in the registry:** `workbench.surface.continuousSeams`, `editor.inputRoute`,
  `lsp.experimental.tyForPython` (contrast phrasing), and the "…is independent" clauses on
  `chat.contextWindowMeterEnabled`, `chat.textGenerationModel`, `chat.sessionSortOrder`,
  `lsp.semanticTokens.servers`; `chat.followUpBehavior` now names the alternate key correctly.
- **Found, left for later:** `requiresRestart` on `editor.minimap.enabled` and
  `editor.guides.indentation` looks stale (both now rebuild the editor's plugins from the live
  value in `editor.tsx`); enum options show raw ids for several keys (`chat.sendShortcut`,
  `chat.defaultRuntimeMode`, `files.autoSave`, `window.transparency`, …) because
  `settingOptionTitle` names only three keys.

## Part B — details on every setting that has a story

### What exists

- `SettingDescriptor` (`packages/contracts/src/settings/registry.ts`) has `description`,
  `title`, `keywords`, `readOnlyReason`, `deprecationReason`. It has no field for longer
  reasoning.
- The reasoning lives in code comments above `default:`, in commit messages and in deleted plans.
  The user never sees it. `lsp.semanticTokens.delta` is the example: its measurement (1.60 MB,
  14.1 ms of `JSON.parse` and 9.0 MB of heap for whole files against 1.9 KB, 0.1 ms and 2.0 MB
  for deltas; about 5 of 37 servers support delta) was in a comment and a plan.
- `setting-row.tsx:86` renders `descriptor.description` as one muted line.
- `scripts/generate-settings-schema.ts` already emits `markdownDescription` for deprecated keys,
  which is what the settings JSON editor shows on hover.

### Steps

1. Add `details?: string` to `SettingDescriptor`: short plain paragraphs, facts with their source
   (machine, server version, file measured). `registryProblems` rejects an empty string.
2. Render it on the row as a small info icon after the title, with a `Tooltip` (icon-only
   control, so `Tooltip` per `AGENTS.md`). Icon size `size-(--icon-size-sm)`. A row without
   `details` renders no icon (D1).
3. Emit it into `schema.json` as `markdownDescription` (`description` + blank line + `details`),
   so `settings.json` hover carries the same text, and into `docs/settings-reference.md`.
4. Write details for every row Part A found a story for, and none for a self-explanatory row.
   Move user-relevant facts out of the
   code comment into `details`; the comment keeps only what matters to someone editing code.
5. Scenario `settings-row-details` under `scripts/agent/scenarios/`: hover the delta row's icon,
   screenshot the tooltip. `look` on the Language servers section.

### Order

Part B's field and UI can land before Part A finishes. The text for each row lands with that
row's Part A decision, since both come from the same reading.

## Part C — copy says what a thing is

The rule is in `AGENTS.md` under **Copy**. This part applies it to what already exists and gates
the parts that can be gated.

### Size

A rough `rg` for contrast phrasing (`, not `, `— not `, `; not `, `rather than`, `instead of`)
inside string literals, tests and comments excluded:

| Area              | Hits |
| ----------------- | ---- |
| `apps/web/src`    | 148  |
| `apps/server/src` | 88   |
| `packages`        | 22   |
| `apps/tui/src`    | 2    |

These are upper bounds; many are log strings no user reads. Negated facts ("That path is not a
folder", "does not register", a type error) are outside the sweep (D2). The settings registry has two: `lsp.semanticTokens.delta`
(fixed) and `workbench.surface.continuousSeams` ("…, instead of showing the wallpaper in the gap").

### Steps

1. **Registry gate.** A test in `packages/contracts/src/tests/` runs the contrast patterns over
   every `description`, `details`, `title`, `readOnlyReason` and enum label. Fix what it finds.
2. **Error catalog gate.** `bun run errors:census` gains the same check over each catalog entry's
   `message`, `why` and `fix`. These reach the toast, so they are copy. Fix what it finds.
3. **UI sweep.** JSX text, toasts, empty states, tooltips, `title` attributes and `aria-label`s in
   `apps/web/src`, `packages/ui/src` and `apps/tui/src`, feature by feature. No gate for this
   part: the patterns hit too many code strings to fail a build on. One commit per feature so a
   review reads cleanly.
4. `look` on each surface whose visible text changed, per the verification rule.

## Decisions (owner, 2026-09-25)

- **D1 — a small info icon with a `Tooltip`**, only on rows that have `details`. Self-explanatory
  rows get neither.
- **D2 — negated facts stay.** "That path is not a folder" and type errors state what happened;
  the sweep leaves them alone. It cuts contrast clauses ("…, not latency", "rather than",
  "instead of").
- **D3 — comments and docs are out of the sweep.** Docs follow the Copy rule where it reads
  naturally; nobody rewrites them for it.
- **D4 — sensible defaults, decided in the audit.** No owner table. Rows that stand out as not
  sensible change, and the report names each one.

## Part D — settings that depend on another setting

Added 2026-09-26 (owner, from [Plan 177](177-prefetch-every-press.md)'s settings question). A registry
entry may name a parent with `dependsOn: '<key>'`. The settings page renders it indented under the
parent and disabled while the parent is off, with the parent named in its details. The resolver
treats a child as off whenever its parent is off, so consumers read one value. First users:
`prefetch.files`, `prefetch.diffs` and `prefetch.chats` under `prefetch.enabled`; the Part A reading
lists other keys that are really sub-options of a toggle. One registry field, one row treatment, a
resolver test, and the settings scenario covers a disabled child.

## Phases

1. Part A reading for all 80 rows; change the ones that are not sensible, in one commit.
2. Part B field, row icon, schema and reference output, scenario; details for rows decided so far.
3. Part C steps 1–2 (registry and catalog gates) with their fixes.
4. Part C step 3, feature by feature.
5. Part D `dependsOn`, before Plan 177's settings land.
