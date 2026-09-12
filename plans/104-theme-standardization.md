# Theme standardization

Status: proposed, implementation not started. Requested 2026-09-12.

Picking a theme should finish the job. One click selects coordinated app colors, code highlighting, terminal colors, and a wallpaper collection. A user who wants more control can change any of those parts, save the result, and return to the original defaults.

Today, **Light / dark mode**, **App colors**, and two **Code theme** settings divide that job between four choices. Wallpaper is a separate enabled toggle over inherited desktop media. This plan replaces that product model with complete themes and progressive customization.

The recommendations below are proposed product decisions. This document plans the work; it does not record implementation or visual approval. [Root PLAN.md](../PLAN.md) owns scheduling. [The research reference](../docs/theme-standardization-reference.md) contains pinned upstream sources and the current-code trace.

## Platform keeps its own visual language

User clarification: borrow Omarchy's complete-theme experience while preserving Platform's own appearance. Importing a theme must still produce a recognizable Platform interface.

The proposed description of that identity is a calm, compact workspace: consistent controls, readable typography, subtle surface separation, restrained accents, and wallpaper behind the work. Theme color choices sit inside that design language.

| Platform owns                                                      | A theme supplies                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| Component shapes, corners, spacing, bar heights, and layout        | Background, foreground, accent, and semantic colors  |
| Typography hierarchy, icon style, and interaction motion           | Code highlighting and terminal colors                |
| Surface layering, border treatment, focus treatment, and elevation | Coordinated light/dark variants                      |
| Where wallpaper appears and how controls remain readable over it   | Wallpaper images and focal points                    |
| Material formulas, bounds, and opaque floating UI                  | Material values supported by those existing controls |

The Omarchy importer translates color roles into Platform's design tokens. It does not import desktop stylesheets, window borders, bars, fonts, icon sets, layout, or animation. Platform decides where an accent belongs and how prominent a region is. An upstream accent can color selected controls without turning every panel edge into an accent border.

Curated packs are art-directed in the real Platform workbench. A Tokyo Night adaptation retains its characteristic hues and matching code colors while using Platform's controls, surface hierarchy, and restrained accent placement. Wallpaper choice, crop, and material values are reviewed against the content in that workbench; upstream screenshots are source references, not the visual target.

Advanced customization retains the same ownership boundary. Users can change supported colors, code, terminal, wallpaper, and material values. Their explicit typography and density preferences remain available through Platform settings. A theme file cannot redefine components or expand the set of supported styling properties.

## The user chooses a theme, then customizes it

The main Appearance page has a theme gallery, **Appearance: System / Light / Dark**, and **Customize**. Each theme card previews an actual combination of app chrome, code, terminal output, and wallpaper. A card identifies its supported modes and whether it has saved changes. Clicking the card applies that theme in one action.

For example, a proposed **Tokyo Night** pack selects its matching app colors, bundled syntax registration, ANSI colors, and first wallpaper. The user can then choose another picture from its collection or adjust the accent. Those changes belong to Tokyo Night. Selecting Graphite uses Graphite's defaults or previously saved changes; returning to Tokyo Night restores the user's version.

“Palette” remains an authoring term. The main page does not ask users to choose an app palette separately from the theme. Advanced customization calls that section **App colors** and calls syntax selection **Code colors**.

| Decision             | Proposed behavior                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete defaults    | Every pack resolves app, editor, terminal, and background settings. A wallpaper-free pack explicitly resolves to a solid background.                                                                             |
| Light and dark       | First-party packs have reviewed light and dark variants under one name. Imported packs may have one mode. No automatic inversion creates a missing counterpart.                                                  |
| System mode          | Default preference is System. A paired pack follows the viewer's OS. A single-mode pack uses its sole variant and shows “This theme is dark only” or “light only.” Keep the preference for the next paired pack. |
| Unsupported mode     | Disable the unavailable mode control with an explanation. Applying a single-mode pack while another mode preference is saved uses the available variant and displays the limitation.                             |
| Saved changes        | Changes are per theme revision and per variant. They never carry into an unrelated theme. The gallery marks a changed theme **Customized**.                                                                      |
| Reset                | Each changed field and section can reset to its pack default. **Reset theme** clears both variants' changes. Re-selecting a customized card preserves it; **Use theme defaults** is an explicit action.          |
| User library         | **Save as new theme** creates an independent named pack. Import and export use the same portable format.                                                                                                         |
| Personal preferences | Font family, font size, line height, density, reduced motion, and desktop-window transparency stay independent. Selecting a theme does not alter those preferences or install fonts.                             |
| Theme material       | Wallpaper, pane opacity, content opacity, blur, and saturation belong to the theme's visual defaults and can be overridden. Existing bounds and opaque floating UI remain enforced.                              |
| Ownership            | Theme settings use application scope and the existing primary-server settings owner. They do not come from a cloned workspace or imply account synchronization.                                                  |

