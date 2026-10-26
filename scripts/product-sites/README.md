# Production product sites

[Fregat](https://fregat.shaulavo.dev/) runs on Cloudflare Workers with Static Assets.

## Build and deploy

Install dependencies from the repository root with `bun install --frozen-lockfile`.
Wrangler is pinned in the `scripts` workspace.

```sh
bash scripts/product-sites/build.sh scripts/product-sites/dist
bun run product-sites:deploy
```

The output directory must be new. The build copies `_headers` into the Fregat site.
`wrangler.fregat.jsonc` declares the output directory and exact Custom Domain.
Hashed assets under `/_astro/` are immutable for one year; HTML and unhashed files revalidate.

Authenticate with Wrangler's supported OAuth login or a protected `CLOUDFLARE_API_TOKEN`
environment variable. Check `bun run --cwd scripts wrangler whoami` first.
Deployment is manual. Preserve existing mail records, the apex and private Mesh names.

## Verification

```sh
python3 -m unittest discover -s scripts/product-sites -p 'test_*.py'
bun scripts/product-sites/test-mobile.mjs
bun scripts/product-sites/verify-mobile.mjs --origin https://fregat.shaulavo.dev --paths / --evidence /path/to/evidence/fregat
```
