# Plan 341: HTML bootstrap for first paint

## Status and ownership

- Status: Approved.
- Owner request: 2026-10-09. Document the mechanism before implementing it. Put wallpaper preloads in HTML and give the app current startup appearance without passing through localStorage.
- Delivery now: this execution plan, its index entry, and roadmap placement. Product implementation remains paused until the owner starts it.
- Scheduling: a bounded web/server startup change, independent of the large structural programs. Coordinate with Plan 337 on document admission and pairing, Plan 114 on native backdrop information, and Plan 320 on generated palette data.
- Supersedes the implementation approach in [draft PR #1144](https://github.com/ShaulLavo/fregat/pull/1144), which waits for the settings query before mounting wallpaper. That approach must not ship. Its reproduction is useful evidence; its product changes are excluded.

## Outcome

A fresh authorized browser receives the current appearance in its initial HTML. It starts downloading the chosen wallpaper as soon as the browser discovers a preload link. The pre-paint script and React use the same settings, so the first app frame does not show a default wallpaper that disappears when settings arrive.

Make this an explicit HTML bootstrap mechanism with a small contract and named functions. A reader of `index.html`, the server route, or the client entry should be able to find its producer, consumers, and tests immediately. Bun's built-in `HTMLRewriter` fills declared elements; callers do not assemble unrelated HTML snippets or replace strings opportunistically.

## Current code and reproduction

At the planning baseline, `apps/server/src/web/routes.ts` returns the built document unchanged using `Bun.file()`. Its routes are mounted before authentication in `apps/server/src/app.ts` so a device can load the pairing screen.

`apps/web/scripts/boot-appearance-plugin.ts` bundles `apps/web/src/boot-appearance.ts` into a classic inline script. Before paint, that script reads a saved settings mirror, chooses the light/dark variant, applies root attributes, starts fonts and desktop wallpaper, and restores cached palette CSS. `main.tsx` reads the mirror again. `AppearanceProvider` starts from it and later writes confirmed settings and palette CSS for another visit.

The browser cache can be absent or stale. The owner observed wallpaper appearing and disappearing on an iPhone load. A reproduction with no appearance mirror and held settings mounted wallpaper for 16 sampled frames and started `/wallpaper/still` and `/wallpaper/info` requests before an off setting arrived. Reproduce the same case from current main before implementation and retain its screenshots, request log, and frame samples. The historical fixture cleared appearance storage while retaining its test workspace; it does not prove every aspect of a completely new browser profile.

Palette data already has one CSS renderer, `paletteStylesheet()` in `packages/client-core/src/themes/palette.ts`. `packages/ui/src/styles/palette.generated.css` is the generated Graphite fallback. `globals.css` supplies surfaces, density, feel, motion, and Tailwind mappings. Reuse these contracts. The obsolete comment in `globals.css` claiming Sage overrides appear below can be corrected with the mechanism documentation; restructuring the stylesheet is separate work.

## Scope

- Add a versioned, allowlisted appearance payload to authorized app documents.
- Generate palette CSS for both effective modes using the existing renderer.
- Emit native wallpaper preload links with the correct URL, request mode, and light/dark condition.
- Give all startup consumers one parsed in-memory result.
- Give production, Vite development, and isolated browser verification the same bootstrap contract.
- Document the mechanism alongside its code and in the development/architecture docs.

Keep React rendering in the browser. This plan does not migrate to TanStack Start, render React on the server, inject a complete settings document, or create a general HTML plugin registry. Keep unrelated address, workspace, and other browser storage behavior under its existing ownership.

## Design

### Named functions and ownership

Use these names as the implementation contract. Filenames below are intended destinations, not claims that the files already exist.

| Owner                                         | Function or contract           | Responsibility                                                                                                                      |
| --------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/html-bootstrap.ts`    | `HtmlBootstrap` and its schema | Versioned data shape, allowed fields, and stable element IDs. Free of React and browser state.                                      |
| `apps/server/src/web/appearance-bootstrap.ts` | `createAppearanceBootstrap()`  | Resolve the admitted owner's settings and both theme variants into appearance and asset data. Use pure shared resolution functions. |
| `apps/server/src/web/html-bootstrap.ts`       | `renderHtmlBootstrap()`        | Transform a document response with `HTMLRewriter`, filling palette CSS, JSON, and preload elements.                                 |
| `apps/web/src/lib/html-bootstrap.ts`          | `readHtmlBootstrap()`          | Validate the embedded payload once and expose the same object to the early script and application modules.                          |
| Existing `boot-appearance.ts`                 | Pre-paint application          | Choose system mode, apply appearance, and adopt preloads already declared in HTML.                                                  |

Use a named function rather than a long-lived service for the document transformation. Extend the typed payload when a new pre-React requirement has a real consumer. Do not accept arbitrary executable code or an untyped bag of HTML fragments.

### Appearance payload

Include the configured color mode, the effective light and dark appearance variants, and the owner identity and settings server version that produced them. Carry the startup values already required by the app: palette identity, wallpaper selection and display URL, surface settings, density, feel, fonts, code-theme selection, and any other existing appearance boot value whose caller requires it before React.

Derive field types from the settings/theme schemas. Apply theme customizations and applicable setting layers through `resolveThemeSettings()`, including explicit light and dark resolution. Keep palette CSS in a dedicated style element rather than duplicate it in JSON. The browser selects `system` mode using `matchMedia`; server operating-system preferences do not decide the viewing device's mode.

This is a partial appearance contract. Do not put it into the full TanStack settings query as a fabricated `SettingsSnapshot`. The normal settings read, stream, and optimistic projection remain responsible for live settings. Bind the initial appearance to its owner, and ensure a primary document's data cannot silently become a remote environment's settings.

### Declared HTML elements

Add clearly named placeholders to the built app template before the existing boot script. Use a JSON script such as `script#fregat-html-bootstrap`, the existing `style#platform-palette`, and bounded wallpaper preload slots. Explain their producer in a short source comment linking this plan and the eventual architecture documentation.

`renderHtmlBootstrap()` targets those elements with `HTMLRewriter`. Use `setAttribute()` for link attributes, `setInnerContent()` for serialized data and generated CSS, and `remove()` for unused slots. Count required placeholders and fail with a structured error when a built app template violates the contract. Do not silently serve a partially filled document.

Serialize JSON with `<` escaped so values cannot terminate the JSON script. Fill styles only with CSS produced from validated palette data. Restrict preload URLs to the authorized owner's supported wallpaper endpoints; do not serialize local filesystem paths. Qualification includes hostile strings, duplicate or missing elements, and supported non-root base paths.

Preserve ordinary static asset serving. Transform the app document and its SPA navigation fallbacks, not every HTML file in the release. Treat the gallery explicitly; license pages remain independent documents.

### Wallpaper preloads and rendering

For an explicit color mode, emit the enabled variant's image preload without a media condition. For system mode, emit light and dark image preloads with `(prefers-color-scheme: light)` and `(prefers-color-scheme: dark)` conditions. Omit a disabled variant's preload. Avoid duplicate applicable links when both variants use the same image.

Set `as="image"`, the matching CORS/credentials mode, and the existing high image priority. Use the same display URL in the rendered image path. A later `<img>` still requests its source; verify that it consumes the preloaded response with one image transfer. A preload link does not replace the wallpaper setting.

Cover desktop stills, bundled library images, and uploaded images. Inspect `LibraryWallpaper` and its blob/query path before asserting reuse: an image preload and a separate fetch-to-blob pipeline are not automatically the same consumer. Preserve its decoded-image handoff when changing sources. Animated desktop wallpaper preloads the still; retain existing reduced-motion and optional video behavior.

Preserve native transparent and compositor backdrops. The server knows settings but cannot read a browser's injected native bridge. Unit 1 must establish which existing document-request context proves an app-drawn backdrop and how a native host supplies any missing context. Do not infer the viewing device from the server's OS or emit unwanted desktop-image downloads on a compositor-backed client. Record and resolve this contract before changing preload behavior.

Readiness remains a separate concern from downloading. Preserve the wallpaper's existing decoded-image/fallback policy; do not make an enabled wallpaper appear late by waiting for the settings query. Do not hold app startup on an off wallpaper, an image response, or a failed preload. Adopt static preload completion without relying on a load event that may have happened before the script attached its listener.

### One startup result

Parse and validate the HTML payload once. Use a single typed in-memory handoff, exposed through `readHtmlBootstrap()`, because the classic boot script and app module are separately bundled. If a window property is needed, give it a shared declaration and a name tied to this contract; do not let consumers invent globals or mutate the confirmed payload.

Migrate the inline script, `main.tsx`, startup setting reads, font/code-theme preparation, and `AppearanceProvider` to the same initial appearance. An old mirror or default must not overwrite the HTML values between first paint and settings confirmation. Preserve server updates and user changes after confirmation.

The normal authorized document path does not read or write localStorage to obtain its initial appearance. Remove the superseded appearance palette-cache path and migrate its callers together. Retain the shared settings mirror where non-appearance consumers still require it. Storage being unavailable, malformed, or carrying stale appearance must not alter this document's first appearance.

### Admission, caching, and development

The existing HTML route is public. Reuse device admission for private bootstrap production, including the already supported host and Tailscale paths. An unadmitted device receives the generic pairing document without private appearance, palette, or asset URLs. After admission, load an authorized document with its bootstrap. Keep the pairing entry functional and do not embed secrets, diagnostics, raw setting layers, or unrelated user settings.

Serve personalized documents with private, no-store caching. Preserve immutable caching for hashed assets. Reuse the synchronous cached settings snapshot; do not call the side-effecting `snapshotForClient()` solely to render HTML. Any derived cache must include all settings, palette, and asset identities/versions that affect its output. Invalidation and correctness come before caching.

Add a Vite adapter that produces the same elements and payload through the shared renderer and the configured server's admission context. Development must not use a different source order from production. Isolated browser runs must bind the document to their fixture server before navigation; update the verification runner rather than populate localStorage to imitate server bootstrap.

## Steps

1. [ ] Reproduce on a fresh browser profile and the historical appearance-cache case. Record baseline HTML timing, wallpaper request initiators, transfer count, decode/first-painted-frame timing, and frame samples. Resolve document admission, native backdrop context, and library-image preload adoption.
2. [ ] Add the shared schema/IDs, `createAppearanceBootstrap()`, and `renderHtmlBootstrap()`. Declare template elements. Test both mode resolutions, admission, escaping, element invariants, base paths, and conditional preloads against real transformed responses.
3. [ ] Add `readHtmlBootstrap()` and migrate all appearance startup consumers together. Remove superseded appearance storage/preload logic while preserving live queries, decoded-image transitions, and non-appearance storage consumers.
4. [ ] Wire the Vite and isolated-server adapters. Replace storage-seeded wallpaper bootstrap scenarios with real document production. Add stable selectors to the verification selector module.
5. [ ] Qualify built production HTML in Chromium and WebKit at phone and desktop sizes. Compare matched cold-load traces and image transfers. Add a concise architecture explanation and correct obsolete palette comments.
6. [ ] Deliver the implementation through normal review, CI, and authorized installation. Server and web changes ship together. Confirm the served release and perform the read-only live check.

## Verification and acceptance

Use fresh isolated servers and browser contexts. Block storage access in one case and seed obsolete appearance in another. Hold the later settings response long enough to observe the first app screen. Disable browser cache for transfer measurements, keep network/CPU conditions matched, and include known-good painted wallpaper controls so a broken observer cannot report zero flicker.

| Case                                            | Required result                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh authorized browser, wallpaper off         | No wallpaper preload, display image, wallpaper-info, or video request; no frame briefly displays a wallpaper.                                                                          |
| Wallpaper on, later settings response held      | Correct selection and palette before React; native preload starts from document discovery, and first wallpaper display follows existing readiness policy without a default-image swap. |
| Same image preloaded then rendered              | One image transfer with compatible request settings; the rendered consumer adopts the response.                                                                                        |
| Explicit light/dark and system mode             | Correct mode's assets and CSS; disabled variants download nothing. Both effective theme variants respect customizations and layers.                                                    |
| Custom palette and uploaded/library image       | Correct initial CSS and display URL; no palette-catalog or settings fetch is required to discover the chosen colors or image.                                                          |
| Storage blocked, invalid, or stale              | Appearance still comes from authorized HTML, with no storage dependency or intervening stale/default paint.                                                                            |
| Slow/failed image or video                      | Startup remains bounded, existing still/fallback and reduced-motion behavior hold, and no settings-query gate delays wallpaper selection.                                              |
| Native transparent/compositor client            | Existing backdrop behavior and no unwanted app wallpaper downloads.                                                                                                                    |
| Unadmitted document and newly admitted document | Pairing page stays reachable; private bootstrap is absent until admission and correct afterward.                                                                                       |
| Primary/remote environment and SPA fallback     | Bootstrap authority is explicit; navigation does not apply the wrong owner's appearance.                                                                                               |
| Production, Vite, and isolated fixture server   | Same schema, element ordering, appearance source, and preload policy.                                                                                                                  |

Run `bun run plans:check` for plan edits. Implementation runs the narrow server transformation, palette, startup-setting, wallpaper, and admission checks first; complete the repository gates and required checks afterward. Use `bun run agent:browser look --doctor`, the implemented startup scenarios, and `trace --compare` on the same built-product scenario. Use `caches` to verify settings confirmation and mutations still settle their real cache. Read screenshots back and name the reported evidence directories.

Do not claim saved milliseconds from source inspection. Compare time to initial HTML, wallpaper request start, image decode, and first painted wallpaper, plus transferred bytes and counts. Preparing bootstrap must not await remote image/font downloads or provider discovery. Explain server-generation cost and any measured regression before acceptance.

## Delivery boundaries

This documentation change does not enable or deploy the mechanism. The rejected wallpaper-delay PR stays draft and unmerged. The later implementation must update the server and web release together because the web client depends on a new document contract. Public contract-package behavior changes require the usual patch changeset; this plan-only change does not.
