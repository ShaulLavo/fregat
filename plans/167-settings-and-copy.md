# Plan 167: Settings defaults, setting details, and copy that says what things are

## Status and authorization

- Status: PROPOSED. The owner asked for it on 2026-09-25, after reading the
  `lsp.semanticTokens.delta` row.
- Already landed with this plan: `lsp.semanticTokens.delta` defaults to on, its description is
  rewritten, and `AGENTS.md` has a **Copy** section (say what a thing is; never what it is not).
- Effort: L. Three independent parts; each is its own phase and can ship alone.
- Risk: LOW for parts B and C (text and one new optional descriptor field). Part A changes
  behaviour for anyone on defaults, one row at a time, each row decided by the owner.
- Planned at: Platform `a3274e1d`, 2026-09-25.
- Server-read keys (`lsp.*`, `chat.keepImportedSessionsUpdated`, …) ship with
  `bun run deploy --server`; everything else with `bun run deploy`.

## Outcome

- Every setting's default was chosen on purpose, and the reason is written down.
- Every setting whose default rests on a measurement, a trade-off or a server quirk shows that
  reasoning in a details tooltip on its row, and in `settings.json` hover.
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
4. Write a recommendation: keep, flip, or change the value, with one sentence of reason.

The output is a decision table in this plan (below the inventory) that the owner fills in. One
pass then applies every accepted change and regenerates `schema.json` and
`docs/settings-reference.md` (`bun run settings:schema && bun run settings:reference`).

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
- `chat.defaultRuntimeMode` is `full-access`. That fits the owner; say so in its details.
- `chat.contextWindowMeterEnabled` shipped in Plan 141 and is off.
- `chat.textGenerationModel` points at Codex, which has no credit until 2026-09-26. The provider
  fallback covers it; decide whether the default should be the model that usually answers.

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
2. Render it on the row as an info icon after the title, with a `Tooltip` (icon-only control, so
   `Tooltip` per `AGENTS.md`). Icon size `size-(--icon-size-sm)`.
3. Emit it into `schema.json` as `markdownDescription` (`description` + blank line + `details`),
   so `settings.json` hover carries the same text, and into `docs/settings-reference.md`.
4. Write details for every row Part A found a story for. Move user-relevant facts out of the
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

A rough `rg` for contrast phrasing (`, not `, `— not `, `rather than`, `instead of`, `does not`,
`is not`, `won't`, …) inside string literals, tests and comments excluded:

| Area              | Hits |
| ----------------- | ---- |
| `apps/web/src`    | 364  |
| `apps/server/src` | 229  |
| `packages`        | 69   |
| `apps/tui/src`    | 16   |

These are upper bounds. Many are log strings that no user reads, and many are negated facts such
as "That path is not a folder" (D2). The settings registry has two: `lsp.semanticTokens.delta`
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

## Decisions for the owner

- **D1 — tooltip or disclosure.** A `Tooltip` opens on hover and focus; on the phone (the mesh
  is reachable from the owner's devices) a tap on the icon is the only way in. Recommendation:
  `Tooltip`, as asked, and check it on the phone in Phase 2. If tapping feels wrong there, switch
  the icon to a `Popover`.
- **D2 — negated facts.** "That path is not a folder" states what happened. Recommendation:
  rewrite to the positive when one exists ("That path is a file"), keep a real absence ("No
  sessions", "Signed out"), and always cut contrast clauses ("…, not latency").
- **D3 — comments and docs.** Recommendation: out of scope. The rule covers what the app shows;
  code comments and plans keep explaining trade-offs, which often means naming the rejected
  option.
- **D4 — per-row defaults.** Decided row by row in the Part A table.

## Phases

1. Part A reading and recommendations for all 80 rows → owner decides → apply in one commit.
2. Part B field, row icon, schema and reference output, scenario; details for rows decided so far.
3. Part C steps 1–2 (registry and catalog gates) with their fixes.
4. Part C step 3, feature by feature.
