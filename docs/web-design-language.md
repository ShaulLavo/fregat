# Web design language

The web app shares its design tokens and controls through `@workspace/ui`. The settled rules
live in [`AGENTS.md`](../AGENTS.md#the-design-language); the census rejects conflicting call-site
choices. This reference records ownership, deliberate exceptions, and verification.

## Owners

| Area                | Contract                                                                                                                                  | Owner                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Corners             | Controls use `md`, floating surfaces use `lg`, and bars, rows, panes, and tabs are square. Primitives own their corners.                  | [`globals.css`](../packages/ui/src/styles/globals.css) and the shared controls                                 |
| Bars                | Horizontal bars measure 36 px compact and 40 px cozy. Vertical rails use the same dimension.                                              | [`PaneBar`](../packages/ui/src/components/pane-bar.tsx), `--bar-height`, `--bar-padding-x`, and `--rail-width` |
| Density             | Shared `--density-*` variables supply changing dimensions; the old `compact:` variant is gone.                                            | `globals.css` and the appearance provider                                                                      |
| Dividers            | None. Surfaces separate by tone; chips and callouts are fills. Edge borders and `border-border`/`border-subtle` fail the census.          | `hairlines` in `web-design-census.mjs`; floating surfaces keep `ring-1 ring-foreground/10`                     |
| Type                | UI sizes are `text-sm`, `text-xs`, `text-2xs` and `text-3xs`. Bar titles use `text-xs font-medium`. Changing numbers use tabular figures. | The theme type scale and consumers                                                                             |
| Fills and elevation | Rows use the row tokens, toggles use `bg-accent`, menus use `shadow-md`, and modals use `shadow-xl`.                                      | Shared primitives and row consumers                                                                            |

The delivered bar sizes preserve the dominant existing 36/40 px geometry while bringing outliers
onto the same tokens. The original proposal's 32/36 px values were superseded during implementation.
Light-mode pane separation and the shared focus treatment were completed in `706d1d79`.

## Rows and lists

[`ListRow`](../packages/ui/src/patterns/list-row.tsx) owns a square row at
`--density-row-height`, with `--density-row-padding-x` and `text-xs`. Hover uses `bg-row-hover`,
press uses `bg-row-active`, and `aria-selected` uses `bg-row-selected`. The secondary cell stays
muted when selected. Rows have no animation or individual focus ring.

`data-marked` adds an inset `ring-ring/40` outline for multiselection, independently of selection.
Disabled rows carry `aria-disabled`, keep their native title, and receive no hover or press paint.
The two-line session row keeps its explicit automatic height and density padding.

[`useListbox`](../packages/ui/src/patterns/use-listbox.ts) keeps focus on the container with
`aria-activedescendant`. Rows have `tabIndex=-1`. Up/Down, Home/End, and PageUp/PageDown move without
wrapping or visiting disabled rows. Tree lists expand, collapse, and visit parents or children.
Enter commits; Space may select separately. Modifier chords and nested controls retain their own
handlers. Typeahead is opt-in. The container carries `focus-ring-inset`.

[`VirtualList`](../packages/ui/src/patterns/virtual-list.tsx) reads row height from the density
token and observes its computed size. It overscans twelve rows, reveals the active row at the
nearest edge, and preserves the viewed row when density changes. Measured flow layout lets an
expanded log or variable-height chat message move following content immediately. Editor line
windowing remains specialized. The file tree keeps its shadow-root keyboard and windowing model;
the app bridges its hover and height to the same row tokens.

## Pane shells and hints

[`ToolPane`](../packages/ui/src/patterns/tool-pane.tsx) supplies the header and body layout.
`ToolPaneHeader` composes `PaneBar` with a `text-xs font-medium` title, optional muted detail,
and trailing actions. There is no leading title icon. Additional control rows use `PaneBar` through
the subheader slot. Bodies have no default padding and carry `focus-ring-inset`.

The shell chooses pending, error, empty, then content. Feature skeletons use `LoadingState` and
resolved empty states use `EmptyState`. A terminal keeps its host mounted during initialization,
with its waiting or error overlay inside a headerless shell, because initialization needs that DOM
host. App header menus and collapse actions stay in the app adapter.

Icons use `--icon-size` on controls and headings and `--icon-size-sm` inside rows and running text.
Their cozy sizes are 16 and 14 px; compact sizes are 14 and 12 px. Text has two colors,
`text-foreground` and `text-muted-foreground`. A quieter label uses `text-2xs`, not color alpha.
Whole-control disabled opacity and fully hidden row actions are deliberate exceptions.

Icon-only controls have a `Tooltip` on the bottom side with the provider's delay. Moving between
tooltips under that provider opens the next tooltip immediately. Native `title` recovers a
truncated value and never duplicates a tooltip. Updating counts and times use `tabular-nums`.

[`web-design-allow.json`](../scripts/lint/web-design-allow.json) records each exception with its
reason. Other exceptions cover sortable document tabs, minimap marks, keyboard-selected command
options, a circular jump control, square inner fields and tooltip arrows, and inline chips whose
type size follows the surrounding prose. They are checked individually rather than hidden by a
broad directory exclusion.

## Enforcement

[`web-design-census.mjs`](../scripts/lint/web-design-census.mjs) parses class expressions with
`oxc-parser`, including multiline expressions and TypeScript class-string owners. It validates
radius, density variants, bar heights, dividers, type sizes, elevation, buttons, row fills,
icon size tokens, text alpha, icon-only hints, and palette leaks. Invalid allow-list entries and
parse failures fail the gate.

`bun run design:census` runs the current repository check. Root `verify` and CI include it.
[`web-design-census.test.ts`](../scripts/lint/web-design-census.test.ts) covers extraction and
enforcement. The independent implementation audit recorded 122 claims from 129 reviewers,
including 69 confirmed findings and 53 refutations with source evidence; a further review covered
focus and palette behavior.

## Verification

The real-app visual verifier measures the actual titlebar, editor strip, loaded pane headers,
and bottom panel through the running Mesh app. Its loading helper holds real HTTP responses,
captures the mounted waiting state, then releases the original response and compares the loaded
header. The matrix uses both interface densities and both color schemes through the production
settings API and restores the original setting values afterward.

The earlier synthetic `PaneBar` and surface tests remain useful primitive checks. Real-app
measurements supply the integration evidence those tests could not provide.

Run the browser check against an existing app and an isolated verification workspace:

```sh
node apps/web/scripts/verify-web-design.mjs \
  --fixture /work/tmp/platform-plan100-closeout/fixture.json \
  --output-dir /work/tmp/platform-plan100-closeout/visual
```

The fixture JSON identifies `appUrl`, `serverUrl`, `origin`, `primaryEnvironmentId`,
`directory`, `workspace`, `sessionId`, and `sessionTitle`. Use a disposable registered Git
workspace with `alpha.ts`, a modified `beta.ts`, `docs/readme.txt`, and a metadata-only chat
session. The verifier creates browser contexts, switches the two appearance settings through
`settings/write`, and restores the original raw values. It stops if a concurrent user edit changes
an owned setting. It does not create a server. The caller owns fixture and index-root cleanup.

The JSON report records computed geometry, served asset URLs, HTTP evidence, and cleanup.
Each surface has a plain screenshot and a copy with bar rulers. Loading captures delay real
responses and return their original payloads. Recovered pre-implementation screenshots were
blank, so the comparison uses the recorded pre-migration census and bar measurements, plus
valid current captures. Those blank files are not visual evidence.

The widened static review covers Button dimensions, line heights, bar gaps, arbitrary values,
color-mode branches, important declarations, inline styles, and TypeScript class-string owners.
Its recorded snapshot contains 8 numeric Button overrides, 53 line-height utilities using 9 values,
16 bar-gap candidates, no arbitrary minimum heights, 19 arbitrary widths, 282 arbitrary-pattern
utilities, 33 color-mode variants, 16 important declarations, and 45 inline styles. The review
classified every remaining candidate by its content layout, runtime measurement, shared control,
or external renderer owner. All 17 census exceptions have individual reasons.

## Closeout evidence, 2026-09-12

The Mesh run passed all 52 surface cases, 13 surfaces at each of the four density/color
combinations. The actual titlebar, editor strip, Files and Git headers, bottom panel, and picker
bars measure 36 px compact and 40 px cozy. Editor-tab gaps measure 4/6 px, file-tree rows have
square corners, ordinary controls use 8 px corners, and floating controls use 10 px corners.
Floating controls have opacity 1, opaque backgrounds, and no backdrop filter after entrance
animations settle. Each capture contains rendered content and a second copy with bar rulers.

Closeout fixes removed repeated Button dimensions, moved two constant scroll-anchor styles to
Tailwind, applied shared gaps to the editor and code-theme preview bars, and reset the external
tree's rounded-row default. Search now reserves the same summary height before and after results.
The Settings skeleton uses the loaded page's count-line height and responsive header layout.

The loading matrix passed all 52 cases, 13 waits across the same four variants: Files, Git,
Logs, Search, Settings, editor documents, chat sidebar, chat stage, Terminal, Problems,
file picker, model picker, and narrow Settings. Retained headers keep their DOM identity;
replaced skeleton headers match the loaded geometry. Real HTTP payloads and WebSocket frames
are held and released unchanged. Fixture terminals are disposed through their real protocol.

At a 900 px viewport, the app's existing minimum width lets Settings autofocus scroll an
overflow container horizontally. The report records this scroll separately and compares
unscrolled coordinates. The narrow Settings container is 655 px and uses the actual responsive
grid; its header is 125 px compact and 133 px cozy in both loading and loaded states. This
proves matching layout, not an unchanged viewport scroll position.

The published web release is `20260912T165136Z-430915c7-plan100`, serving
`/platform/assets/index-B0rBROyF.js`. Typecheck, scoped lint and formatting, the 1,108-file census,
and the production build passed. The sustained Mesh smoke loaded 21 assets with no page errors,
console errors or warnings, failed HTTP responses, or loopback requests. Rapid-navigation visual
runs separately record cancelled requests; these are retained in the evidence.

Local artifacts are under `/work/tmp/platform-plan100-closeout/`:

- `visual/index.html` compares the four variants, with plain images and ruler overlays.
- `visual/results.json` records all 52 surface cases and the served asset.
- `loading-final/results.json` records all 52 loading cases and terminal cleanup.
- `loading/owner-coverage.json` records pane ownership and nested waits sharing those headers.
- `loading-divider-restore/results.json` verifies exact divider restoration after the narrow check.
- `cleanup.json` confirms fixture session/project deletion, workspace removal, index restoration,
  and the original compact/system appearance values.
- `static/README.md` records the widened scan and individual exception review.
- `static/verifier-review.json` records the independent review of the new verification code.
- `static/visual-review.json` records independent inspection of 28 final screenshots.
- `implementation-review/` preserves the original implementation audits.

The release directory retains the source diff, build configuration, build output, deployment
receipt, and `live-check.json` so the verification can be tied to the served files.

The completed plan file is deleted. Its dependent plans and census exception links now point to
this reference. Verification restored the original `/work/projects/platform` index root and
removed the disposable workspace, project and session. No provider turn ran.

The native window titlebar keeps its semantic `<header>` and runtime grid for desktop drag regions.
It uses `--bar-height` and `--bar-padding-x`; pane headers compose `ToolPaneHeader`/`PaneBar`.
