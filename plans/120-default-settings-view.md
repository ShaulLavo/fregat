# A readable defaults layer

Status: proposed. Requested 2026-09-15, after [Plan 116](116-wallpaper-library.md) renamed a setting key and every existing user's value for it was silently dropped.

The ask was a VS Code-shaped split: a read-only defaults document, and a separate user file layered on top, so the user file cannot grow without bound. Most of that already exists — this plan writes down which part, and builds the part that does not.

## Starting point

| Piece        | Current state                                                                                                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Defaults     | `SETTINGS_REGISTRY` in [`keys.ts`](../packages/contracts/src/settings/keys.ts). Code, not a file — read-only by construction, with no path a user could write to. `DEFAULT_SETTING_VALUES` is the frozen document derived from it.                                                                  |
| Layering     | [`resolve.ts`](../packages/contracts/src/settings/resolve.ts) already layers `user` → `workspace` → `policy` over those defaults, and already reports `effectiveLayer: 'default'` when no layer contributed.                                                                                        |
| User file    | `~/.platform/settings.json`, holding only keys that have been written. 8 entries against a 55-key registry on the requesting machine.                                                                                                                                                               |
| Pruning      | `resetSettings` deletes a key outright; `replaceOrResetDefault` prunes four record-shaped keys when they return to their default. A **scalar** set back to its default is written, not pruned.                                                                                                      |
| Viewing      | [`json-view.tsx`](../apps/web/src/features/settings/components/json-view.tsx) already renders a layer's file in an editor, switched by [`ViewToggle`](../apps/web/src/features/settings/components/view-toggle.tsx) and [`ScopeTabs`](../apps/web/src/features/settings/components/scope-tabs.tsx). |
| Retired keys | [`migrations.ts`](../packages/contracts/src/settings/migrations.ts) carries every id that has left the registry, and `settings-migrations.test.ts` fails the build when one leaves without an entry.                                                                                                |

## The part that is already done

The architecture this plan was asked to build is the architecture in the repo. Defaults live in code and cannot be edited; the user file holds overrides only. The concern behind the request — "our settings file will grow very, very large" — does not hold: the file is bounded by the number of keys the user has actually touched, and the registry itself is 55 keys. There is no copy of the defaults on disk to drift out of date, which is the failure mode a real `defaultSettings.json` file would introduce.

Two things are genuinely missing, and neither is a refactor.

## Decisions

| Decision                                            | Behavior                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — the defaults document is generated             | A `default` entry joins the scope tabs, rendering a JSON document built from the registry at read time: every key, its default, and its `description` as a preceding comment. Generated on request, never written to disk, never parsed back. A file would be a second source of truth for values the registry already owns. |
| D2 — it is read-only, and says why                  | The document opens in the existing JSON view with editing disabled and a one-line banner pointing at the user tab. VS Code's silent read-only buffer makes people type into it first and find out second.                                                                                                                    |
| D3 — it carries provenance, not just values         | Each key's comment block also names its scope and, where set, `requiresRestart` and `deprecationReason`. This is the document someone reads to answer "what can I even set", so the answer includes where it may be set.                                                                                                     |
| D4 — a scalar written back to its default is pruned | `replaceSetting` gains the `replaceOrResetDefault` behaviour for every key, not just the four record-shaped ones. Toggling a setting on and off currently leaves it in the file at its default value, which is how a sparse file slowly stops being sparse.                                                                  |
| D5 — no defaults file on disk, ever                 | Stated as a decision because it is the tempting next step and it is the wrong one: a materialised defaults file is a cache of the registry that goes stale across upgrades, and stale defaults are indistinguishable from user intent once they are sitting in a file.                                                       |

## Where the code goes

| Change                                                                         | File                                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `defaultSettingsDocument()` — registry to commented JSON text                  | `packages/contracts/src/settings/defaults-document.ts` (new)                |
| `'default'` as a viewable target, distinct from the writable `SettingsLayerId` | `packages/contracts/src/settings/wire.ts`                                   |
| Prune any key whose new value equals its registry default                      | `packages/contracts/src/settings/mutations.ts`                              |
| The extra tab, and read-only wiring for it                                     | `apps/web/src/features/settings/components/scope-tabs.tsx`, `json-view.tsx` |
| The same document behind a TUI view                                            | `apps/tui/src/settings/`                                                    |

## Acceptance

- The `default` tab renders every registry key with its default and description, and the editor rejects edits.
- `defaultSettingsDocument()` output parses as JSONC, and every value in it round-trips through its key's schema.
- Setting a scalar to its default removes the key from the user file; setting it to anything else writes it.
- No file is created under `~/.platform/` by opening the defaults view.
- The user file on the requesting machine still holds only keys that were deliberately set.

## Not in this plan

Rewriting `~/.platform/settings.json` to chase renames. Migration is read-time by design — see the header comment on `migratedEntries` in `resolve.ts`. A settings file the app rewrites on launch is a settings file that cannot be rolled back to an older build.