Preview is transient. Keyboard navigation in the gallery and command picker previews the whole theme. Escape restores the latest confirmed or projected appearance, including changes received from another window. Click or Enter applies the preview through the existing settings transaction and preserves its handoff until settlement.

Customize opens an explicit draft with **Apply** and **Cancel**. Its first controls are Background, Accent, Code colors, Wallpaper, and Material. **Advanced** exposes semantic app colors, editor colors and supported syntax rules, and all 16 terminal ANSI colors plus foreground, cursor, and selection. Changes target the selected light or dark variant. While editing, temporarily preview that variant and label it clearly. This preview does not persist a mode change; Apply and Cancel return to normal mode resolution using the saved preference.

Choosing a different syntax preset or using another theme's colors in customization copies that part into the current theme's override. It does not select a different global theme or create a chain of dependent themes. Advanced users can also edit and import validated theme JSON. Arbitrary CSS and executable theme plugins are outside this format.

## Wallpapers belong to the theme

The wallpaper section offers **Theme collection**, **My image**, **Desktop**, and **Solid color**. The normal theme card uses its collection's default. A thumbnail strip selects another image, and **Next wallpaper** cycles the selected collection. Remember the selection separately for each variant. Timed rotation and video collections can follow later; the first version needs good still-image collections and manual cycling.

Every image has a stable asset identity, dimensions, a thumbnail, and an optional focal point. The default fit is cover. Users can adjust focus and fit without changing pane geometry. An image added to a theme remains a user addition, so an upstream pack refresh cannot remove it.

Explicit theme and custom images render inside Platform on Linux as well as other platforms. Today [Wallpaper](../apps/web/src/features/workbench/components/wallpaper.tsx) returns nothing for a compositor backdrop. Replace that assumption for explicit sources. **Desktop** alone follows the existing [backdrop policy](../apps/web/src/lib/platform/backdrop.ts) and [host wallpaper adapter](../apps/server/src/wallpaper/service.ts). Keep the shell's authority over whether the window itself is transparent.

For Desktop, preserve the current primary-host and same-environment checks. Do not fetch a remote workspace's wallpaper as if it belonged to the viewer. If desktop media is unavailable, use the resolved solid background and explain that source's availability in customization.

Preload the selected still and display its thumbnail or the theme's solid background until decoding completes. A missing image does not block applying the colors. Failed media gets a retry action in customization. Do not show an image from the previously selected theme. Keep all media out of dialogs, menus, popovers, tooltips, and editor completion or hover panels.

Retain reduced-motion and hidden-window handling for the existing Desktop video path. No pack can override an accessibility preference or leave hidden video decoding after its source changes.

## Reuse Omarchy through a pinned importer

Omarchy supplies the complete-theme and background-collection model. T3 Code supplies the guided color editor and deeper semantic-role controls. CodexThemes-App supplies artwork previews, focal placement, and a local library. Their actual formats and limitations are recorded in the [source comparison](../docs/theme-standardization-reference.md).

Build a small Omarchy importer that accepts a repository URL, an optional theme subdirectory, and a revision. Resolve the revision to a commit and import only supported data. Built-in Omarchy themes live below `themes/`; community repositories can place a theme at their root.

