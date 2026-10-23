# Capture bounded Markdown timing and raster evidence

Use this sequence after the coordinator freezes the candidate. Development captures use the same
workload and output contracts, but they cannot qualify a candidate. Keep every original failure,
exclusion, raw file, command line, and cleanup receipt. Do not replace missing rows with summaries.

## Prepare immutable inputs

Use one common evidence root `E`. Put production assets, captured source, plans, original launch
reports, telemetry, and final assembly beneath it. Keep `E` outside the source checkout. Choose
absent output directories and explicit free loopback ports. Schedule each launch through the
execution host's shared queue with a two-hour outer timeout and installed teardown.

Required inputs are the clean candidate commit, complete qualification source closure and runtime,
lockfile, frozen budget, both grammar files, resolver, workload manifest, full production build and
Vite manifest, captured fonts, and coordinator-provided frozen timing identity `FROZEN`. Hash actual
bytes. Preserve their paths and hashes in the original sidecars. A copied label or a manually written
host sample supplies no observation.

Final production timing requires headed Chromium on the identified quiet Mac. Native qualification
uses the intended execution host and runtime recorded by its plan. Plans generated on another runtime
fail source validation. Linux development results do not establish Mac timing. Install the portable
host telemetry helper and configure its actual machine policy adapter before capturing. Its wrapper
acquires no reservation. The helper provides its platform-specific adapter instructions separately.

```sh
test -z "$(git status --porcelain=v1 --untracked-files=all)"
bun scripts/markdown/production-browser.ts --build "$BUILD"
bun scripts/markdown/production-browser.ts --directory "$BUILD" \
    --plan-out "$E/browser-plan.json" --capture promotion
```

The browser plan binds the full 86-cell manifest, source, budget, build metadata, and asset manifest.
Its 1,978 ordered selections contain each workload paired with `[-3,-2,-1,0,...,19]`. Array position
is the selection index. Preserve the plan bytes unchanged.

## Capture one browser selection

Set `INDEX` to one planned selection. Run this command once inside the reserved host job. Repeat
through the complete immutable selection list, retaining a separate original report for every launch.
The child limit is 6,600 seconds. It includes launch preparation, capture, serialization, and cleanup.
A timeout remains an incomplete original launch, with its selected identity and partial evidence.

```sh
python3 scripts/markdown/host-telemetry.py \
    --out "$E/telemetry/$INDEX" \
    --report "$E/shards/$INDEX/production-browser.json" \
    --adapter-config "$MACHINE_TELEMETRY_CONFIG" --timeout-seconds 6600 -- \
    bun scripts/markdown/production-browser.ts --directory "$BUILD" --port "$PORT" \
    --out "$E/shards/$INDEX" --plan "$E/browser-plan.json" --shard "$INDEX" \
    --trials 20 --warmups 3 --negative-controls --browser chromium --headed \
    --capture promotion --browser-executable "$CHROMIUM" --host-evidence '{hostEvidence}'

mkdir -p "$E/sidecars"
bun scripts/markdown/production-capture-artifacts.ts --root "$E" \
    --report "$E/shards/$INDEX/production-browser.json" --build "$BUILD" --source "$PWD" \
    --snapshot "$E/captured-source" --frozen "$FROZEN" \
    --host "$E/telemetry/$INDEX/host.json" \
    --quiet-host "$E/telemetry/$INDEX/quiet-host.json" --out "$E/sidecars/$INDEX"
```

The literal `{hostEvidence}` becomes the actual prelaunch host artifact. Diagnostic captures also
retain supplied host evidence, while their development capture kind remains unchanged. Telemetry brackets the
original report interval with continuous actual observations at gaps of at most five seconds and
finalizes against that original report's SHA256. Capture and telemetry directories are siblings,
so both can start absent. The finalizer verifies source and asset bytes, retains them, and writes
browser, font, source, and per-launch timing sidecars. It preserves the report bytes and browser's
actual executable and arguments. It does not create host observations or a quiet verdict.

Each original report retains the declared 20 measured pairs and three warmups, but captures only its
selected original pair. Within that pair the original seeded AB/BA arm ordering stays unchanged.
Every arm creates a fresh browser context and page. A warm workload performs its existing unmeasured
prewarm inside that same context before capture. A cold workload starts cache-empty. Earlier warmup
pairs never warmed later arm contexts in the original producer. Splitting at pair boundaries therefore
preserves the original cold/warm policy without extra browser preparation. The counted negative rows
remain present. Browser process startup and controls occur in each real launch and remain visible.

## Capture native selections with their own cache profile

Generate the native plan on the intended execution host after source freeze:

```sh
bun scripts/markdown/paired-native.ts --write-capture-plan "$E/native-plan.json" \
    --purpose qualification --mode qualification --seed 176
```

Its 1,725 ordered selections follow the frozen 75-workload order and `[-1,-2,-3,0,...,19]` pair
sequence. The plan includes the complete qualification provenance, including runtime. Execute one
selection per reserved bounded launch with an original unique `LAUNCH_ID`:

