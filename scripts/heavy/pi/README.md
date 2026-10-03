# Raspberry Pi lane

Runs low-resource scenarios (large-file typing, slow starts, worker back-pressure) on the
Raspberry Pi from this machine. Measurements that need a quiet fast machine stay local.

## The host

|         |                                                                                             |
| ------- | ------------------------------------------------------------------------------------------- |
| Model   | Raspberry Pi 4 Model B Rev 1.2                                                              |
| CPU     | 4 × Cortex-A72, aarch64                                                                     |
| Memory  | 3.7 GiB, 2 GiB zram swap (off inside lane slices)                                           |
| OS      | Debian 13 (trixie), kernel `6.18.39+rpt-rpi-v8`, systemd 257                                |
| Disk    | 29 GB SD card                                                                               |
| Tailnet | `pi`, 100.94.222.118                                                                        |
| Runtime | mesh (user service with linger), Bun from `packageManager`, git, rsync, Playwright Chromium |

The kernel boots with `cgroup_disable=memory` and no PSI, so `MemoryMax` is silently ignored.
`setup.ts --enable-cgroups` reads `/boot/firmware/cmdline.txt` and refuses anything but one line
holding `root=` without `psi=0` or `cgroup_disable=memory`. It adds whichever of
`cgroup_enable=memory` and `psi=1` is missing, keeps the first backup as `cmdline.txt.before-lane`,
rereads the file, and reboots only after the write checks out.

## Access

The Pi authorizes `~/.ssh/id_ed25519_mesh` for user `pi`. `~/.ssh/config` on this machine:

```sshconfig
Host pi
    HostName 100.94.222.118
    User pi
    IdentityFile ~/.ssh/id_ed25519_mesh
    IdentitiesOnly yes
```

Files and commands go over ssh. A job holds a lease on its ssh session (below), so a dropped
connection stops the job instead of leaving it running unattended.

## Use

```bash
bun run build:workspaces                   # through the heavy wrapper; the Pi builds nothing
bun scripts/heavy/pi/setup.ts              # once, and after a Bun or Playwright bump
bun scripts/heavy/pi/sync.ts --web <built-web-dir> [--include <untracked file>]…
bun scripts/heavy/pi/run.ts large-file -- bun scripts/large-file/bench.ts \
  --web-root \$HOME/fregat-lane/web --sizes 1,10
```

Setup, sync, run and the wrapper's `--host pi` all take one lock, `pi.lock` beside the machine
slots in `/work/tmp/wave-heavy` (`--lock-dir` for these tools, `--state-dir` for the wrapper),
before they reach the Pi: a sync never replaces
the checkout under a running job, and two jobs never share the Pi. Each refuses a checkout whose
history lacks Fregat's first commit before it touches the Pi.

The lane is one directory under the Pi user's home (`--lane`, default `fregat-lane`, lowercase
letters, digits and dashes). Setup marks it with `.fregat-lane`; sync and run refuse a lane that
is missing the marker, is a symlink, or resolves elsewhere.

`sync.ts` checks out this tree's commit in `<lane>/platform`, applies the tracked changes against
HEAD and copies the built workspace `dist/` directories, then runs
`bun install --frozen-lockfile --ignore-scripts` (tree-sitter grammar packages have no arm64
prebuilds; the editor loads their wasm). Untracked files stay here unless named with `--include`;
gitignored, tracked and secret-looking paths (`.env*`, `*.pem`, `*key*`, `*credential*`) are
refused, and changes plus includes are capped at `--max-transfer-mib` (64). Sync lists the
untracked files it left, and the bench's `source.json` on the Pi shows the same gap.

`run.ts` runs the command from the lane checkout in its own slice, capped at `--memory-max` (3G)
with swap off. `$HEAVY_JOB_SLICE` names that slice, and bench cases join it with `--slice=`, so the
cap and the totals in `lane.json` (exit, wall time, memory peak, CPU time, OOM kills) cover them.
The run directory is copied to `/work/tmp/fregat-evidence/<time>-<label>-<id>-pi/`, and
`FREGAT_EVIDENCE_ROOT` points there on the Pi; a run whose evidence does not arrive exits 74 even
when its command succeeded.

The job's lifetime is enforced on the Pi:

- **Lease.** The local side writes a heartbeat line to the ssh session's stdin every 5 s. The
  shell on the Pi stops the slice when stdin closes, when no heartbeat arrives for 30 s, or when
  it is hung up on. Cancelling (a signal to `run.ts` or the wrapper) closes the lease; a cancel
  before the job starts means it never starts.
- **Ceiling.** `--max-wall` (3600 s) is the job scope's `RuntimeMaxSec`, and a transient timer
  stops the whole slice at that time even if every shell is gone.
- **Stop.** TERM to every process in the slice, KILL 10 s later if any remain, then the slice,
  its timer, its failed members and its runtime drop-in are unloaded.

The local side returns, and so releases `pi.lock`, only once the slice is confirmed unloaded on
the Pi. If six bounded attempts cannot confirm it, the job is reported ABANDONED on stderr and in
`abandoned.json` beside its evidence, with exit 75; its ceiling timer still ends it on the Pi.

## Through the heavy wrapper

```bash
bun /work/platform-production/heavy/current/run.js --host pi large-file -- \
  bun scripts/large-file/bench.ts --web-root /home/pi/fregat-lane/web --sizes 1,10
```

`--host pi` takes `pi.lock` and stays out of this machine's admission queue and slot locks, and
holds it until its
launcher exits, which is after the Pi confirms the job stopped. The launcher syncs the caller's
checkout, runs the command from the same directory inside the lane slice under the lease above,
copies the run directory to `/work/tmp/fregat-evidence/`, and hands the slice's totals to the
wrapper's record. `--max-wall <seconds>` limits running time on either host. Queue wait is
unlimited and excluded; local jobs have no default running limit, and Pi jobs default to 3600 s.
A signal to the wrapper cancels the job. The web build is not synced this way; ship it once with `sync.ts --web`.

## Reading the numbers

Each large-file result records `host` and `rendering`: Chromium's GPU feature status for page
`rasterization` and `gpu_compositing` (the values chrome://gpu shows), read over CDP. Headless
Chromium reports `disabled_software` for both on the Pi and on this machine, and the Pi's GPU is
unused. Key latency there includes CPU rasterization: a CPU-bound stress number, not what a
display attached to the Pi would show. The samples are keydown to `requestAnimationFrame` callback.