The importer reads `colors.toml`, maps its roles to Platform's semantic tokens and ANSI colors, and records every fallback it supplied. App colors use Platform's surface and contrast relationships; code and ANSI colors can retain the source palette more directly. Imported packs start with Platform's material defaults, never upstream compositor settings. Prefer a reviewed existing syntax registration when the matching theme is already bundled. Omarchy's `vscode.json` can identify an extension rather than contain theme data; never treat that identifier as a usable syntax payload.

The command produces a reviewable pack, mapping report, and source manifest. Normal rendering uses local pack data and assets without GitHub requests. Re-running the importer for the same source commit produces the same pack content. Updates create a new immutable revision; they do not change the selected revision or silently rebase user changes.

The first importer is a developer tool for curating built-ins. It also gives the user a concrete route to reuse an Omarchy repository. A public repository-install UI can later wrap the same conversion after download and validation behavior is proven. Native Platform pack import remains part of this plan.

Retain applicable code and data notices. Omarchy's root is MIT, but this research did not establish individual wallpaper provenance. CodexThemes-App also identifies an artwork exception. Track image source, creator, license or permission, and redistribution status separately from code. A built-in ships only cleared assets. Unverified artwork can be replaced while retaining the theme's vetted color data. This is a content-selection dependency, not a reason to block the resolver or gallery.

Launch with a deliberately small collection. Proposed candidates are Graphite, Sage, Catppuccin, Gruvbox, Tokyo Night, and Rosé Pine. Final inclusion depends on both-mode color review, available syntax registrations, and cleared artwork. Preserve Graphite and Sage as complete first-party packs. Include at least two additional curated packs with wallpaper sets of at least two cleared images each. Treat an adapted opposite mode as Platform-authored and credit it accordingly. Do not label it an official upstream variant unless it is one.

## One resolved appearance owns every output

Choose immutable packs plus saved overrides as the base design. It makes returning to a theme and resetting a single field predictable. Materialize complete values for rendering, the confirmed boot cache, and export.

Two independent design sketches were compared. A complete saved profile makes export and startup straightforward, but whole-profile writes need conflict handling and field resets need a retained source baseline. Adding preset buttons above today's four keys preserves the conflicting owners. The chosen design uses the first sketch's explicit defaults and field operations, with the complete-profile sketch's self-contained boot and export outputs. It accepts a resolver and override records in exchange for precise reset and independent concurrent edits.

Callers use domain actions. They do not coordinate setting writes or renderers:

```ts
const appearance = useAppearance()
appearance.selectTheme(themeRef)
appearance.setMode('system')

const preview = appearance.beginPreview()
preview.selectTheme(themeRef)
preview.setColor({ mode: 'dark', token: 'primary', color })
const submission = preview.apply()
if (submission.kind === 'submitted') await submission.settled

const resolved = useResolvedAppearance()
terminal.setTheme(resolved.terminal)
```

This is an interface sketch, not a new implementation. `selectTheme` and preview application return the existing `SettingsSubmission` contract. Cancellation uses the preview session's ownership token so an old picker cannot clear a newer draft.

Derive domain types from validated contract schemas. The essential shape is:

```ts
type Mode = 'light' | 'dark'
type ModePreference = Mode | 'system'

type ThemeVariants =
  | { readonly kind: 'paired'; readonly light: ThemeVariant; readonly dark: ThemeVariant }
  | { readonly kind: 'single'; readonly mode: Mode; readonly variant: ThemeVariant }

type ThemePack = Readonly<{
  schemaVersion: 1
  id: ThemeId
  revision: ContentHash
  name: string
  variants: ThemeVariants
  assets: readonly ThemeAsset[]
  provenance: ThemeProvenance
}>

type ThemeVariant = Readonly<{
  colors: SemanticColors
  editor: EditorAppearance
  terminal: TerminalAppearance
  wallpapers: WallpaperCollection
  material: PaneMaterial
}>

type WallpaperSource =
  | { readonly kind: 'collection'; readonly selected: AssetId }
  | { readonly kind: 'image'; readonly asset: AssetId }
  | { readonly kind: 'desktop' }
  | { readonly kind: 'solid' }

declare function resolveAppearance(input: AppearanceInput): ResolvedAppearance
```

