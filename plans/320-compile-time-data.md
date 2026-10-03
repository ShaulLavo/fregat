# Plan 320: Derive static data during compilation

## Status and authorization

- Status: Approved. Source research completed 2026-10-03; execution starts with the compatibility proof below. No application migration has started.
- Owner request: one plan for settings defaults, bundled themes, Unicode bidi data, and settings search, plus a fifth, tentative file-icon investigation. Compare existing libraries and a narrow local implementation before choosing the tool.
- Priority: P2. Effort: M. Risk: medium, concentrated in dependency invalidation and build/test integration.
- Planned against Fregat `6d8e76870`. Before execution, run `git diff --stat 6d8e76870..HEAD -- apps/web packages/contracts packages/client-core editor/scripts editor/packages/editor scripts/icons` and reconcile changed code with the evidence below.
- Order: compatibility proof → defaults pilot → themes → bidi → search. Icon investigation may run alongside the proof; icon migration is conditional on its recorded result.
- This planning pass records source findings and one read-only Bun probe. It does not claim that a library has passed our production, development, or test pipelines.

## Outcome

Keep static derivations as typed functions next to the data they own, validate shipped inputs during compilation, and emit the finished values. Remove generated TypeScript emitters and runtime preparation where the selected tool proves simpler. Preserve user-data validation, lazy loading, published package contracts, licensing, and the existing appearance.

The four selected opportunities are Approved work after their proof gates. The fifth is an Approved feasibility investigation, with its migration decision recorded here. A missing performance measurement requires a bounded baseline, not abandonment of the work.

## Current code

| Unit             | Current behavior                                                                                                                                                                    | Intended change                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Defaults         | `packages/contracts/src/settings/defaults-document.ts:28` formats the fixed registry as JSONC; `apps/web/src/features/settings/utils/defaults-file.ts:7` stores a lazy module cache | Emit the same document as a constant and remove the consumer's formatting/cache bookkeeping                |
| Themes           | `packages/contracts/src/themes/bundled.ts:238` parses ten fixed documents, including color conversion; `themes/bundles.ts:68` validates six packs during module loading             | Validate bundled inputs during compilation and emit plain palettes/themes                                  |
| Bidi             | `editor/packages/editor/scripts/generateBidiClass.mjs:85` derives a regex from pinned Unicode data; lines 110–129 write/check generated TypeScript                                  | Keep derivation/checks; replace the source-text emitter and generated-file upkeep                          |
| Search           | `packages/client-core/src/settings/search.ts:17` derives row membership and normalizes fixed metadata per query; `settings/keys.ts:2149` scans setting ids for owned keys           | Precompute weighted searchable fields and membership; keep query scoring/filtering dynamic                 |
| Icons, tentative | `scripts/icons/generate.ts:35` produces glyph TS, rule TS and CSS; `apps/web/src/lib/file-icons.ts:89` separately assembles the SVG sprite at runtime                               | Investigate generated TS cleanup and sprite preparation separately, keeping CSS/scanner contracts explicit |

Current defaults consumer:

```ts
let cached: SettingsLayerFile | null = null

export function defaultsLayerFile(): SettingsLayerFile {
  cached ??= {
    text: defaultSettingsDocument(),
    revision: DEFAULT_SETTINGS_DOCUMENT_REVISION,
    parseErrors: [],
    keyRanges: {},
  }
  return cached
}
```

Current palette derivation:

```ts
export const BUNDLED_PALETTES: readonly Palette[] = Object.freeze(
  BUNDLED_PALETTE_DOCUMENTS.flatMap((document) => {
    const parsed = parsePalette(document, 'bundled')
    return parsed.success ? [parsed.palette] : []
  }),
)
```

Current settings search gives id/title matches weight 3, category/keyword matches weight 2, and description matches weight 1. A row takes the maximum score of its own key and the keys it owns. Matching rows sort by descending score, then `localeCompare` on the id. Preserve all of these rules.

The icon generator is an explicit script, not a runtime or startup generator. Its emitted rule module deliberately includes literal Tailwind classes. `fileIconSpriteSymbols()` is the distinct runtime derivation; moving it may duplicate glyph strings still used by individual icon rendering.

## Research and tool choice

Research checked primary source on 2026-10-03. Pin the actual tested package versions and source commits in the proof receipt; source support and a successful install are not execution evidence.

