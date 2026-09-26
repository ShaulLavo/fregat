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
   Landed 2026-09-26 (wave 2 lane B): both are in `RUNTIME_PACKAGES`, and the release-files test
   also collects `require('…')` calls in files that use `createRequire`, which the bundler leaves
   for run time. Isolated release install (the font modules bundled, the runtime manifest written
   from `bun.lock`, `bun install --production --frozen-lockfile`, `node_modules` linked beside the
   bundle, run from `/`): before, `Cannot find package 'subset-font'`; after, both load.
2. **`cheerio` out.** One call site scrapes nerdfonts.com and costs 22% of the 4.7 MB server bundle.
   Use the GitHub releases API.
   Implemented with slice 3 on `w2/cx-184-fonts`: validate the release asset JSON and keep
   the existing ZIP URLs and cached font files. Only HTTPS assets under the Nerd Fonts
   release path are accepted.
3. **`jszip` out.** Download the `.tar.xz` and use system `tar`, or `fflate`.
   Implemented with `fflate` 0.8.3, MIT notice in `apps/web/public/licenses/fflate.txt`.
   Only the selected face is inflated. JSZip leaves the release runtime manifest.
   Same-command server builds: 5,139,731 → 4,080,290 bytes, down 1,059,441 bytes or 20.6%.
   Lock resolutions: 1,346 → 1,326. Font and release tests: 41 passed. A frozen production
   runtime install and bundled Nerd Font extraction passed from `/`. All workspace typechecks
   passed. Evidence: `/work/tmp/w2-184-fonts-evidence/`.
4. **`web-push` isolated, never dropped.** Web push and the `web-push` package both stay. For the
   permissive-only goal, move the two call sites (`push/vapid.ts`, `push/delivery.ts`) and the
   package into a small package of their own, loaded by dynamic import only when push is used (a
   device registers, or a notice is sent with `chat.pushNotifications` on). The main server bundle
   then carries no MPL code; the push package ships unmodified with its notice (slice 8) and, if
   it stays outside the bundle, in `RUNTIME_PACKAGES` (slice 1). No WebCrypto rewrite.
   Implemented on `w2/cx-184-runtime`: `@workspace/push` owns the external dependency;
   both server call sites dynamically import it. The generated bundle awaits the external
   import only at first use. `web-push` is in the frozen runtime manifest, and its full
   MPL text and source link ship at `/licenses/web-push.txt`.
   Server bundle: 5,139,799 → 4,930,017 bytes, down 209,782 bytes. Push/release tests:
   29 passed, including independent payload decryption and VAPID verification. An isolated
   frozen runtime install generated keys from `/`, with no eager transport load.
   Device delivery on the mesh remains unverified: this lane does not deploy or send to the
   owner's phone. Evidence: `/work/tmp/w2-184-runtime-evidence/`.
5. **`sharp` → `Bun.Image`** (a 6001×4001 JPEG to WebP in 33 ms in the probe).
   Implemented on `w2/cx-184-images`. Bun.Image decodes and derives images inside an isolated
   process with a ten-second kill deadline. PNG and WebP animation, pixel and dimension limits,
   complete source decoding and EXIF orientation are preserved. A second Sharp consumer now
   exists: wallpaper color sampling. MIT `pngjs` reads its small generated PNG sample because
   Bun.Image has no raw-pixel terminal. No native module is needed in the runtime install.
   The worker is built beside the server and required by release-file validation.
   Isolated Linux runtime dependency bytes, following links and counting unique files per tree:
   588,395,127 → 546,336,319, down 42,058,808. The site build still has its own dev-only Sharp.
   Passed decoder, color, release-file and wallpaper-library tests, including corrupt files,
   animated PNG/WebP and EXIF orientation. Isolated bundled decoding passed from `/`.
   Evidence: `/work/tmp/w2-184-images-evidence/`.
6. **Dead and thin ones:** the second TypeScript (`typescript@6.0.3`, 24 MB, only unimported code uses
   it), `react-animated-counter` (pulls lodash), `@foresightjs/react` (keep `js.foresight`),
   `@tanstack/pacer` in the server (one throttle), `nanoid`, `html-void-elements`, `culori` if the
   palette code can use the colour math it already has.
   Implemented on `w2/cx-184-thin`: removed 2,800+ lines of unused in-process TypeScript LSP
   code and its implementation tests. Kept TypeScript 6 as a devDependency because the live
   legacy-server integration suite still uses it. Removed the server pacer dependency, NanoID,
   the React Foresight wrapper, animated-counter and the markdown void-elements dependency.
   Workspace IDs retain their 16-character alphabet and 96 bits of randomness. The shared
   ticker now honors decimals, including its accessible label. Culori stays: local conversion
   math does not replace its CSS syntax parser.
   Server bundle: 5,139,799 → 5,101,077 bytes. Web first-load JS gzip: 1,761,157 → 1,758,507;
   all JS chunks: 62,029,559 → 62,022,715 bytes. Passed 15 git/metadata tests, 12 real TS 7/6
   integration cases, 57 markdown tests, hook lifecycle and ticker precision tests, workspace
   typechecks and gates. The built physical gallery screenshot was read back; its static
   preview has one expected unavailable Nerd Fonts endpoint. Evidence:
   `/work/tmp/w2-184-thin-evidence/` and
   `/work/tmp/fregat-evidence/20260926T190920Z-look-fregat-1440x1000/`.
