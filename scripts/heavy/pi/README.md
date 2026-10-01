# Raspberry Pi lane

Runs low-resource scenarios (large-file typing, slow starts, worker back-pressure) on the
Raspberry Pi from this machine. Measurements that need a quiet fast machine stay local.

## The host

|         |                                                                                      |
| ------- | ------------------------------------------------------------------------------------ |
| Model   | Raspberry Pi 4 Model B Rev 1.2                                                       |
| CPU     | 4 × Cortex-A72, aarch64                                                              |
| Memory  | 3.7 GiB, 2 GiB zram swap (off inside lane scopes)                                    |
| OS      | Debian 13 (trixie), kernel `6.18.39+rpt-rpi-v8`                                      |
| Disk    | 29 GB SD card                                                                        |
| Tailnet | `pi`, 100.94.222.118                                                                 |
| Runtime | mesh (user service with linger), Bun from `packageManager`, git, Playwright Chromium |

The kernel boots with `cgroup_disable=memory` and no PSI. `setup.sh --enable-cgroups` appends
`cgroup_enable=memory psi=1` to `/boot/firmware/cmdline.txt` (backup beside it as
`cmdline.txt.before-lane`) and reboots; without it a `MemoryMax` cap is silently ignored.

## Access

The Pi authorizes `~/.ssh/id_ed25519_mesh` for user `pi`. `~/.ssh/config` on this machine:

```sshconfig
Host pi
    HostName 100.94.222.118
    User pi
    IdentityFile ~/.ssh/id_ed25519_mesh
    IdentitiesOnly yes
```

Files move over ssh; commands run through `mesh pi --`, so a run survives a dropped connection.

## Use

```bash
scripts/heavy/pi/setup.sh                 # once, and after a Bun or Playwright bump
bun run build:workspaces                  # through the heavy wrapper; the Pi builds nothing
scripts/heavy/pi/sync.sh --web <built-web-dir>
scripts/heavy/pi/run.sh large-file -- bun scripts/large-file/bench.ts \
  --web-root \$HOME/fregat-lane/web --sizes 1,10 --memory-mib 2560 --out \$LANE_RUN
```

`sync.sh` checks out this tree's commit on the Pi (`~/fregat-lane/platform`), applies its
uncommitted changes and untracked files, copies the built workspaces and runs
`bun install --frozen-lockfile --ignore-scripts`. Tree-sitter grammar packages have no arm64
prebuilds and the editor loads their wasm, so their native install scripts are skipped.

`run.sh` runs the command from the Pi's checkout inside a `MemoryMax=3G`, swap-off scope
(`--memory-max`), writes `lane.json` (host, exit, wall time, memory peak, CPU time, OOM kills) and
copies the run directory to `/work/tmp/fregat-evidence/<time>-<label>-pi/`.

## Reading the numbers

Headless Chromium rasterizes with SwiftShader on the Pi and on this machine alike; the Pi's GPU is
unused. Each large-file result records `host` and `rendering` (the WebGL renderer string), and
`comparison.md` shows both. Software-rendered key latency includes CPU rasterization, so it is a
CPU-bound stress number, not what a display attached to the Pi would show.
