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

`.github/workflows/product-sites.yml` runs on main pushes affecting site sources, imported
library sources, build configuration or manifests, and on manual dispatch from main. Test-only
changes do not trigger it. Markdown under site sources remains an input. The fixture demo imports
web application and shared-library source, so those source changes still require a site build.

The build job has no deployment secret. It uploads a gzip tar artifact with one-day retention.
A fresh deploy job downloads that artifact and sends it directly over SSH. It runs in the
`production` GitHub environment, whose deployment branch policy allows only the branch `main`.
The deploy job runs no repository or dependency build code. Its artifact download action is pinned
to commit `d3f86a106a0bac45b974a628896c90dbdf5c8093`; this is the only action in the keyed job.
Environment protection has `can_admins_bypass: false`.

The publisher validates paths, file types, indexes and size limits before swapping `current`
to a complete new release. It fsyncs files and directories before activation and fsyncs the
root directory after the atomic switch. A file lock serializes validation, activation and
pruning. A SHA-256 manifest of sorted paths and file contents detects identical site output,
which leaves the current release unchanged regardless of archive timestamps.

Keep at most three complete releases, including current, for rollback. A hidden `.complete`
marker distinguishes finished uploads from interrupted ones. At startup and after activation,
prune other releases and hashed assets referenced by none of the retained releases. SIGALRM,
SIGXCPU, SIGTERM, SIGHUP and SIGINT raise exceptions so cleanup runs. SIGKILL and OOM cannot run
cleanup; the next publisher sweeps their unfinished release under the lock. A failed upload
leaves the previous release active. An unfinished upload is bounded to 400 MiB.

Retained hashed assets cover the current release and rollback releases only. Older cached HTML
can receive an asset 404 after those releases are pruned. This trades indefinite fallback
retention for bounded VPS storage. The cache header permits browsers to retain already loaded
assets for a year; it does not promise a year of origin retention.

HTML uses `Cache-Control: public, max-age=60, must-revalidate`. Hashed files in `_astro` or `assets`
use `public, max-age=31536000, immutable`. Unhashed files revalidate on every request, including the wasm runtime and service worker. Missing pages and assets
return 404, including unknown routes under the editor example. Base-path redirects are relative,
so requests keep the public HTTPS origin while Nginx listens internally on port 8080. The apex accepts only the project
index and the three project paths. The proxy continues to handle `/healthz`.

The hashed-name rule accepts an eight-character build suffix containing an uppercase letter,
digit or underscore. Plain names such as `tree-sitter-typescript.wasm` revalidate. Dotfiles are
rejected in uploads and denied by Nginx. Responses include apex-only HSTS, a strict-origin
referrer policy, `nosniff`, and same-origin framing via CSP and X-Frame-Options. HSTS omits
`includeSubDomains` because this deployment does not own subdomain policy.

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
  `/usr/bin/python3 -B /opt/product-sites/publish.py`.
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
printf 'restrict,command="/usr/bin/python3 -B /opt/product-sites/publish.py" %s\n' "$(cat /path/to/deploy.pub)" \
  > /home/product-sites-deploy/.ssh/authorized_keys
