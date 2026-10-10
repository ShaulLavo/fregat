# Singapore documentation

Astro serves the docs under `/docs`. Hand-written pages are plain Markdown under `src/content/docs/docs/`. The build opens the real Singapore editor in Chromium, captures every manual, the home sample and the install command in both palettes, and qualifies original, restored and static document pixels at phone and desktop widths. Cached captures depend on source, fonts, styles, configuration, the lockfile and built editor packages.

Pages inline the editor's complete document paint and emitted rows. The same captured payload produces the three first-paint widths. A blocking head script prepares streamed snapshot visibility, and inline scripts activate syntax colours synchronously after each emitted root. Parsing completion releases any root whose activation was missing. With JavaScript off, the emitted rows keep their text, headings, links and layout. The lightweight paint entry reflows the document after fonts load, while the existing rows stay visible. Full editor code and grammars load when the reader chooses **Go live**. **Go static** captures current edits; edits survive theme changes and manual navigation in the same browser tab. Both modes scroll with the page. The palette lives in `src/styles/manual.css`, and build capture and live editing share `src/manual/configuration.ts`. Fences use the languages registered in `src/manual/languages.ts`.

Starlight still renders `.mdx` pages, the playground and the generated API reference, and runs Pagefind over every page. `src/manual/sections.ts` orders the page list for both. Starlight CSS lives in `src/styles/site.css`.

From the Fregat checkout root:

```sh
bun install --frozen-lockfile
bun x turbo run build --filter='./editor/packages/*'
bun --cwd editor/site x playwright install chromium webkit
bun run --cwd editor/site build
```

Chromium is required for the build-time capture. WebKit is used by browser tests. On Arch Linux, run `scripts/playwright-webkit-arch.sh` after downloading a new WebKit. CI installs browser prerequisites before building. The build also checks samples, generates the API reference and validates internal links. Preview with `bun run --cwd editor/site preview --host 127.0.0.1 --port 4329`, choosing an unused port. `bun run --cwd editor/site dev` prepares captures before starting Astro.

After building, run `bun run --cwd editor/site test:browser` to check both toggle directions, exact pixels, links, edited source, history, search, theme, phone widths and failed grammar startup. The tests start and stop their own loopback previews on free ports. A browser's tests skip when its executable is absent. Run `bun run agent:browser scenario singapore-site-takeover --url <preview-root-url>` for step-by-step home and manual evidence.

Standalone installs use the editor workspace's checkout-local Bun store so TypeDoc can resolve its Markdown plugin. Keep `typedoc-plugin-markdown` aligned with the other documentation workspaces: TypeDoc and the Starlight theme must load the same plugin instance. A unit test checks that their resolved module paths match. The docs workspace pins TypeScript 6 for TypeDoc's JavaScript compiler API. The packages and documentation sample checker use the repository's TypeScript 7 compiler. Each published package gets a `starlight-typedoc` reference generated from all its public declaration entry points. The sidebar links to package overviews, which link into the complete symbol reference. Individual symbols have their own reference pages. Internal exports stay out of the reference.

Examples live in `src/examples`. The home page sample is `hero.ts`, and the TypeScript playground runs `playground.ts` in a live editor. Starlight's `not-content` class keeps Markdown spacing outside that editor. The sample checker extracts every JavaScript and TypeScript fence in authored docs, compiles each as its own module and reports the page and line on failure. React and Solid examples use separate JSX settings. Reference pages show generated API signatures; upstream TSDoc example tags are excluded until those examples have checked, self-contained source files.

`starlight-links-validator` checks documentation routes and heading anchors at build time. Its unified plugin types need the explicit `@astrojs/markdown-remark` type reference, including in standalone installs. A rendered-HTML check also validates links from Astro components, including the home page and package table. Source and contribution links point to [Fregat](https://github.com/ShaulLavo/fregat/tree/main/editor), the source of truth. Hosting and the public domain are owned by the separate hosting track.

Astro uses Satteri for Markdown rendering. Its native binding stays external during server prerender so it resolves from the installed package directory. The direct dependency and scoped unused-dependency exception keep that loader available in fresh installs.