`ThemeId`, `AssetId`, and `ContentHash` are validated identities. `SemanticColors` is the supported color-token schema, not an arbitrary CSS map. `EditorAppearance` distinguishes native capture definitions from VS Code registration data. `WallpaperCollection` represents either an empty solid background or a nonempty collection with a valid default. Asset membership is validated on import. The sketch's supporting types are implementation work, not existing exports.

Register the following keys with actual consumers in the same cutover:

| Key                              | Value and behavior                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `workbench.theme`                | Selected immutable `{ id, revision }`. Defaults to bundled Graphite.                                                 |
| `workbench.appearance`           | System, light, or dark preference. Defaults to System.                                                               |
| `workbench.theme.customizations` | Validated records keyed by theme reference and mode, containing only changed fields and user-added asset references. |
| `tui.theme.colors`               | Theme or terminal-host colors. Defaults to Theme; only the TUI consumes the host-color choice.                       |

All four are application-scoped. Web theme writes target the primary server's user document; the TUI uses its existing settings owner. A structured customizations widget registers its fields and limits through that descriptor's schema and settings metadata. Do not introduce a second `localStorage` settings source. Ordinary React settings readers continue through `useSettingValue`; non-React settings reads use `readSettingsMirror()`.

Add semantic operations for field set/remove, wallpaper collection edits, and section/theme reset. Each operation names its theme revision, mode, and field. Apply them to the latest server document and use field-level semantic resource identities in projection and supersession. Two windows editing different colors must retain both edits. Same-field writes follow the existing ordered intent behavior. A reset conflicts with the fields it removes, not with unrelated themes. Never replace the entire customization map from a stale client snapshot.

The pure resolver applies these rules in one place:

1. Apply the active preview's operations to the latest projected appearance inputs, including the selected reference and temporary preview mode.
2. Resolve that selected immutable pack or a complete bundled fallback.
3. Choose its variant from the requested mode, viewer system mode, and supported variants.
4. Apply the resulting overrides for that exact pack revision and variant.
5. Produce complete semantic colors, editor appearance, typed terminal colors, wallpaper selection, and material values with a content identity.

Theme selection does not write out every default as an override. A “Customized” marker is derived from effective differences; setting a field back to its default removes its override. Saving a new theme materializes both available variants and breaks runtime inheritance. Export also materializes all required values and packages its retained assets and notices, so the recipient needs no original repository checkout.

## Preserve settings, boot, and asynchronous rendering contracts

Reuse [settings intents](../packages/client-core/src/settings/intent-store.ts), [mutation contracts](../packages/contracts/src/settings/mutations.ts), and the [write coordinator](../apps/server/src/settings/write-coordinator.ts). Expose theme actions through the existing `useSettingsActions` submission path. One Apply is one user-targeted request with its operations and mutation ID. Do not call public `setSetting` repeatedly or add a persistence coordinator in React effects.

Keep requested, prepared, applied, and confirmed identities distinct. Prepare required syntax registrations before publishing a new complete appearance. One preview owner publishes the generation consumed by app, editor, chat code, terminal, file tree, and wallpaper. Slow wallpaper decoding can finish later against that same generation.

Preserve editor registration hashes, late-load rejection, native-versus-Shiki behavior, and the existing exact applied-theme guard for cached paint. A syntax choice must carry its engine distinction explicitly. First-party packs use the corresponding bundled Shiki registration where available. This plan does not rewrite Editor's tokenizer architecture or change the global syntax-highlighting preference.

Renderer application is asynchronous. Do not claim that one settings write makes all GPU and worker output change in one frame. Require each renderer to reject obsolete generations, retain a coherent pending presentation, and report the generation actually applied. A theme is fully applied only after the required visible renderers acknowledge it. If the existing package interfaces cannot preserve that behavior, document the exact Editor or terminal dependency in root `PLAN.md` before extending the package.

Update terminal subscriptions to use the resolved content identity. Today [the terminal panel](../apps/web/src/features/terminal/components/panel.tsx) updates on dark/light mode, which misses dark-theme-to-dark-theme changes. Feed normalized typed colors to the terminal adapter. Keep editor surfaces, terminal backgrounds, chat code blocks, diff colors, selection, caret, and file-tree tokens under deliberate ownership; later CSS rules must not silently replace a pack's explicit choices.

