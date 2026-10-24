# Collect telemetry for one native pair launch

Use the [host telemetry collector](host-telemetry.md) inside the already admitted execution job. Select native mode explicitly. Both telemetry and capture output directories must initially be absent. The collector currently proves launch lifetime only on Linux. On macOS collector setup, policy adapters, native runtime probes, and producer launch are refused before any helper can start. Cleanup remains unproven until a supported lifetime mechanism is available. Linux controls cannot authorize Mac timing qualification.

```sh
python3 scripts/markdown/host-telemetry.py --kind native \
  --evidence-root "$E" --out "$E/telemetry/$INDEX" \
  --report "$E/shards/$INDEX/paired-native.json" \
  --adapter-config "$HOST_ADAPTER" --timeout-seconds 6600 -- \
  "$BUN" scripts/markdown/paired-native.ts --mode qualification \
    --capture-plan "$PLAN" --selection-index "$INDEX" \
    --launch-id "$LAUNCH_ID" --out "$E/shards/$INDEX"
```

Pass the native producer's original plan, selection, and launch ID unchanged. The wrapper requires the runtime followed directly by `paired-native.ts`. Shell launchers and `bun run` are unsupported. The runtime may be discovered through a tool-manager shim. The wrapper observes `process.execPath`, probes that binary directly, and uses it for the actual capture. It retains both runtime probes and the exact executed command.

`--evidence-root` contains the original report and telemetry. It determines `nativeInvocation.reportPath`, such as `shards/0/paired-native.json`. From that report, the sidecars are `../../telemetry/0/host.json` and `../../telemetry/0/quiet-host.json`. The wrapper writes the actual prelaunch host artifact without requiring the browser-only `{hostEvidence}` argument.

Finalization explicitly requires schema 2, `scope: 'paired-native-source'`, and `mode: 'qualification'`. It checks actual host/runtime facts, one counted workload pair, executed selection/launch ID, and the original plan digest. The report's `metadata.startedAt` through `finishedAt` must fit inside the actual process launch. Its `initialization` and `launchPreparation` timestamps must fit inside that interval in order. The existing observation coverage rule remains at most five seconds between actual samples.

After the original report exists, `quiet-host.json` uses the existing quiet-host shape with its existing `nativeInvocation` object. The invocation contains `executablePath`, exact executed `argv`, observed `runtime`, relative `reportPath`, and observed `NODE_OPTIONS` and `BUN_OPTIONS`. Executable and plan byte digests must stay unchanged. Instrumentation flags and environment remain visible for the existing reader's verdict. Source closure, preparation policy, complete plan coverage, raw pair validation, and qualification budgets stay with the producer and reader.

A bound receipt establishes report and observation provenance. It does not certify quiet timing. Busy or noisy observations remain unchanged. Errors and timeouts retain raw observations and invocation records. A timeout returns 124 and produces no finalized quiet-host sidecar, including when a partial report exists.

Confirm that the selected preparation and counted work can complete inside the existing 6,600-second launch cap before scheduling a final matrix. The cap and outer two-hour job bound stay unchanged. Collector fixture controls establish lifecycle behavior only. They do not establish worst-case native completion or Mac timing qualification.

Run the native collector controls with Bun installed:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/markdown -p test_host_telemetry_native.py -v
```
