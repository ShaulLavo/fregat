# HTML bootstrap

The app's initial document carries its current appearance before React mounts. Wallpaper links
start image transfers when the browser discovers the HTML. A small classic script selects the
viewing device's color mode and applies appearance; application modules reuse its parsed data.
[Plan 341](../plans/341-html-bootstrap.md) owns execution and delivery checks.

## Producers and consumers

`createAppearanceBootstrap()` in `apps/server/src/web/appearance-bootstrap.ts` reads one current
settings snapshot and resolves both theme variants through the shared theme resolver. It carries
only appearance values and the selected palettes. `paletteStylesheet()` produces the light/dark
CSS with the same code used for runtime palette changes and the generated Graphite fallback.

`renderHtmlBootstrap()` in `apps/server/src/web/html-bootstrap.ts` uses Bun `HTMLRewriter` to fill
four declared template elements: `fregat-html-bootstrap`, `platform-palette`,
`fregat-wallpaper-light`, and `fregat-wallpaper-dark`. JSON is escaped for script text, and link
attributes use the parser's serialization. Missing or repeated elements refuse the document.
Explicit mode gets one image link; system mode gets conditional links, deduplicated when both
variants use the same image. Disabled variants get no image link.

`readHtmlBootstrap()` in `apps/web/src/lib/html-bootstrap.ts` validates the payload once and
caches the result with its script element in `window.platformHtmlBootstrap`. This named handoff
is needed because the classic pre-paint script and the application entry are separate bundles.
Its appearance feeds `boot-appearance.ts`, `main.tsx`, startup setting reads, and
`AppearanceProvider`. The selected palette also supplies initial renderer colors while the
palette catalog loads.

The HTML value remains the initial snapshot. Confirmed API settings update a separate in-memory
appearance store and normal TanStack projections. Appearance values and palette CSS use no
localStorage hop. The existing settings mirror retains non-appearance preferences used by
non-React consumers. This partial appearance payload never impersonates a full settings query.

## Image readiness

A preload link declares a download, not a decoded image. The early script's
`prepareWallpaperImage()` adopts the selected transfer into an image and decodes it without
waiting before app startup. React checks actual decoded readiness and preserves the existing
fallback or thumbnail until its own image can paint. The preload, decoder, and displayed image
use the same URL and anonymous CORS mode; verification counts actual image transfers.

## Document admission and backdrop

App documents, including direct filenames and navigation fallbacks, require an admitted device
and a configured document origin before carrying private appearance. Personalized documents use
private, no-store caching. Unadmitted devices receive the generic pairing payload and reload an
authorized document after pairing. Hashed static assets keep immutable caching. License pages
and repository HTML retain their independent handling.

The server derives public HTTPS URLs from validated proxy origin metadata. It classifies the
viewing browser's platform rather than its own operating system. Native Zig/Swift hosts append
`FregatBackdrop/app`, `/compositor`, or `/transparent` to their user agent before navigation.
This hint describes rendering and grants no admission. Transparent hosts preload no wallpaper;
compositor hosts omit desktop images while preserving library-image behavior.

## Development and release tooling

The Vite document middleware transforms the app template, then asks the configured Bun API's
`/web/bootstrap` adapter to fill it with the same renderer. It preserves the request's admission
and public origin. Isolated browser runs attach a loopback-only API hint to document requests so
Vite uses their fixture server. JavaScript, CSS, and other asset requests remain ordinary Vite
requests. Vite's build hooks use its structured HTML tag API and preserve script ordering.

`stampWebRelease()` uses Bun `HTMLRewriter` for release metadata. All packaging and installation
callers await complete file writes before consuming those documents.