Extend the existing confirmed boot mirror with a bounded, validated resolved projection for each supported mode, its pack identity, and the confirmed material settings. Generate or share its token mapping with the runtime adapter. Update the early [HTML boot script](../apps/web/index.html), module-scope application, and provider together. The boot cache contains no image bytes, scripts, or optimistic state. It remains disposable paint data, never settings authority or editor document truth.

On reload, resolve the cached variant from the saved mode preference, current OS mode, and supported variants before first paint. Carry the requested preference in the cache and share the runtime's resolution rule. If the cache or pack is unavailable, paint the complete bundled fallback and retain the requested selection so the user can retry or reinstall. A missing wallpaper falls back within its theme. A failed theme preparation keeps the previous complete applied appearance and a recoverable draft. Settings rejection uses the existing rollback and error path; a failed preview never survives reload.

Normal appearance UI and commands stay with the primary server while a remote workbench is active. Imported assets are served by that same owner. Raw settings JSON currently follows the active editor server; appearance JSON actions must target the primary owner explicitly and name that owner where ambiguity exists.

## Keep the implementation in existing owners

| Owner                                | Work                                                                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/`            | Add the theme schema and derived types; extend settings keys, mutations, validation, projection resource identities, and generated schema/reference.                                                                                                      |
| `packages/client-core/src/themes/`   | Extend the existing theme-registration area with immutable catalog data, pure resolution, normalization, and renderer-neutral color values. No new package is needed.                                                                                     |
| `apps/web/src/lib/appearance/`       | Shared provider, state, hooks, and DOM adapter. Settings, editor, terminal, chat, workbench, and commands consume it, satisfying the shared-layer rule. Keep React wiring out of `utils/`.                                                                |
| `apps/web/src/features/settings/`    | Gallery and customization UI, with one component or hook per file and narrow appearance actions. Generic settings transport remains here. The shared appearance layer receives its settings connection at composition; it must not import from a feature. |
| `packages/ui/src/styles/globals.css` | Preserve color-token names, material formulas, and design-language geometry. Replace duplicated Graphite/Sage authored color blocks with generated defaults or resolver output. Keep semantic status/diff roles and solid floating fills.                 |
| `apps/server/src/themes/`            | New pack library, validated import/export, content-addressed assets, and routes. Reuse the established settings and primary-host boundaries.                                                                                                              |
| `apps/server/src/wallpaper/`         | Retain host wallpaper discovery for the Desktop source. Pack assets have separate identities and storage.                                                                                                                                                 |
| `scripts/themes/`                    | Omarchy conversion and catalog validation. No theme install or hook execution.                                                                                                                                                                            |
| `apps/tui/src/theme/`                | Consume shared resolved colors and selected code colors, with capability adaptation. Delete Graphite/Sage CSS scraping and update existing generation checks.                                                                                             |

TUI follows the same mode meaning. **System** chooses brightness; it no longer implicitly replaces a chosen pack's colors with OSC terminal colors. Preserve host-color inheritance as an explicit **Terminal colors** choice in the TUI, registered with its consumer in this pass. Preserve `NO_COLOR`, reduced motion, and 16/256-color degradation. Wallpaper and glass are unsupported TUI capabilities, not invalid pack data. Its JSON syntax consumer currently hardcodes dark-plus/light-plus and must adopt the selected syntax or an explicitly reported native-theme fallback.

The web app and Electrobun shell are the primary product scope. TUI changes are required where shared settings and color contracts change. Native Swift theme UI, OS theme synchronization, a marketplace, timed wallpaper rotation, video pack imports, automatic image-to-theme generation, and arbitrary CSS are outside this plan.

## Import, storage, and publication use immutable data

A Platform archive contains `theme.json`, referenced syntax data, image assets, thumbnails, and notices. A JSON-only import may reference bundled assets and registrations. It must not claim portability for absent custom assets. Support a VS Code color-theme JSON import as a customization starting point; show which UI and syntax roles were mapped or defaulted.

Parse external content at the boundary. Reject unsupported schema versions, executable fields, archive traversal, symlinks, remote executable references, invalid colors, and missing required assets. Define and enforce compressed size, expanded size, file count, image dimension, and decode limits before exposing archive import. Use structured errors through the feature's `evlog` catalog.

Stage and validate a complete pack before publishing its content hash. Installing the same pack twice is idempotent. Selecting it happens afterward through settings, so failed import cannot leave an active reference to a partial pack. Retain assets referenced by installed revisions, saved customizations, and in-flight operations.

Removal is a server-owned operation. Mark the revision as retiring and reject new selections and customization writes to it. If active, submit the bundled Graphite selection through the existing settings pipeline and await confirmed settlement. A rejected write prevents deletion. Recheck references before removing an unreferenced revision; keep referenced assets and restore a usable installed state if retirement fails. Serialize publication, selection validation, and retirement at that owner so a concurrent selection cannot race deletion. In-flight export retains its source until completion. A preview uses already-loaded immutable data; applying a retired revision fails visibly and preserves its draft. Saved customizations keep their referenced source available until the user saves an independent copy or removes those customizations. Pack updates leave the previous revision available; users can save their customized version before selecting the update.

Store installed packs and assets beside the primary server's application data using its existing path conventions. Built-in web artwork lives in a dedicated public theme-assets directory. During implementation and curation, use `/work` for downloads and generated artifacts and verify the mount and free space before large transfers. Theme manifests carry portable asset IDs, never machine-specific paths.

## Implement in verifiable units

Reconcile source drift first. This plan was written at `a01bf78f63cb94b4985a925d2c8d9de66294230f` with existing uncommitted UI/style work. Capture HEAD, status, and the dirty diff before editing. The source map in the research reference is the starting inventory; repeat searches for all removed keys and preview APIs before each cutover.

1. **Define and prove the data model.** Add schemas, immutable references, color roles, resolver, override operations, and paired/single-mode fixtures. Use current Graphite and Sage values as inputs. Prove mode resolution, reset, and concurrent field edits with pure and real-server focused tests. Do not register inert settings.
2. **Cut over all existing consumers.** Wire new settings, primary-owner actions, preview state, boot projection, CSS output, editor/chat/terminal/tree readers, commands, and TUI together. Replace the old selectors with an initial complete-theme control. Remove old keys, singleton selection authority, CSS palette scraping, and obsolete tests in the same unit. Verify settled colors and first paint before adding import UI.
3. **Deliver the library, wallpapers, and curated packs.** Build the minimal immutable pack library, staged asset validation/publication, and reference retention before custom-image upload. Add collection selection, focal placement, source-aware Linux rendering, and progressive still loading. Build the pinned Omarchy converter and source manifests. Curate the initial collection with actual matching syntax and cleared artwork. Verify the result on the existing running app.
4. **Finish the gallery and customization.** Add complete previews, guided colors, advanced roles, code and terminal overrides, section resets, draft cancellation, and Save as new theme. Keep user typography and accessibility preferences stable. Verify real keyboard, focus, and preview handoff behavior.
5. **Deliver portable import and export.** Reuse staged publication and reference retention for native archives, VS Code JSON import, export, revision selection, and deletion. Prove a customized pack round-trips into an empty library and renders without its original source repository.
6. **Verify and remove remaining drift.** Run the focused gates below, regenerate settings schema/reference and any catalog outputs, inspect the real app, and update stable documentation. Remove this plan only when its implementation and completion checks pass.

Plan 100's settled tokens and primitives are prerequisites already implemented. Coordinate edits to `globals.css` and shared controls with current UI work and Plans 101–103. Plan 085 overlaps the boot mirror and first-paint path; whichever lands second must reuse the first's boot ownership. This plan does not reschedule the editor contribution, Ghostty, or environment lanes.

Greenfield rules apply. Delete replaced setting IDs and update every caller. Do not add compatibility aliases or convert old persisted combinations into new themes. Document the obsolete keys/cache to remove on development machines; do not delete unrelated settings or perform that cleanup during planning.

## Completion means the whole appearance works

Use focused tests only where they catch a named plausible failure. Adapt existing appearance, editor-theme, terminal-appearance, wallpaper, settings concurrency, and TUI tests. Use the real in-process server for settings and imports. Reuse the running dev server for manual verification; do not start another.

| Gate                    | Evidence required                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One selection           | A fresh user clicks one theme and sees coordinated chrome, code, terminal, and wallpaper. No additional palette or syntax selection is required.                                                                                                                                                                                    |
| Mode behavior           | Paired pack follows an OS change. Single-mode pack states its limitation. Switching back to a paired pack restores the preserved preference and each variant's customization.                                                                                                                                                       |
| Full preview            | Preview A, then B, then Escape with deliberately reordered async loads. Every renderer returns to the latest projected selection; no preview reaches disk or the boot mirror.                                                                                                                                                       |
| Commit handoff          | Apply while hovered, then simulate a rejected settings write and a newer confirmed write. No cleared-preview gap, wrong rollback, or stale draft overwrites the new result.                                                                                                                                                         |
| Same-mode change        | Switch between two dark packs in an already-open terminal and editor. Foreground, ANSI table, cursor, selection, code, and chrome all change without remounting documents or terminal sessions.                                                                                                                                     |
| Custom syntax identity  | Change a custom registration's content while keeping its display name. Editor and chat repaint using the new content hash; cached old paint is rejected. Exercise native and Shiki choices.                                                                                                                                         |
| Concurrent settings     | Two real clients change different override fields, repeat a mutation, reset a section, and select another theme. Independent changes survive and retries are idempotent.                                                                                                                                                            |
| Primary-owner isolation | Change themes with a remote workbench active. Only the primary settings owner and library change. The remote workspace remains unrelated to theme persistence.                                                                                                                                                                      |
| First paint             | Reload an imported customized theme with System, explicit Dark while the OS is Light, and a single-mode pack. Inspect the boot floor and settled values. Change the OS preference, then corrupt or remove the cache and verify a complete bundled fallback.                                                                         |
| Wallpaper               | Check explicit images on Linux browser/compositor and supported shell modes, no image, missing image, collection cycling, invalid upload, and source replacement. Desktop retains environment checks and reduced-motion behavior.                                                                                                   |
| Portability             | Export both variants with overrides and images, import into an empty library, and compare resolved content. No source repository, mutable URL, or absolute path is needed.                                                                                                                                                          |
| Accessibility           | Gallery and customization work with keyboard and visible focus. Built-in text/background pairs meet 4.5:1 and necessary non-text indicators meet 3:1. Check actual composited backgrounds at shipped opacity settings and supplied wallpapers.                                                                                      |
| Design language         | Floating UI remains opaque. Status/diff meaning, token classes, fixed corners, bar heights, density, and elevation survive theme changes. No component gains raw palette literals.                                                                                                                                                  |
| Product identity        | Compare the same workbench in Graphite and two imported color families. Layout, controls, typography hierarchy, iconography, focus treatment, and motion remain Platform's. Imported accent colors do not introduce new borders, decoration, or styling rules. Review artwork with actual code, chat, and terminal content visible. |
| TUI                     | Selected pack, mode, code colors, host-color option, `NO_COLOR`, and limited-color terminals work without old Graphite/Sage CSS selectors.                                                                                                                                                                                          |
| Inventory               | Searches find no live old setting IDs or independent selection/preview writers. All generated references agree with the registry.                                                                                                                                                                                                   |

The contrast targets follow [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Custom colors remain editable when contrast is low; show the failing pair and provide a visible reset to tested defaults. Do not claim arbitrary user images or opacity choices meet the built-in theme checks.

Use app Vitest under `bun --bun` for node/dom tests and plain Node orchestration for `vitest.browser.config.ts`. Runtime-neutral package tests use plain Vitest. Run affected workspace typechecks, settings generation checks, and the design census after implementation; compare failures against the captured baseline instead of running a bare repository-wide suite.

Enrich the existing settings write event with selected theme reference and override sections, without logging image bytes or local paths. Add one correlated appearance-application event per committed attempt with generation, requested/effective mode, required-renderer outcomes, fallback reason, and duration. This gives the browser checks evidence of what actually painted. Avoid per-hover and per-token log streams.
