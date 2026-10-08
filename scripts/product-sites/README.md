# Production product sites

`https://shaulavo.dev/` lists the sites at `/fregat/`, `/singapore/` and `/ghostty-webgpu/`.
Cloudflare supplies DNS. The existing Coolify Traefik proxy supplies HTTPS and certificates.
A read-only Nginx container serves the files over the private `coolify` Docker network.
There are no new host ports, DNS changes, proxy restarts or Mesh changes.

One container is enough for static files. A separate Coolify resource for every project would
add three build configurations and deploy credentials for the same directory upload. The proxy
already discovers Docker labels, so the apex router lives in `compose.yaml` alongside its server.
The existing apex HTTP redirect and `/healthz` route stay in place.

## Build and deploy

From a fresh checkout with dependencies installed:

```sh
bash scripts/product-sites/build.sh /path/to/new-output-directory
```

The output directory must be new. The build runs the workspace library builds, builds Fregat's
landing page and fixture demo, builds Singapore at `/singapore/`, and builds ghostty-webgpu at
`/ghostty-webgpu/`. Until `editor/site/package.json` exists, Singapore uses `editor/examples/app`.
`SITE_ORIGIN` sets the production Astro origin. The existing Pages workflow keeps its defaults.

`.github/workflows/product-sites.yml` runs on relevant main pushes and manual dispatch from main.
It sends one gzip tar archive over SSH. The publisher validates paths, file types, indexes and
size limits before swapping `current` to the complete new release. A failed upload leaves the
previous release active. A file lock serializes publishers. Releases remain available for rollback.
Hashed assets are hard-linked into an append-only `immutable` directory. Nginx falls back to those
files after a new release, so cached HTML can still load assets from the previous build.

HTML uses `Cache-Control: public, max-age=60, must-revalidate`. Hashed files in `_astro` or `assets`
use `public, max-age=31536000, immutable`. Unhashed files revalidate on every request, including the wasm runtime and service worker. Missing pages and assets
return 404, including unknown routes under the editor example. Base-path redirects are relative,
so requests keep the public HTTPS origin while Nginx listens internally on port 8080. The apex accepts only the project
index and the three project paths. The proxy continues to handle `/healthz`.

## VPS setup

The production host is reached through the owner's `hetzner` SSH alias. CI reaches its public
address from the `PRODUCT_SITES_DEPLOY_HOST` repository variable. No tailnet setup is needed in CI.
These are all the VPS changes made for this deployment:

- Add the system account `product-sites-deploy`, with a locked password and `/bin/sh` for SSH's
  forced-command transport. It has no sudo, Docker group membership or other service access.
- Create `/srv/product-sites`, owned by that account. It holds releases, retained hashed assets, `current` and a lock file.
- Create `/opt/product-sites`, owned by root. Copy `compose.yaml`, `nginx.conf` and `publish.py` here.
- Make `/home/product-sites-deploy`, its `.ssh` directory and `authorized_keys` root-owned.
  Directory mode is 0755, key-file mode is 0644. The deploy user can read the public key file;
  it cannot replace it. SSH reads it as the deploy user, so root-only read permission fails.
- Add one dedicated Ed25519 public key with `restrict` and the forced command
  `/usr/bin/python3 /opt/product-sites/publish.py`.
- Pull `nginx:1.28.2-alpine` and start the `product-sites` Compose container on `coolify`.
  It runs as UID/GID 101, drops all Linux capabilities, has a read-only filesystem and mounts
  the site tree read-only. Its writable temporary directories are in-memory filesystems.
- The container labels add an HTTPS router for exactly `Host(shaulavo.dev)`, with the existing
  `letsencrypt` resolver. The router sends traffic to Nginx on internal port 8080.

To reproduce the account and files, run these as root on the VPS after copying this directory
to `/opt/product-sites`:

```sh
useradd --system --create-home --home-dir /home/product-sites-deploy --shell /bin/sh product-sites-deploy
install -d -m 0755 -o product-sites-deploy -g product-sites-deploy /srv/product-sites
install -d -m 0755 /opt/product-sites /home/product-sites-deploy/.ssh
chown root:root /home/product-sites-deploy /home/product-sites-deploy/.ssh
printf 'restrict,command="/usr/bin/python3 /opt/product-sites/publish.py" %s\n' "$(cat /path/to/deploy.pub)" \
  > /home/product-sites-deploy/.ssh/authorized_keys
chown root:root /home/product-sites-deploy/.ssh/authorized_keys /opt/product-sites/*
chmod 0644 /home/product-sites-deploy/.ssh/authorized_keys
cd /opt/product-sites
docker compose -f compose.yaml up -d
docker exec product-sites nginx -t
```

## Credential and limits

The dedicated Ed25519 key is named `fregat-product-sites-actions-20261008`. Its private half is
stored only in the `PRODUCT_SITES_DEPLOY_KEY` repository Actions secret after setup. No private
key is checked in. Workflow temporary key files are mode 0600 and removed on exit.
The public host key was read through the already trusted admin SSH connection and pinned in
`PRODUCT_SITES_KNOWN_HOSTS`. CI uses strict host-key checking and only the dedicated identity.

The forced command accepts the literal SSH command `publish` only. It can write site content
under `/srv/product-sites` and activate it. It rejects shell commands, SFTP, SCP, rsync commands,
absolute paths, traversal, symlinks, hard links, devices, duplicate files, missing site indexes,
more than 50,000 archive members and more than 1 GiB of uncompressed content. The process has
a 512 MiB address-space limit, 120 CPU seconds and a ten-minute deadline. `restrict` disables
port forwarding, agent forwarding, X11, PTYs and user SSH startup scripts. It cannot alter the
root-owned publisher, Nginx configuration or proxy configuration. The key does allow replacement
of public website content, which is the purpose of this credential.

To rotate, generate a new Ed25519 key locally, replace the public key in the root-owned
`authorized_keys`, set `gh secret set PRODUCT_SITES_DEPLOY_KEY -R ShaulLavo/fregat` from the private
key on stdin, test a publish, and remove the temporary private key. To revoke, remove that
`authorized_keys` entry and delete the repository secret.

## Rollback and maintenance

As the VPS admin, list `/srv/product-sites/releases` and point `current` at the selected complete
release with an atomic symlink replacement. Nginx needs no restart:

```sh
cd /srv/product-sites
ln -s releases/RELEASE_NAME rollback.next
mv -Tf rollback.next current
```

Before pruning old releases, check the `current` target and keep the current release and recent
rollback candidates. Releases are deployment artifacts. This setup does not delete earlier
releases automatically. Check free space when changing site payloads or retention. Retained hashed assets also need an
admin retention policy. Keep them for the advertised one-year cache lifetime.

To stop serving this apex, run `docker compose -f /opt/product-sites/compose.yaml down`. This removes
only the product-sites container and its apex route. Preserve `/srv/product-sites` for rollback.

## Checks

```sh
python3 -m unittest discover -s scripts/product-sites -p 'test_*.py'
python3 scripts/product-sites/verify.py https://shaulavo.dev
bun run agent:browser look --site --url https://shaulavo.dev/fregat/ --width 1440 --height 1000
```

Run `look` for each project and the index at both 1440 and 390 CSS pixels. Inspect the screenshots
and the recorded browser problems. Use `curl -I` without `-k` to check TLS and caching headers;
request a missing page and a missing asset to confirm 404s. Verify a hashed JS or CSS file gets
`immutable`, while each site's HTML gets a 60-second cache. GitHub Pages stays enabled until the
separate redirect work ships.