```sh
python3 scripts/markdown/host-telemetry.py --kind native --evidence-root "$E" \
    --out "$E/native-telemetry/$INDEX" \
    --report "$E/native-shards/$INDEX/paired-native.json" \
    --adapter-config "$MACHINE_TELEMETRY_CONFIG" --timeout-seconds 6600 -- \
    "$BUN" scripts/markdown/paired-native.ts --mode qualification --capture-plan "$E/native-plan.json" \
    --selection-index "$INDEX" --launch-id "$LAUNCH_ID" --out "$E/native-shards/$INDEX"

GRAMMAR=$("$BUN" -e "process.stdout.write(require.resolve('tree-sitter-md/tree-sitter-markdown.wasm'))")
CHAT_GRAMMAR=$("$BUN" -e "process.stdout.write(require.resolve('tree-sitter-md/tree-sitter-markdown-chat.wasm'))")
RESOLVER=$("$BUN" -e "process.stdout.write(require.resolve('tree-sitter-md/tree-sitter-md.wasm'))")
mkdir -p "$E/native-sidecars"
bun scripts/markdown/production-capture-artifacts.ts --kind native --root "$E" \
    --report "$E/native-shards/$INDEX/paired-native.json" --source "$PWD" \
    --snapshot "$E/captured-native-source" --frozen "$FROZEN" \
    --grammar "$GRAMMAR" --chat-grammar "$CHAT_GRAMMAR" --resolver "$RESOLVER" \
    --host "$E/native-telemetry/$INDEX/host.json" \
    --quiet-host "$E/native-telemetry/$INDEX/quiet-host.json" --out "$E/native-sidecars/$INDEX"
```

Native launches start fresh Bun processes. Module, parser, and JIT caches are shared within each
launch. Each arm creates a fresh session, HAST processor, and projection WeakMap, without forced GC.
Both engines receive three extra full-workload preparation replays in seeded paired order. The
original selected pair follows, retaining its original trial ID and arm order. Equal replay counts
do not imply equal cache contents or identical JIT state.

Keep `metadata.initialization`, `metadata.launchPreparation`, and the authoritative three-row
`raw-native-preparation.jsonl`. Initialization measures dynamic imports, extension readiness, and
WASM initialization. Static imports and OS startup remain in the actual outer invocation. Subtract
none of that work from counted metrics. Preparation failures, coordinate failures, and mismatches
invalidate the launch. Its six extra preparation arms never enter counted sample populations.

Complete counted native coverage is 75 cells, 225 warmup pairs, 1,500 measured pairs, 1,725 pairs,
3,450 arms, and 1,128,794 revision records. Original full-run shared-process captures remain a
separate profile. Never mix them with prepared shards.

Worst-cell feasibility remains unresolved. A declared deep-list 1 MiB/4,096 first-warmup remark arm
timed out after 600 seconds without a completed arm row. That does not prove a two-hour impossibility
or predict M1 performance. Three preparation pairs plus a counted pair fitting within 6,600 seconds
has not been established for every selection. Preserve timeout identity and partial evidence. Do not
increase deadlines, weaken budgets, or supply absent rows.

## Assemble original launches

For each native launch, retain the original report, raw counted pair, preparation raw file, actual
host and quiet-host records, source capture, lockfile, budget, and all grammar assets. Its schema-1
per-launch timing manifest has `kind: "native"`, the original report path, frozen identity path, and
`timingSidecarFiles`. Use null for browser-only sidecars. Paths in that per-launch manifest are relative
to the manifest. The native quiet receipt binds one actual `nativeInvocation`, including executable,
argv, runtime, instrumentation environment, and report-relative identity inside `E`.

Write `LAUNCHES` as a JSON array of all original per-launch manifest paths. Assemble each domain
separately. The same assembler accepts the native plan and native launch list.

```sh
bun scripts/markdown/production-shards.ts --root "$E" --plan "$E/browser-plan.json" \
    --frozen "$FROZEN" --launches "$LAUNCHES" --out "$E/browser-assembly"
bun scripts/markdown/production-reconciliation.ts --root "$E" \
    --manifest "$E/browser-assembly/timing-manifest.json" --out "$E/browser-reconciled.json"
```

Assembly rejects gaps, duplicates, wrong plan selections, and conflicting frozen bytes. The index
retains each original report SHA256 and report-relative sidecars. It creates no combined report,
command line, or invocation. Reconciliation validates every original launch before deriving the
20-pair confidence comparisons. It preserves all source, family, budget, control, input/output,
launch identity, failure, exclusion, and quiet-host gates. Resource plateaus use actual repeated
windows from the same original launch and realm. Unrelated heaps never form one plateau.

## Capture the exact raster matrix

Use the existing browser visual producer in four modes. Run Chromium modes on the assigned browser
host and WebKit modes on the Mac lane. For each invocation, set `MODE`, a new `LOG`, and two verified
free ports. Keep the same frozen checkout, viewport, theme, device scale, fonts, and fixture bytes.