chown root:root /home/product-sites-deploy/.ssh/authorized_keys /opt/product-sites/*
chmod 0644 /home/product-sites-deploy/.ssh/authorized_keys
cd /opt/product-sites
docker compose -f compose.yaml up -d
docker exec product-sites nginx -t
```

## Credential and limits

The dedicated Ed25519 key is named `fregat-product-sites-production-20261008`, fingerprint
`SHA256:Umi3Zhj+VMdKVRkaPKEOir7SfQ2DLlTA6v/MJV4rCjs`. Its private half is stored only in the
`PRODUCT_SITES_DEPLOY_KEY` secret in the repository's main-only `production` environment.
The earlier repository-scoped key was rotated and its repository secret deleted. No private
key is checked in. Workflow temporary key files are mode 0600 and removed on exit.
The public host key was read through the already trusted admin SSH connection and pinned in
`PRODUCT_SITES_KNOWN_HOSTS`. CI uses strict host-key checking and only the dedicated identity.

The forced command accepts the literal SSH command `publish` only. It can write site content
under `/srv/product-sites` and activate it. It rejects shell commands, SFTP, SCP, rsync commands,
absolute paths, traversal, symlinks, hard links, devices, duplicate files, missing site indexes,
more than 50,000 archive members and more than 400 MiB of uncompressed content. The current
payload is about 135 MiB. The process has a 512 MiB address-space limit, a 120 CPU-second soft
limit, a 130 CPU-second hard limit and a ten-minute deadline. `restrict` disables
port forwarding, agent forwarding, X11, PTYs and user SSH startup scripts. It cannot alter the
root-owned publisher, Nginx configuration or proxy configuration. The key does allow replacement
of public website content, which is the purpose of this credential.

To rotate, generate a new Ed25519 key locally, replace the public key in the root-owned
`authorized_keys`, set `gh secret set PRODUCT_SITES_DEPLOY_KEY -R ShaulLavo/fregat --env production`
from the private key on stdin, test a publish, and remove the temporary private key.

Create the environment and its branch policy once with an admin-authorized GitHub token:

```sh
printf '%s\n' '{"can_admins_bypass":false,"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' |
  gh api -X PUT repos/ShaulLavo/fregat/environments/production --input -
printf '%s\n' '{"name":"main","type":"branch"}' |
  gh api -X POST repos/ShaulLavo/fregat/environments/production/deployment-branch-policies --input -
gh secret set PRODUCT_SITES_DEPLOY_KEY -R ShaulLavo/fregat --env production < /path/to/private-key
```

When moving an existing repository secret, rotate the key and delete the old repository secret
with `gh secret delete PRODUCT_SITES_DEPLOY_KEY -R ShaulLavo/fregat` after testing the new identity.
Inspect deployment-branch policies and remove any policy other than the branch `main`.

To revoke, remove the authorized-key entry and run
`gh secret delete PRODUCT_SITES_DEPLOY_KEY -R ShaulLavo/fregat --env production`.
After suspected compromise, stop the container, revoke first, audit the releases, then purge
all published content as root under the publication lock:

```sh
docker compose -f /opt/product-sites/compose.yaml down
flock /srv/product-sites/publish.lock sh -c '
  rm -f /srv/product-sites/current /srv/product-sites/current.next
  rm -rf /srv/product-sites/releases /srv/product-sites/immutable
'
```

Rotate to a fresh key and publish a trusted build before restarting the container. Purging the
origin cannot revoke content already cached by visitors. Audit cookies and any affected clients
separately if malicious content was served.

## Rollback and maintenance

As the VPS admin, list `/srv/product-sites/releases` and point `current` at the selected complete
release with an atomic symlink replacement. Nginx needs no restart:

```sh
flock /srv/product-sites/publish.lock sh -ec '
  cd /srv/product-sites
  ln -s releases/RELEASE_NAME rollback.next
  mv -Tf rollback.next current
'
```

Publication automatically keeps current plus at most two recent complete rollback releases.
Assets referenced by none of those releases are removed under the same lock. With the 400 MiB
upload cap, three releases, their retained assets and one interrupted upload use at most 2.8 GiB of file payload before
filesystem overhead. Retained assets are hard links, though matching files in different releases
can have separate inodes. The normal 135 MiB payload needs substantially less space. This is an
application bound, not a dedicated filesystem quota. The whole sites tree also has an enforced
3 GiB allocated-byte ceiling and 50,000 unique-inode ceiling, including releases, retained assets,
directories, lock and symlinks. Hard-linked files count once. Before extracting each file or creating
directories, reserve its allocation and directory-entry headroom against the remaining budget.
On the first aggregate-budget failure, evict non-current complete rollback releases and their
unreferenced assets under the lock, recount usage and retry the reservation once. Continue the
same input stream; current and the incomplete upload stay intact. If current plus the upload
still cannot fit, reject it. Resolving the root once before publication keeps symlinked paths
from breaking active-release comparisons. Recount the complete tree before the atomic switch.
An over-budget upload is rejected and cleaned
up while the active release stays unchanged. Check free space before changing these limits.

For rollback, hold `publish.lock` across the symlink commands above so a concurrent publisher
cannot prune the chosen release. Use only complete, retained releases.

To apply publisher and header revisions reproducibly from a checkout:

```sh
scp scripts/product-sites/publish.py scripts/product-sites/nginx.conf hetzner:/opt/product-sites/
ssh hetzner 'chown root:root /opt/product-sites/publish.py /opt/product-sites/nginx.conf &&
  chmod 0644 /opt/product-sites/publish.py /opt/product-sites/nginx.conf &&
  docker exec product-sites nginx -t && docker exec product-sites nginx -s reload'
```

For an existing install, remove the admin-generated bytecode file and update the forced command:

```sh
ssh hetzner 'rm -f /opt/product-sites/__pycache__/publish.cpython-312.pyc &&
  { test ! -d /opt/product-sites/__pycache__ || rmdir /opt/product-sites/__pycache__; } &&
  sed -i "s@/usr/bin/python3 /opt/product-sites/publish.py@/usr/bin/python3 -B /opt/product-sites/publish.py@" \
    /home/product-sites-deploy/.ssh/authorized_keys'
```

Use `python3 -B` for admin imports and checks of the installed publisher. The forced command
also uses `-B`, so publisher imports create no bytecode cache in `/opt/product-sites`.

Publish one trusted archive to exercise validation and pruning. Repeating it should report
`Unchanged site content`. The first revision with completion markers sweeps old unmarked
non-current releases. No existing proxy, DNS, Mesh or host-wide SSH setting changes are required.

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
