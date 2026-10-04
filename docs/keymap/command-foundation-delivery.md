# Command foundation delivery

Status: DELIVERED 2026-10-04. Source, independent verification, merge, installation and live inspection are complete.

[PR #603](https://github.com/ShaulLavo/fregat/pull/603) delivers
[204](../../plans/204-editor-on-fregat-hotkeys.md),
[205](../../plans/205-ghostty-on-fregat-hotkeys.md) and
[206](../../plans/206-platform-one-keymap.md), with exact standalone qualification under
[207](../../plans/207-one-repo-with-mirrors.md). All 21 PR checks succeeded before the squash
merge `8d4694a20e79fada7acc2b0e97e0fe80762480c5`. The final reviewed source is
`6da512054154358ed6e9e0681884bf38ddd91f85`.

## Delivered command ownership

One window `BrowserDispatcher` captures before Lexical. Editors publish their focus node and
run host commands with the original event. Standalone editors use exported base bindings and
packs. Web and TUI consumers, ordered override settings, preset projections, keybinding rows
and the shadow report use the shared library. Replaced runtimes and capture listeners are gone.

Main-host terminals attach hotkeys through the finite `connectInput` owner. A finite claim
stops forwarding; a pass reaches a published interested general input callback, then native
encoding once. Hotkeys attachment does not construct the general manager. Physical event
identity, IME, composition, mapped press/release, live modes, teardown and deferred attachment
controls pass. Generated commands and native replies retain their bypass. Chromium, Firefox
and WebKit cover the finite attachment and focus contracts.

Peer worker/general-extension/native programs remain independently owned. The join preserves
worker Promise capability rejection, worker copy/selection/link authority, native OSC, Canvas
and published input/event/frame callbacks. Main-only hotkeys attachment rejects actual worker
terminals truthfully before acquiring a lease. This delivery makes no worker-hotkeys activation
claim and does not change the historical failed general-manager X6 result.

The reviewed browser scenarios cover Markdown sidebar ownership, Editor history, focus-canceled
chords, shell input exactly once with either layer, settings override/reset settlement and
Markdown authoring. Screenshots and query-cache evidence were read. Source/tooling findings
were fixed and independently reviewed before the final green CI.

## Exact standalone families

The final qualified family trees are:

| Family  | Git tree                                   | Qualification                                                                                   |
| ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Editor  | `17f46c906f6da648093e0531902bc1996f7b52e4` | Cold install/build/types/lint/format, health, Turbo inputs and actual packed runtime            |
| Ghostty | `187aea095f87da866ec4e85b86918ed7bd62d4f7` | Fresh 0.3.12 cold checks, installed helpers, WebGPU/WebGL2/Canvas2D and actual packed consumers |
| Hotkeys | `743498aef969da2d01fadf17315dffab5848ea81` | Exact-tree cold and packed core/React proof carried from its qualified checkpoint               |

Root's local catalog is numeric 0.0.3, matching the source workspace package. The two
independent consumer catalogs use the same
[immutable hosted 0.0.2 artifact](https://github.com/ShaulLavo/fregat/releases/download/hotkeys-0.0.2-68d8aaf6f631-260650623e7e/fregat-hotkeys-0.0.2-68d8aaf6f631-260650623e7e.tgz).
Its SHA256 is `260650623e7e78d4533cbed8ea4f50882dba4873125d49af43ce294ec977f470`.
All 41 installed core files match after every check; exported source remains unchanged.
Ghostty's packed consumer passes TypeScript 7 Bundler, TypeScript 5 Bundler and Node10,
browser imports, removed-subpath rejection, WASM and Canvas presentation. npm account setup,
initial publication and trusted publishing remain deferred.

## Registered large-file comparison

Pair 03 uses the frozen 20,000-line baseline and genuinely changed candidate
`7a610cf2d3852166f827e1306fbd31b31ed2bf9e`. All 280 inputs, including five newlines, retain
every owning task. Exact typed text and original-document restoration pass with 106 Undo
actions in each arm.

| Metric, all 280 inputs            |  Baseline | Candidate |
| --------------------------------- | --------: | --------: |
| Processing p95                    |  5.145 ms |  4.567 ms |
| Processing maximum                | 10.143 ms |  6.565 ms |
| Reported-browser presentation p95 | 64.946 ms | 64.629 ms |

The registered processing p95 comparison and candidate maximum ≤8.3 ms pass. Presentation
p95 passes; its p50 increases from 53.429 to 54.792 ms and maximum increases from 66.619 to
66.787 ms. These are reported-browser endpoints. Physical photon time and minimap publication
completion were not measured.

Valid pair 02 remains a failed maximum result. Its 11.871 ms outlier hit automatic capped
minimap publication inline inside the physical edit chain. The reviewed fix adds existing
`defer: true` only to asynchronous derived minimap publication. Explicit flush, latest document,
ordered edits and the non-restarting 300 ms deadline remain covered. Necessary editing,
selection, caret, accessibility and rendering work remains in the metric. Pair 03 ran after this
source correction, with no outlier filtering, criterion padding or replay.

The final source carries pair 03 through exact protected production closure. All 7,827 checked
runtime/app/Editor/Hotkeys/agent files and 105 freshly built Ghostty JavaScript/WASM files match
the qualified candidate. Later differences are accepted test/workflow fixes and preserved peer
benchmark/test metadata, including Ghostty 0.3.12. No new measurement was run for those changes.

## Installation preflight correction

[PR #655](https://github.com/ShaulLavo/fregat/pull/655) merged as
`fa40610d9c4fdf865c6e3d4a1684d45d75cbdd67` after independent review and green CI.
It fixes the installer rejecting a healthy Mesh proxy when the canonical host label differs
from the configured alias. The preflight matches the exact configured published URL, route,
proxy kind and target port. Only the optional base-path trailing slash is normalized.

Twenty-three targeted controls pass, including wrong-origin, route, port, kind, query, fragment
and missing-URL rejection. A read-only real route observation passes the corrected check and
returns HTTP 200 from the existing release endpoint. This proof preceded the new installation;
it does not assert that the command foundation was already served. Owner route configuration
and settings remain unchanged. Application, family and agent source remain exact PR #603.

## Served release

The coordinator ran the approved `bun run install-release --server --restart --interrupt`
installation from clean main.
The installer exited 0 and serves release `20261004T102110Z-fa40610d-main-c24b3184`.
Both web and server report commit
[`fa40610d9c4fdf865c6e3d4a1684d45d75cbdd67`](https://github.com/ShaulLavo/fregat/commit/fa40610d9c4fdf865c6e3d4a1684d45d75cbdd67),
with zero dirty files, phase `serving` and no pending release. The required live check passed
at `2026-10-04T10:21:50.104Z`.

The additional read-only `look` found the app ready, health OK and no problems. Its screenshot
was read. The production log window contains no warnings or errors. The retained live-check
receipt preserves a canceled log-upload request alongside its passing verdict.

The persistent terminal host PID 4133 was retained intentionally with its prior build, under
[114](../../plans/114-installed-app.md)'s shared-terminal lifetime contract. Web and server
release identity is recorded separately. No account setup or publishing action was performed.

The configured endpoint and exact owner URL are recorded in the local `deployed-release.json`
and `live-check.json` receipts. This delivery record requires no particular host name.

## Retained evidence

The command-foundation execution report contains these durable records:

- `shipping-resume/deployed-release.json`, exact served web/server identity and live verdict.
- `shipping-resume/deployment-run3.log` and `live-check.json`, actual successful installation and required browser check.
- `shipping-resume/live-ui-evidence/page.png` and `live-log-window.json`, inspected production UI and warning/error window.
- `shipping-resume/standalone207-6da512054154-combined-receipt.json`, final family proof and exact carry.
- `shipping-resume/final-metadata-709-receipt.json`, preserved peer source, version and protected closure.
- `shipping-resume/command206-hardware-processing-pair-03/final-receipt.json`, registered source/window/clock/input evidence and unfiltered raw rows.
- `shipping-resume/command206-hardware-processing-pair-02/`, immutable valid failed pair.
- `shipping-resume/pair02-offline-diagnosis/`, causal source evidence and the reviewed minimap fix.

These are retained delivery artifacts. The public merge and source commit identify the exact
repository code; the local report roots contain the raw traces, logs, screenshots and payload
hash inventories. Independent program gates and deferred account actions keep their own plans.