7. **Duplicates in the web bundle:** a `resolve.dedupe` list in `apps/web/vite.config.ts` for the
   markdown parser stack (~240 KB carried twice, Platform and Editor), `@tanstack/hotkeys` (three
   copies) and `evlog` (two). Measure with the bundle report before and after.
   Implemented on `w2/cx-184-dedupe`. Bun's isolated install needs the markdown entry packages
   resolved from `packages/markdown`; a dedupe list alone left those copies in the build.
   The final module report has one physical copy of each parser package, hotkeys and evlog.
   All emitted JS: 62,029,559 → 61,910,043 bytes, down 119,516. All JS gzip:
   9,133,410 → 9,100,496 bytes. First-load JS gzip is essentially unchanged:
   1,761,157 → 1,761,013. Shared package notices ship at `/licenses/markdown-runtime.txt`.
   Evidence: `/work/tmp/w2-184-dedupe-evidence/`.
8. **Notices:** generate a third-party notices file at build time and serve it; add Pierre's Apache
   notice to `packages/tree`; ship the two bundled fonts' OFL text.
   Implemented on `w2/cx-184-notices`. Web notices come from the emitted module graph and font
   packages; server notices come from bundle module paths and installed runtime dependency
   closure. The index at `/licenses/` links both generated texts, including `/licenses/server.txt`.
   Release-file validation requires the server notice. Pierre's Apache text and 46 mapped-file
   modification headers are present; fonts, linked Editor grammar notices, icons, t3code ports,
   the shadcn stylesheet and Ghostty notices are shipped too.
   Generated notice files: absent → 411,488 web bytes for 260 package/version entries and
   448,297 server bytes for 192 entries on this Linux install. This adds attribution bytes,
   with no new runtime dependency. Generator and route/release tests, gates, workspace
   typechecks and both production builds passed. The built index's `look` screenshot was
   read back with no browser problems. Evidence: `/work/tmp/w2-184-notices-evidence/` and
   `/work/tmp/fregat-evidence/20260926T193035Z-look-fregat-1440x1000/`.

`cmdk` (pulls Radix beside Base UI), `minimatch` and the full Shiki grammar import are larger
decisions and stay with their own plans (the command palette, Plan 129, Plan 170).

## Verification

Per slice: the narrow tests of the touched feature, `bun run gates`, the bundle report for web
slices, and a release install for slice 1. Slice 4: `server/index.js` holds no `web-push` code,
a server with push off never loads the push package, and Send test still reaches a registered
device on the mesh (scenario or the owner's phone).

## Integrated branch verification, 2026-09-27

Merged #113 → #114 → #119 → #117 → #118 → #120 onto `fe39528db`, then merged main
`86843435b`. Both notices blockers are fixed: exact-version reviewed full texts
replace missing-text placeholders, unresolved packages fail generation, and runtime
notices resolve through the declaring workspace.

Main advanced while this integration ran. Merged `86843435b` and resolved its wallpaper changes by adding header-only and single-rendition operations to the isolated Bun worker. Imports remain lazy, color sampling requests the library's display rendition, and uploads retain full decoding and process deadlines. The separate main build proved the `apps/web/src/lib` pin stale: 69,219 gzip bytes exceeds the old 68,670 allowance. Only that owner is re-pinned to the main baseline; integrated size is 69,627. Total and all other owner pins stay unchanged.

| Measurement                   | Main `86843435b` |  Integrated |      Change |
| ----------------------------- | ---------------: | ----------: | ----------: |
| Server bundle bytes           |        6,102,591 |   4,852,550 |  -1,250,041 |
| All web JS bytes              |       62,156,876 |  62,030,505 |    -126,371 |
| All web JS gzip bytes         |        9,195,489 |   9,160,162 |     -35,327 |
| First-load JS gzip bytes      |        1,738,773 |   1,736,047 |      -2,726 |
| Linux runtime installed bytes |      588,395,127 | 545,821,872 | -42,573,255 |
| Lockfile package resolutions  |            1,351 |       1,334 |         -17 |

Measured with the same build commands. Baseline source was exported inside the worktree. Server figures are raw, unminified output and include source-path comments. Runtime sizes follow symlinks and count each file inode once; these are logical installed bytes, not reclaimed cache space.

Generated notices add 412,445 web bytes for 258 package/version entries and 367,881 server bytes for 156 entries. The baseline had no generated notice files.

Frozen workspace/runtime installs, gates including knip, every workspace typecheck, server build and web bundle gate passed. Tests passed: 117 server tests, including fonts, images, push, release files, TypeScript runtimes and licence routes; 18 notices/deploy tests; 16 wallpaper catalog/import/route tests. The final decoder/color subset passed 22 tests after the resize type fix. The isolated bundled probe ran from `/` and passed font extraction, full image decoding, header-only reads, both individual renditions, VAPID generation and subset-font loading.

The six deduplication targets each have one package root. Workspace typechecks skip
the shared Editor auto-rebuild step. No deployment or live model calls; macOS and
device push delivery remain unverified. Evidence: `/work/tmp/w2-184-integration-evidence/`.
