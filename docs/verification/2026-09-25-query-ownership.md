# Query ownership and route preparation

Plan 135 is in progress on L6. Plans 091–095 and 128 precede this work. The installed Query core and React integration are 5.102.8. The implementation was checked against its `QueryClient.query` source and the official [prefetching guide](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching) and [Router external-data guide](https://tanstack.com/router/latest/docs/guide/external-data-loading).

## Imperative calls

P0 migrated 46 calls in 24 source/test files. The inventory contained fetch and prefetch calls, with no ensure or infinite variants. None of the option factories used by those callers supplies `select`. Required reads keep their failure behavior; optional warmups resolve void on success and failure. No cache data shape changed.

`scripts/lint/query-api.mjs` parses maintained source with the existing Oxc parser. It rejects deprecated member reads, including optional/computed calls and alias extraction/destructuring. Strings and comments remain valid. It failed against the prior source and passes after migration. Its seven cases pass, with 110 owner tests across 12 web files and a passing web typecheck. `query:check` runs in verify, gates and CI. The final rebase must rerun it.

## Browser resources and routes

Settings and terminal modules now share one browser-owned core QueryClient at preload and render. The environment client continues owning server reads. Resource inspection records `scope: resources`, a Browser resources label and a null server origin. It reports both loaded module keys after warmup.

| Resource              | Identity              | Freshness / retention | Failure                                     | Lifetime      |
| --------------------- | --------------------- | --------------------- | ------------------------------------------- | ------------- |
| Settings page module  | settings/page-module  | static / infinite     | Query error, intentional retry, page reload | Browser build |
| Terminal panel module | terminal/panel-module | static / infinite     | Query error, intentional retry, page reload | Browser build |

Both imports run with `networkMode: always` and no structural sharing. They remain dynamic imports. Three tests load the actual modules and prove shared preload/render acquisition, immediate successful first render after prewarming, and acquisition while offline.

Router receives the resource client explicitly. Local and remote settings loaders start the same query without awaiting it. They handle optional rejection and leave route validity, application activation and shared consumers independent of acquisition. Explicit preloads leave the current address unchanged; navigating away does not cancel another consumer's read. Global intent preloading remains disabled, and pre-root restored-view warmup remains in main.

The real-router and resource tests pass with the address/navigation suite: 330 cases in 33 files. Web and scripts typechecks pass. The browser cache dump is `/work/tmp/fregat-evidence/20260925T155912Z-caches-run`.

Cold loading passed at `/work/tmp/fregat-evidence/20260925T155644Z-scenario-settings-cold-load`; loading and loaded screenshots were read. Settings also opened from the workbench and chat rails at `/work/tmp/fregat-evidence/20260925T155854Z-scenario-sidebar-settings-button`. Both runs have no warning/error app logs. Browser diagnostics are retained with each run.

The cold-load trace pair is `/work/tmp/fregat-evidence/20260925T155659Z-trace-settings-cold-load` before the loader and `/work/tmp/fregat-evidence/20260925T155833Z-trace-settings-cold-load` after it. Duration was 2831.5 / 3033.8 ms; scripting 1121.3 / 1178.8 ms; layout 80.0 / 92.4 ms; tasks over 50 ms were 5 / 5. These gated-import traces establish no latency benefit. The loader prepares the query before destination application; the consumer still owns loading and error rendering.

Direct URL, command navigation and back/forward passed at `/work/tmp/fregat-evidence/20260925T160148Z-scenario-settings-route-preparation`. The first scenario draft reused a restored settings address, so it created no history entry; opening a file before the settings command makes the history check meaningful.

Failed-chunk recovery passed at `/work/tmp/fregat-evidence/20260925T160202Z-scenario-settings-module-failure`. After the request was allowed again, Retry retained the browser's failed-module result; Reload recovered the settings pane. Failure and recovered screenshots were read. The deliberately aborted module is the sole failed request/console error, with no warning/error app logs. Both module error panes offer Reload.

## Browser renderer and theme resources

Theme registrations, loaded editor themes, preview tokens/highlighter, Mermaid acquisition and Ghostty initialization now use the browser resource client. The preview hook and Mermaid hook read Query state. Selection and hover-preview state stay in the editor store; the provider retains the last successful visual theme while another is acquired.

| Resource            | Identity          | Freshness / retention | Failure / lifetime                                                 |
| ------------------- | ----------------- | --------------------- | ------------------------------------------------------------------ |
| Theme registration  | catalog id        | static / infinite     | Failed acquisition stays an error; next request retries            |
| Loaded editor theme | catalog id        | static / infinite     | Fallback is acquired under its own key                             |
| Preview tokens      | catalog id        | static / infinite     | No fallback cached as the requested preview                        |
| Preview highlighter | browser singleton | static / infinite     | Opaque browser-owned handle                                        |
| Mermaid renderer    | browser singleton | static / infinite     | Failed import remains an error; a later fence can retry            |
| Ghostty runtime     | browser singleton | static / infinite     | Failed initialization can retry; terminal/PTY lifetime is separate |

All use always-on local acquisition and no structural sharing. The current theme catalog imports immutable Shiki registrations from the build. There is no mutable registration API; the acquired content hash is derived once and used for worker identity. A future mutable registration source must include its revision in identity. Preview normalization copies mutable registration arrays before Shiki receives them.

The preview/commit/worker race failed against the old store with four registration reads, and passes with one shared read. The requested-theme failure test confirms its query retains an error with no fallback data, then retries to the requested theme. Existing theme-store, provider and preview-hook checks pass. Mermaid tests prove concurrent acquisition, retry after failure, and configuration ownership until each render settles. Rendering uses a serial mutation scope because Mermaid configuration is shared. Two real Chromium Mermaid fence tests pass. A Ghostty test joins two failed requests, retains the error, then joins two requests into one real WASM instance and reuses it afterward; the test disposes only its own instance.

`editor-theme-preview` passed at `/work/tmp/fregat-evidence/20260925T161030Z-scenario-editor-theme-preview`, with no warning/error app logs. Its repeated previews and cancel preserve settings.

The terminal mode-switch check passed at `/work/tmp/fregat-evidence/20260925T161253Z-scenario-terminal-background`, with the original canvas still connected and equal background layers. Its screenshot was read and it emitted no warning/error app logs. The scenario now uses the visible mode control; the prior palette-based run left the palette open over the destination. Web types and repository gates pass for P3. Bundle inspection follows the remaining resource migrations.
