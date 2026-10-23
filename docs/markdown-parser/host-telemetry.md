# Collect host telemetry for a bounded timing capture

Use Python 3.10 or newer. Run the telemetry wrapper inside your host's admitted job. The wrapper owns one command process group, samples actual host counters, and binds its sidecar after the original report exists. Linux checks validate the collector. Production timing qualification retains its existing Mac requirement.

```sh
python3 scripts/markdown/host-telemetry.py \
  --out "$E/telemetry/$INDEX" --report "$E/shards/$INDEX/production-browser.json" \
  --adapter-config "$HOST_ADAPTER" --timeout-seconds 6600 -- \
  bun scripts/markdown/production-browser.ts \
    --directory "$BUILD" --port "$PORT" --out "$E/shards/$INDEX" \
    --host-evidence '{hostEvidence}' "$@"
```

Pass the capture's existing workload, pair, launch, browser, warmup, trial, and control arguments unchanged. Use absent sibling telemetry and capture directories per launch. The wrapper creates its telemetry directory; the capture creates its own directory. The wrapper substitutes the complete `{hostEvidence}` argument with its prelaunch `host.json` path. It performs no shell expansion and acquires no host reservation.

From `$E/shards/$INDEX/production-browser.json`, use `../../telemetry/$INDEX/host.json` and `../../telemetry/$INDEX/quiet-host.json` for the per-report sidecars. Both remain inside the common `$E` evidence root.

The adapter config is a JSON object with a nonempty `command` array. Each invocation receives `collectorPid`, `captureProcessGroup`, and `phase` on stdin as JSON. The group is null before launch. The external command observes the host's owner reservation, AC power, and unrelated admitted jobs. It returns actual `observedAt`, boolean `ownerBusy` and `acPower`, and a `runningJobs` string array. Keep host-specific paths, scheduling tools, and standing-service policy outside the repository. Unknown observations must fail. The adapter has a one-second execution deadline and must leave no detached background processes.

The default interval is two seconds. The wrapper requires actual observations before, during, and after the report's measured interval, with advancing timestamps and gaps of at most five seconds. No missing interval is interpolated. A report shorter than the sample interval may have insufficient coverage and fails finalization.

The native observers support Linux x86-64 through `/proc` and macOS through Mach CPU counters and `proc_pid_rusage`. Stable process identity uses PID plus kernel start identity. Current process-group membership and observed ancestry establish capture ownership. Observed descendants remain owned when they change process groups. CPU is a percentage of total logical CPU capacity. Stable owned identities present at both interval boundaries contribute to the owned lower bound. A new owned process contributes lifetime CPU only when its kernel birth clock proves it started inside the interval. Read-order skew and tick rounding reduce that subtraction. Unattributed, vanished, inaccessible, or unobserved process CPU stays competing.

Outputs are:

- `host.json`, the existing host artifact shape, written before the command starts.
- `observations.jsonl`, raw counter snapshots, policy observations, process identities, interval calculations, and errors.
- `quiet-host.json`, the existing quiet-host artifact shape, bound to SHA-256 of the original report bytes after exit.
- `receipt.json`, binding outcome, actual command exit, and process-group cleanup result.

A bound receipt establishes provenance and coverage. The existing reconciliation consumer decides quiet-host acceptance using its unchanged limits. Busy, battery, competing load, and other-job values stay in the sidecar. Observation errors, a changed host binding, missing report, interrupted launch, or timeout preserve incomplete evidence and produce no quiet-host artifact. The wrapper closes its adapter and capture process groups on exit. It preserves all report bytes and never creates a combined browser launch.

Run the narrow controls with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/markdown -p test_host_telemetry.py -v
```
