# Production product sites

The product sites run on Cloudflare Workers with Static Assets:

- [Fregat](https://fregat.shaulavo.dev/)
- [Singapore and its docs](https://singapore.shaulavo.dev/)
- [Singapore example app](https://singapore.shaulavo.dev/demo/)
- [Ghostty WebGPU and its docs](https://ghostty.shaulavo.dev/)

Each site has its own Worker and exact Custom Domain. Singapore's example app is part of
its Worker at `/demo/`. The landing page has its own editor sample; it loads no example-app
bundles. The apex `shaulavo.dev` and Mesh-owned names are outside this deployment.

On October 10, 2026, the owner chose Cloudflare after retiring the VPS. The Docker, Nginx,
SSH publisher and disabled "Production product sites" workflow have been removed.
Their previous implementation remains in git history.

## Build and deploy

Install dependencies from the repository root with `bun install --frozen-lockfile`.
Wrangler is pinned in the `scripts` workspace. From a fresh checkout:

```sh
bash scripts/product-sites/build.sh scripts/product-sites/dist
bun run product-sites:deploy
```

The output directory must be new. For another deployment, remove only your generated
`scripts/product-sites/dist` directory before building again. Builds run the required workspace
libraries, then the three sites. Production origins are set per site and each site builds at
`/`. The example builds with `VITE_BASE_PATH=/demo/` and is copied into `singapore/demo`.
The build also writes a standalone project index; none of these Workers publishes it.

To use output built elsewhere, copy its `fregat`, `singapore` and `ghostty-webgpu` directories
into `scripts/product-sites/dist`. The three native Wrangler configs declare those directories,
exact Custom Domains, and assets-only serving. Unknown pages and assets return 404.
There is no SPA fallback. Cloudflare handles static MIME types, DNS and TLS.
The build copies `_headers` into each site to preserve HSTS, the referrer policy, `nosniff`
and same-origin framing. HSTS covers each exact hostname.

Authenticate with Wrangler's supported OAuth login or a protected `CLOUDFLARE_API_TOKEN`
environment variable. Check `bun run --cwd scripts wrangler whoami` first. The selected account
must own `shaulavo.dev` and permit Workers deployment and Custom Domain changes. Inspect DNS,
Worker routes and Custom Domains before claiming an exact hostname. Preserve existing mail
records, the apex and private Mesh names.

Deployment is manual. CI still builds sites and checks mobile layouts through the normal
CI workflow. Adding automatic Cloudflare deployment requires an owner-approved API token
in GitHub; this change adds no GitHub secrets. The same command redeploys Singapore after
its docs replacement merges.

## Caching

Hashed assets under `/_astro/` and `/demo/assets/` are immutable for one year;
HTML and unhashed files revalidate. Fonts go through the bundler to get hashed names.
Static Assets defaults to `max-age=0` for everything, so new hashed asset paths need
an `_headers` rule. The cache-header and emitted-font regression tests fail if this breaks.

## Native management and rollback

Use the matching config for each Worker:

```sh
bun run --cwd scripts wrangler deploy --config product-sites/wrangler.singapore.jsonc --dry-run
bun run --cwd scripts wrangler deployments list --config product-sites/wrangler.singapore.jsonc
bun run --cwd scripts wrangler versions list --config product-sites/wrangler.singapore.jsonc
bun run --cwd scripts wrangler rollback VERSION_ID --config product-sites/wrangler.singapore.jsonc
```

Repeat for `wrangler.fregat.jsonc` or `wrangler.ghostty.jsonc`. Rollback restores a previous
Worker version and its assets. The first deployment has no prior version. To withdraw it, run `wrangler delete` with the
matching config for each Worker created here, then verify its Custom Domain was removed. Before rollback, check the
version belongs to the intended Worker. These Workers have no databases or state bindings.

## Verification

```sh
python3 -m unittest discover -s scripts/product-sites -p 'test_*.py'
bun scripts/product-sites/test-mobile.mjs
bun scripts/product-sites/verify-mobile.mjs --origin https://fregat.shaulavo.dev --paths / --evidence /path/to/evidence/fregat
bun scripts/product-sites/verify-mobile.mjs --origin https://singapore.shaulavo.dev --sitemaps /sitemap-index.xml --paths /,/demo/ --evidence /path/to/evidence/singapore
bun scripts/product-sites/verify-mobile.mjs --origin https://ghostty.shaulavo.dev --sitemaps /sitemap-index.xml --paths / --evidence /path/to/evidence/ghostty
```

The mobile checker crawls HTML pages with touch-enabled Chromium and WebKit at 320, 360 and
390 CSS pixels. It checks root overflow and off-screen controls and exercises docs search
and the example app's piece-tree inspector. Evidence is JSON Lines. Use
`--widths 320,360,375,390,393,414,430,667,844 --screenshots` for the wider audit. Additional
options include `--engines chromium`, `--shards 2 --shard 0` and `--workers 1`.
After installing new Playwright WebKit binaries on Arch, run `scripts/playwright-webkit-arch.sh`.

Fetch each root, representative docs pages, JS, CSS, fonts and WASM over HTTPS. Check MIME
headers and missing-page and missing-asset 404s. Confirm immutable caching on emitted
hashed CSS, JS and fonts, and revalidation on HTML and unhashed public files. In a fresh
Chromium and WebKit context, visit a landing page followed by two docs pages. Capture
first text frames and resource timings: warm font requests must have zero transfer bytes
and no conditional revalidation, and the final faces must be loaded before the first text
frame. Fregat has one page; use full-page repeat visits for its warm-cache check. Test Singapore search and follow a docs
cross-link. In Playwright, record landing-page requests through network idle and confirm
none uses `/demo/` or an example-app JS or CSS bundle. Visit `/demo/` separately and test the
editor at a phone viewport. Inspect desktop and phone screenshots for all three sites.