Published versions observed during research: `unplugin-macros` 0.23.2, `comptime` 0.1.0, and `comptime.ts` 0.8.1. Current repository source can differ from a published tarball; run the proof against the exact installed version.

| Option                                                                                                                                                                     | Source findings                                                                                                                                                                                                                                                                                                                                                                                     | Role in the proof                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [unplugin-macros](https://github.com/unplugin/unplugin-macros/tree/0ffe5f97b75fcb16fab89fd7146d3b51ffd9f675) plus [native Bun macros](https://bun.com/docs/bundler/macros) | Current source exposes Vite/Rolldown adapters and uses `with { type: 'macro' }`; Bun recognizes that syntax natively. Its source tests use Vite 8. Plain Node needs the transform. The default runner's dependency tracking uses Node `registerHooks`; we run Vite on Bun, so runner choice needs proof                                                                                             | First option to test for one source syntax across Vite and Bun. Prefer synchronous, context-free functions returning strings/plain data initially                                      |
| [lukeed/comptime](https://github.com/lukeed/comptime/tree/5a6d2d38567b7056e5f2cea8f508d57fa5e80810)                                                                        | This is a separate library, npm `comptime`, with Vite/Rolldown adapters and Vite 8 peers. `comptime(() => work())` captures referenced imports/declarations and serializes via devalue. No Bun adapter; its untransformed helper throws                                                                                                                                                             | Compare on the same fixture; favor it if it gives a simpler complete integration, rather than introducing a new bundling step for source-used packages                                 |
| [feathers-studio/comptime.ts](https://github.com/feathers-studio/comptime.ts/tree/656d05b4617509cd3f667a95343df60ae39978e5)                                                | Published 0.8.1 has Vite 6/7 peers, but the adapter APIs also exist in our installed Vite 8.3.1. The 52-line adapter sits on a 582-line evaluator with TypeScript symbol analysis. Its scanner selects tsconfig root files; our web solution config has `files: []`. Source inspection also found that its HMR filtered recalculation can overwrite other consumers' replacements with empty arrays | Retain in comparison; explicitly reproduce scanning, missed transformations and update behavior. The peer range alone is not an observed Vite 8 failure                                |
| Narrow local implementation                                                                                                                                                | A declared generator-to-virtual-module adapter can avoid arbitrary-expression analysis. It still needs fresh evaluation, dependency tracking, diagnostics, deterministic output, source maps and all relevant build/test boundaries                                                                                                                                                                 | Fallback only if the existing options fail a recorded required case. Compare total maintained code/dependencies. Do not copy a general compiler just because its Vite wrapper is short |

If copying substantial upstream code, preserve its MIT copyright and permission notice. Restrict any owned evaluator to declared local generators and supported data results; exclude closure/function serialization and general local-expression interpretation.

For unplugin, evaluate its optional `unrunRunner` against our Bun-hosted Vite process and extensionless imports inside helper modules; it bundles helpers through Rolldown and collects their module graph. Use explicit extensions for macro import specifiers where the selected runner requires them. File reads outside the module graph still need explicit invalidation proof. Avoid async macros in the initial integration: native Bun awaits results automatically, while unplugin requires an explicit `await` at the call site.

[babel-plugin-preval](https://github.com/kentcdodds/babel-plugin-preval#usage) was considered and rejected for this plan: its Babel transform and synchronous Node/CommonJS evaluator add another execution model without covering our direct Bun consumers.

Read-only probe passed on installed Bun 1.4.2:

```sh
bun -e 'import { basename } from "node:path" with { type: "macro" }; console.log(basename("/compile-time-proof/defaults.jsonc"))'
```

It printed `defaults.jsonc` and exited 0. This proves a source-run primitive macro works, not that our symlinked workspace helpers, RegExp results, or development updates work. Native Bun serialization differs from the Vite libraries; test the actual result types. Bidi can return `{ source, flags }` and construct a RegExp from those constants if direct RegExp output is unsupported.

## Scope and constraints

- Keep generators with their domain. A shared adapter belongs in `scripts/compile-time/`; do not introduce a new public package for four consumers.
- Existing integration points: `apps/web/vite.config.ts`, affected Vitest configs, `editor/scripts/build-package.ts`, and Bun's existing source/build entry points. Contracts/client-core export source TS, contracts tests use plain Node Vitest, server development runs Bun source, and Editor ships `dist` JS plus declarations. Client-core currently has no Vitest config; include its own Node transform configuration in the chosen integration.
- The TUI also consumes client-core search through `apps/tui/src/settings/components/browser.tsx`. Its current `apps/tui/package.json` build uses `--packages external`, which leaves shared source dependencies external. G0 must prove its real deployed path and arrange build-time consumption of the affected workspace modules while preserving external third-party/native dependencies. Native Bun source expansion is development evidence; it does not prove that a deployed TUI avoids startup generation.
- Keep contracts/client-core source exports and Editor's published exports. A package-wide conversion to `dist` solely to use macros is outside scope.
- Probe workspace symlinks and optimizer/worker behavior. Bun's macro caller restriction under `node_modules` must be tested against the real symlink layout.
- Match existing typed, readonly contracts. Use `satisfies` or schema-derived types, not casts to pretend an emitted value is validated. Max nesting three. Match structured errors for new failure paths, with observed runtime facts in `internal`.
- No runtime environment values, secrets, home paths, live model catalogs, network downloads or user settings become compile-time inputs. Inputs are checked-in files or pinned installed dependencies.
- Keep runtime schemas/parsers for imported themes, palette editing and stored settings. Do not serialize Valibot schema objects or executable command/React component tables.
- Preserve explicit asset acquisition, compressed dictionaries, lazy TypeScript library imports, tree-sitter assets, palette CSS, settings schema JSON and license notices. They have responsibilities independent of the four derivations.
- Touch package manifests/configs and the lockfile only for the chosen integration. Implementation bumps changed package versions by patch. This documentation pass requires no package bump.

## Execution checklist

### G0: Prove the integration before migrating a consumer

- [x] Inspect all four derivations and the icon script/runtime boundary.
- [x] Research existing tools, upstream evaluator internals and a narrow owned fallback.
- [x] Confirm native Bun expands a primitive macro in source execution.
- [ ] Create a bounded isolated proof on the data SSD, checking its mount/free space before installing dependencies. Preserve a receipt under `docs/compile-time/`; disposable files stay outside repository clones and are cleaned afterward.
- [ ] Test the leading option and `lukeed/comptime` on identical string, plain-object, RegExp or source/flags fixtures. Exercise feathers' adapter where its scanner/watch behavior could change the decision. Record pass/fail, exact versions, commands, output and maintenance cost; stop expanding comparisons once a complete option passes.
- [ ] Prove Vite 8 build/serve, native Bun build/source execution, Node Vitest transformation in contracts and client-core, source workspace symlink imports, Editor preserveModules output and declaration emission. Include production and test entry points that import shared constants, plus the TUI's actual build/run path with its external-package policy.
- [ ] Specify Editor helper placement and declaration packaging before G3. The builder emits declarations/maps from all `src/**/*` with `rootDir: src`; importing a helper from `scripts` can fail that boundary, while a helper inside `src` can emit unwanted published declarations. Inspect a packed artifact and typecheck/import its public exports from a fresh consumer without helper sources, Unicode input or a macro plugin. Make any packaging adjustment explicit and narrowly scoped.
- [ ] Inspect emitted JS and declarations. Build-only helpers, filesystem imports, macro attributes and untransformed wrappers must be absent from shipped runtime modules. Runtime-user parsers may remain where genuinely consumed.
- [ ] In the same running dev session, edit the consumer, direct helper, transitive helper, JSON input and pinned text input; each relevant value must refresh. Edit an unrelated file and confirm existing replacements remain intact. Compare to a fresh build. Probe deletion/failure recovery and repeat builds for deterministic output.
- [ ] Record cold transform/build time and output bytes against an ordinary helper baseline. Keep the probe narrow; avoid a full monorepo scan or switching package export architecture.
- [ ] Select one integration and record any required small adapter changes here. If the existing tools fail, specify and prove the narrow local adapter against the same matrix before using it.

Commit portable, deterministic integration fixtures only after choosing a tool. Put them under `scripts/compile-time/tests/`, wire their test files into `test:scripts`, and create `scripts/compile-time/verify.ts --check` as the emitted-output proof. Filesystem fixtures use OS temp directories; committed checks have no machine-specific paths. This future verifier must fail on unexpanded helpers, wrong values, unsupported results, non-determinism and failed invalidation where the supported watch path is used.

### G1: Settings defaults pilot

- [ ] Capture the current JSONC bytes and relevant settings-chunk size; use `settings-defaults-document.test.ts` as the domain test pattern.
- [ ] Evaluate a narrow formatter helper during compilation; keep generation sourced from the current registry and preserve the `registry` revision, read-only behavior, key/category order, comments and default values.
- [ ] Replace the browser's lazy module cache with the stable constant layer value. Keep the defaults document in its appropriate lazy consumer chunk; avoid importing its whole string into initial boot.
- [ ] Compare exact bytes and chunk sizes, then exercise the actual defaults tab. Verify formatter code disappears from the consumer's optimized path without claiming all registry or Valibot code disappears.

### G2: Bundled palettes and theme packs

- [ ] Extract a bundled-only validation/derivation helper and emit its plain results. Preserve ten palettes and six packs, ordering, ids, source/revision values, wallpaper references and frozen outer palette-array behavior.
- [ ] Make malformed bundled input fail compilation with useful location/type diagnostics; never silently omit it from a successful build.
- [ ] Prove user palette/theme import validation and editing still work at runtime. Keep generated first-paint palette CSS unchanged.
- [ ] Measure import-time preparation and output bytes before/after. Color-object output may be larger than compact authored strings; record that tradeoff explicitly.

### G3: Unicode bidi derivation

- [ ] Refactor the pinned-data parser/checks into a helper returning a supported constant value. Preserve Unicode 17.0.0 input, SHA-256/header checks, 5,362 RTL code points, 60 ranges and shipped license/provenance.
- [ ] Prove the complete Unicode classification matches the existing regex, including supplementary code points, range edges and gaps. Direct regex serialization or `{ source, flags }` must preserve the `u` semantics.
- [ ] Migrate `textCharacters.ts` and `virtualizedTextViewGeometry.ts`; remove the generated TS writer/staleness workflow only once build/test/package proofs cover derivation automatically. Update the package test script so removed `bidi:check` is no longer invoked.
- [ ] Verify published JS/declarations can be consumed without a macro plugin or pinned input file. Keep the input build-only and the license published. This unit simplifies maintenance; it has no assumed runtime speedup.

### G4: Settings search index

- [ ] Establish a bounded baseline using the current registry and representative queries. Compare per-query work and index byte size, separating the benefit of a better data layout from moving its construction to compilation.
- [ ] Derive row-owned keys and normalized weighted fields once. The index must cover every `SettingId` accepted by explicit `ids`, including owned keys, not only visible `SETTING_ROW_IDS`. Preserve substring semantics, maximum score per row, weights 3/2/1, empty-query order, explicit id subsets, duplicate supplied ids, no-match output, ties and `models.order` → `models.hidden` folding.
- [ ] Keep query normalization, matching, sorting and environment-dependent availability at runtime. Do not serialize resolved user settings or connection state.
- [ ] Compare the current scorer and indexed scorer on an exhaustive bounded query corpus from registry fields plus mixed-case, whitespace and no-match cases. Add `packages/client-core/src/settings/tests/search.test.ts` and the package's chosen Node Vitest transform config. Include explicit subsets containing `models.order`, repeated ids and empty-query order; retain the existing web assertions as a consumer check.

### G5: File icons, feasibility before migration

- [ ] Investigate two independent choices: replace script-generated TS maps/glyph data with compiled values; preassemble `fileIconSpriteSymbols()` without duplicating a second copy of all glyph strings.
- [ ] Preserve scanner-visible literal hue/two-tone classes and generated CSS from the same authored rule source. Verify built Tailwind output, SVG gradient/id namespacing, glyph licensing, name/extension precedence, fallback icons and no new standalone icon requests.
- [ ] Measure output bytes and preparation work, and count emitter/check code removed versus adapter/scanner code added.
- [ ] Record Proceed or Defer with the evidence here. Proceed only if the proof preserves source-derived types, CSS coverage and single-source rules with simpler maintenance. A deferral retains the current generator and does not block the four units.

## Verification commands

Run these from the listed directory. Heavy suites, browser runs, builds and benchmarks use `bun /work/platform-production/heavy/current/run.js --class suite|browser|build|bench <label> -- <command...>` with the matching class. A private proof server uses `--server` and an explicit free port; never start the shared dev server manually. Every applicable command must exit 0; inspect output/artifacts rather than inferring success from the exit code alone.

| Directory                       | Command                                                                                                                                                      | What it proves                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Root, after G0 creates verifier | `bun scripts/compile-time/verify.ts --check`                                                                                                                 | Chosen tool emits correct constant output across the required integration matrix                                     |
| `packages/contracts`            | `bun x vitest run src/tests/settings-defaults-document.test.ts src/tests/palette.test.ts`                                                                    | Defaults and palette semantics; expand with actual new bundled-result tests                                          |
| `apps/web`                      | `bun --bun vitest run --project dom src/features/settings/tests/defaults-tab.test.tsx src/features/settings/tests/page.test.tsx`                             | Defaults tab and existing search behavior                                                                            |
| `apps/web`                      | `bun --bun vitest run --project node src/features/settings/tests/theme-bundles.test.ts`                                                                      | Theme pack behavior                                                                                                  |
| `apps/server`                   | `bun --bun vitest run src/themes/tests/bundle-wallpapers.test.ts src/themes/tests/palette-library.test.ts`                                                   | Server consumers and user-palette validation                                                                         |
| `editor/packages/editor`        | `bun x vitest run --project dom test/bidiText.test.ts` and `bun run build`                                                                                   | Bidi behavior and ordinary published JS/declarations; run `bidi:check` for the baseline before deleting its workflow |
| Root                            | `bun run themes:palette-css:check`                                                                                                                           | Bundled first-paint CSS stays synchronized                                                                           |
| Root, icon investigation        | `bun run icons:generate:check`                                                                                                                               | Existing generated output baseline; replace this check only if G5 migrates its responsibility                        |
| `apps/web`, icon investigation  | `bun --bun vitest run --project node src/lib/tests/file-icons.test.ts` and `bun --bun vitest run --project dom src/components/tests/file-type-icon.test.tsx` | Lookup and rendering contracts                                                                                       |
| Root                            | `bun run plans:check`, `bun run gates`, `bun run typecheck`                                                                                                  | Inventory, repository contracts and type integrity                                                                   |
| `apps/web`                      | `bun run build` and `bun run bundle:gate`                                                                                                                    | Real production integration and output-size constraints                                                              |

After G4 creates its test, run `bun x vitest run src/settings/tests/search.test.ts` from `packages/client-core`; it must pass under plain Node with the selected transform. From `apps/tui`, run `bun --bun vitest run src/components/tests/status-layout.test.tsx` and `bun run build`, then have the G0 verifier exercise the built TUI's shared settings imports through the real external dependency layout without a live account or interactive terminal. The production proof must show those static results are prepared during the build, not generated from build-only inputs at application startup.

For each affected user path, use `verify-fregat`: `bun run agent:browser scenario settings-defaults`, `settings-appearance-rows`, and, if G5 proceeds, `file-icons`. Read the captured screenshots. Add a bounded settings-search scenario if existing coverage does not reproduce typing queries and row ownership. Performance claims require the same `agent:browser trace <scenario> --compare <baseline-directory>` path before/after; record source-map attribution and evidence directories. This plan changes no visual design.

## Acceptance and delivery

- [ ] G0 matrix and selected tool/version are recorded with execution evidence; all required update cases pass.
- [ ] Four units preserve domain results and remove the intended preparation/emitter bookkeeping. Claims about speed or bytes have before/after measurements.
- [ ] G5 has a recorded feasibility result; conditional migration passes its CSS/type/asset proofs or the generator is explicitly retained.
- [ ] Production outputs and published Editor declarations have no build-only dependency or transform requirement.
- [ ] Narrow tests, affected typechecks, required gates and browser evidence pass. Update this checklist and root roadmap as units land.
- [ ] Commit only owned paths, push, and deploy the affected runtime through the mesh. Use web deployment for web-only changes; shared/server runtime changes require dev proof then server deployment/restart. Documentation-only publication does not require a runtime release.

Pause the affected unit if invalidation is unreliable, output cannot preserve its type/domain contract, external input acquisition enters normal builds, or the integration requires a package-wide export rewrite. Record the failing case and continue independent research; do not silently substitute runtime evaluation or drop the candidate for missing measurements. Keep earlier accepted values and ordinary helper baselines until each comparison is complete, then delete obsolete internal APIs and emitters in the same unit.