```sh
VITEST_BROWSER_PORT="$PORT" VITEST_BROWSER_FILE_SERVER_PORT="$FILE_PORT" \
    bun --bun vitest run --config apps/web/vitest.markdown-qualification.config.ts \
    --mode "$MODE" --cache=false --maxWorkers=2 qualification.browser.tsx > "$LOG" 2>&1
```

Modes are `baseline`, `candidate`, `baseline-webkit`, and `candidate-webkit`. Each mode captures
32 stories at two widths and two themes, with four same-engine repeated-capture calibrations.
Retain original logs, capture-time original bindings, and every PNG before moving or cleaning the
checkout. Run this copy step on each capture host after its existing capture-time retention step.
Set `CAPTURE_ROOT` to the actual source capture root and `RETAINED` to an absent directory under
that host's copy of `E`. Pass all that host's original visual logs. The script copies once per literal
original path. Distinct images remain distinct even when their hashes and pixels are equal.

```sh
python3 - "$CAPTURE_ROOT" "$E" "$RETAINED" "$LOG_FIRST" "$LOG_SECOND" <<'PY'
import hashlib, json, pathlib, shutil, sys
capture, root, output = [pathlib.Path(p).resolve() for p in sys.argv[1:4]]
output.relative_to(root)
output.mkdir(parents=True, exist_ok=False)
originals = {}
for log in sys.argv[4:]:
    for line in pathlib.Path(log).read_text().splitlines():
        for marker, fields in [
            ('MARKDOWN_BROWSER_VISUAL ', ['screenshot']),
            ('MARKDOWN_BROWSER_CALIBRATION ', ['first', 'repeated']),
        ]:
            if marker not in line:
                continue
            record = json.loads(line.split(marker, 1)[1].strip())
            for field in fields:
                original = record[field]
                source = pathlib.Path(original)
                if not source.is_absolute():
                    raise ValueError('An original screenshot path must be absolute')
                source.resolve(strict=True).relative_to(capture)
                originals.setdefault(original, source)
images = []
for index, (original, source) in enumerate(originals.items()):
    before = source.stat()
    target = output / f'{index:05d}.png'
    shutil.copyfile(source, target)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    after = source.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != \
       (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError('Original image changed while retaining bytes')
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise ValueError('Retained image differs from its original')
    images.append(dict(original=original, file=target.relative_to(root).as_posix(), sha256=digest))
(output / 'images.json').write_text(json.dumps(dict(schemaVersion=1, images=images), indent=2) + '\n')
PY
```

Copy each retained directory, unchanged logs, and capture-time original binding files to the same
relative location under common `E`. Preserve both host maps. Join their `images` arrays into
`$E/raster-image-map.json` with `schemaVersion: 1`. Reject repeated `original` or `file` values when
joining. This map locates retained bytes. It does not replace the original capture bindings, source
closure, physical file identity, raw logs, or their provenance checks.

```sh
python3 - "$E/raster-image-map.json" "$MAP_CHROMIUM" "$MAP_WEBKIT" <<'PY'
import json, pathlib, sys
images = [entry for file in sys.argv[2:] for entry in json.loads(pathlib.Path(file).read_text())['images']]
for key in ['original', 'file']:
    if len({entry[key] for entry in images}) != len(images):
        raise ValueError(f'Duplicate raster mapping {key}')
with pathlib.Path(sys.argv[1]).open('x') as output:
    json.dump(dict(schemaVersion=1, images=images), output, indent=2)
    output.write('\n')
PY
bun scripts/markdown/paired-raster.ts --root "$E" --promotion \
    --image-map "$E/raster-image-map.json" \
    --baseline-log "$CHROMIUM_BASELINE_LOG" --baseline-log "$WEBKIT_BASELINE_LOG" \
    --candidate-log "$CHROMIUM_CANDIDATE_LOG" --candidate-log "$WEBKIT_CANDIDATE_LOG" \
    --out "$E/paired-raster"
```

The reader verifies map coverage for all visual, calibration, and supplemental references before
comparison. It checks actual retained PNG hashes and rejects missing mappings, duplicate original
or retained identities, path escapes, and changed bytes. It retains map and log hashes without
rewriting the original log paths. The map adds no captures and changes no pixel tolerance.

The promotion selector requires exactly 128 Chromium and 32 critical WebKit states per engine,
with all 16 engine/profile calibrations. The full WebKit producer also captures 96 supplemental
states per engine. Their original identities remain in `omittedStates`, and `sourceLogs` retains
input-log hashes. These rows stay outside the exact 160-state denominator. Duplicate states,
missing states, flat images, content failures, unstable calibration above 0.1%, and unexplained
changed pixels remain failures. No content masking or tolerance relaxation is added. Review every
changed image with its original source, paired image, overlay, and assertions.

Feed the resulting original indexes and reconciliation manifests into the existing promotion
assembly. Keep all fourteen gates from [qualification](qualification.md). Tool tests and development
captures establish consumability only. They never establish final qualification.
