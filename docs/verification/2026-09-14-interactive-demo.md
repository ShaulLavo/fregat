# Interactive website demo

The landing hero runs the real web application over an isolated simulated backend. The garden image remains the user-selected asset already used by the site.

## Architecture and ownership

- Grounded the application bootstrap, address history, HTTP client, filesystem streams, orchestration RPC, terminal sockets, appearance and asset loading.
- Compared browser interception with injecting a backend port. Interception preserves the existing clients and covers direct fetches and sockets without replacing the application provider tree. A port would require transport changes across HTTP, Eden subscriptions, orchestration, assets and logging.
- Chosen design: start MSW before importing the real application; keep files, Git and sessions in a shared in-memory model. Use memory history and isolated storage for reload-to-reset behavior.
- Blocking first steps: agree on startup API, seed workspace and demo build location before implementation.
- Independent workstreams: backend state/protocols, entry/build packaging, landing presentation, browser verification.
- Shared mutable state: one backend owner defines the workspace model. Transport handlers share it; build and presentation have separate file ownership. Root serializes commits.
- Smallest safe decomposition: backend owner coordinates implementation; terminal transport and site/build integration have bounded delegates. Root reviews and verifies.

## Evidence

Before, published screenshot hero, headed Chromium: `/work/tmp/fregat-evidence/20260914T153526Z-look-fregat-1440x1000/`. Read `page.png`; the screenshot loads and the browser reports no problems.

The `demo-workspace` scenario edits/saves a file through the actual editor, searches it and reads it from the terminal. Service-worker responses and backend request diagnostics are retained with the screenshots.

## Browser findings and corrections

- `/work/tmp/fregat-evidence/20260914T154422Z-scenario-demo-workspace/` exposed an invalid workspace token and an unhandled boot-wallpaper request. The seed now uses the real `workspaceToken` formatter and the mock serves the boot image.
- `/work/tmp/fregat-evidence/20260914T155017Z-scenario-demo-workspace/` passed editor save, search and terminal readback. Read `03-searched.png` and `04-terminal.png`: both contain the newly saved marker. The save returned 200, diagnostics had no unhandled requests, and the browser opened no native sockets. Its only console error was the missing favicon, fixed in the demo HTML.
- `/work/tmp/fregat-evidence/20260914T155243Z-scenario-demo-agent-git/` passed staging and committing, then exposed a malformed provider envelope that crashed chat. The mock now validates `{ providers }` with the shared result schema. `02-committed.png` shows a clean working tree.
- `/work/tmp/fregat-evidence/20260914T155554Z-scenario-demo-reset/` passed edit/save/reset through the embedded app. Read `03-reset.png`; the seed returned. Removed the duplicate fullscreen attribute reported by Chromium.
- `/work/tmp/fregat-evidence/20260914T160312Z-look-fregat-1440x1200/` and `/work/tmp/fregat-evidence/20260914T160312Z-look-fregat-390x844/` show the aligned wallpaper and ready iframe at desktop and mobile sizes. Read both `page.png` files. Neither run reports browser problems or horizontal overflow.

Chat submission now passes at `/work/tmp/fregat-evidence/20260914T160932Z-scenario-demo-agent-git/`. Read `05-agent-reply.png`. It exposed and helped verify the real Send-button fix recorded separately in `2026-09-14-chat-send.md`. Native backend sockets, unhandled requests and error-level client logs are all absent.

The loading/social image now matches the interactive scene. It is a headed Chromium capture from `/work/tmp/fregat-evidence/20260914T161135Z-look-fregat-1440x1200/selector.png`, exported as lossless WebP at 3555×2196. Decoded pixels match exactly.

Clean CI dependencies were built independently. The old Editor revision still published the previous package names; the shared setup pin now uses pushed revision `b0bd4b6`. Ghostty remains at `94ab02a`. Logs: `/work/tmp/fregat-ci-editor-build.log` and `/work/tmp/fregat-ci-ghostty-build.log`. The required merge-conflict implementation is committed and pushed with that dependency. Nine demo backend tests, targeted lint and the design census pass in the isolated Platform checkout. Final publishing evidence follows below.

## Final committed-source verification

The feature is committed as `62db0266`, with all root workspace typechecks passing in the pre-commit hook against the exact pinned dependencies. Log: `/work/tmp/fregat-demo-commit.log`. The independent site build passed at `/work/tmp/fregat-demo-final-build.log`. GitHub Pages build and deployment passed: https://github.com/ShaulLavo/fregat/actions/runs/34868505493.

Final headed Chromium runs on that artifact:

- `/work/tmp/fregat-evidence/20260914T162546Z-scenario-demo-workspace/`: save, search and terminal readback; read `03-searched.png` and `04-terminal.png`.
- `/work/tmp/fregat-evidence/20260914T162613Z-scenario-demo-agent-git/`: stage, commit and chat; read `05-agent-reply.png`.
- `/work/tmp/fregat-evidence/20260914T162637Z-scenario-demo-reset/`: reset restored seed content but `03-reset.png` exposed premature readiness while the wallpaper and terminal were loading.
- `/work/tmp/fregat-evidence/20260914T162843Z-scenario-demo-reset/`: same drive after requiring the loaded wallpaper, loaded fonts and completed terminal initialization. Read `03-reset.png`; the restored app has its wallpaper and terminal output before the page reports ready.

All these runs report no browser problems, unhandled mock requests or warning/error client log events.

Mesh web deployment is `/work/platform-production/releases/20260914T162625Z-62db0266-interactive-demo-workspace/`. It includes the current workspace's existing Git UI changes and reuses the running server. The live check passed. Headed doctor evidence: `/work/tmp/fregat-evidence/20260914T162659Z-look-platform-1440x1000/`; read `page.png`.
