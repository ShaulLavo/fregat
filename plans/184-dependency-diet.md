# Plan 184: Dependency diet

## Status and authorization

- Status: PROPOSED 2026-09-26, ready. Owner direction: permissive licences only and as few
  dependencies as possible. Source: the round-2 audit, [dependency licences](../docs/dependency-licences.md) §3.
- Amended 2026-09-26: web push stays. Decided 2026-09-26: owner — "Web push: KEEP. Rewrite Plan 184
  so web push is never dropped. If a permissive-only dependency set is wanted, isolate the MPL-2.0
  `web-push` code in its own small package, loaded only when push is used." Slice 4 changed to match.
- Effort: M overall, as S slices that each land on their own.

## Outcome

Fewer runtime dependencies with no product change, every shipped third-party notice present, and
release installs that carry every package the server loads at runtime.

## Slices

1. **Runtime packages bug (first).** The server loads `jszip` and `subset-font` at runtime outside the
   bundle, but they are missing from `RUNTIME_PACKAGES`. The mesh works only because its
   `node_modules` links the checkout; a release installed elsewhere (the Mac, Plan 151) should fail
   Nerd Font installs and font subsetting. Reproduce on an isolated release install, fix, test.
2. **`cheerio` out.** One call site scrapes nerdfonts.com and costs 22% of the 4.7 MB server bundle.
   Use the GitHub releases API.
3. **`jszip` out.** Download the `.tar.xz` and use system `tar`, or `fflate`.
4. **`web-push` isolated, never dropped.** Web push and the `web-push` package both stay. For the
   permissive-only goal, move the two call sites (`push/vapid.ts`, `push/delivery.ts`) and the
   package into a small package of their own, loaded by dynamic import only when push is used (a
   device registers, or a notice is sent with `chat.pushNotifications` on). The main server bundle
   then carries no MPL code; the push package ships unmodified with its notice (slice 8) and, if
   it stays outside the bundle, in `RUNTIME_PACKAGES` (slice 1). No WebCrypto rewrite.
5. **`sharp` → `Bun.Image`** (a 6001×4001 JPEG to WebP in 33 ms in the probe).
6. **Dead and thin ones:** the second TypeScript (`typescript@6.0.3`, 24 MB, only unimported code uses
   it), `react-animated-counter` (pulls lodash), `@foresightjs/react` (keep `js.foresight`),
   `@tanstack/pacer` in the server (one throttle), `nanoid`, `html-void-elements`, `culori` if the
   palette code can use the colour math it already has.
7. **Duplicates in the web bundle:** a `resolve.dedupe` list in `apps/web/vite.config.ts` for the
   markdown parser stack (~240 KB carried twice, Platform and Editor), `@tanstack/hotkeys` (three
   copies) and `evlog` (two). Measure with the bundle report before and after.
8. **Notices:** generate a third-party notices file at build time and serve it; add Pierre's Apache
   notice to `packages/tree`; ship the two bundled fonts' OFL text.

`cmdk` (pulls Radix beside Base UI), `minimatch` and the full Shiki grammar import are larger
decisions and stay with their own plans (the command palette, Plan 129, Plan 170).

## Verification

Per slice: the narrow tests of the touched feature, `bun run gates`, the bundle report for web
slices, and a release install for slice 1. Slice 4: `server/index.js` holds no `web-push` code,
a server with push off never loads the push package, and Send test still reaches a registered
device on the mesh (scenario or the owner's phone).
