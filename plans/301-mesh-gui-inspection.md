# Plan 301: Capture host windows through approved Mesh devices

Status: APPROVED. Permission discovery comes first. Remote controls require [Plan 290's device authorization](290-mesh-device-authorization.md).

Implementation owner: [ShaulLavo/mesh](https://github.com/ShaulLavo/mesh). Reported in [Mesh #100](https://github.com/ShaulLavo/mesh/issues/100) and [Mesh #101](https://github.com/ShaulLavo/mesh/issues/101). #101's permission evidence is retained here with the broader workflow.

## Outcome

An owner-approved caller lists visible windows and captures a display or selected window on a Mesh host. The PNG returns to the caller's device. A blocked command names the missing permission and gives the exact one-time grant and retry instructions for the process that needs it.

## Evidence and current state

Both issues report the same Mac incident on macOS 26.4. `screencapture -x` failed to create an image, and System Events could not enumerate window names. Applications launched into the user's visible GUI session, so display sleep and the wrong login session were ruled out for that incident. The responsible-process explanation remains a hypothesis until the daemon's actual TCC ownership is inspected.

At Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, the CLI has terminal inspection and provider recovery doctor commands, but no GUI screenshot/window command. Start with `internal/cli/command.go`, `internal/protocol/control.go`, daemon control dispatch, platform service installation, and `internal/sshd/server.go`. Use a new small platform adapter for GUI work. Do not confuse terminal screen snapshots in `internal/terminal` with the macOS display.

The SSH front door already has a key boundary, while ordinary daemon control requires Plan 290. These commands expose on-screen user content. A tailnet connection alone does not authorize capture.

## Permission and command contract

Probe macOS Screen Recording and Accessibility separately. Enumerate the responsible process, GUI session, installed executable, and signature identity using public metadata. Check whether the launchd daemon can retain grants across a normal Mesh patch update. If it cannot, prove the need for a small signed GUI helper before adding one. Keep TCC attribution and permission prompts in that stable host-side process.

Provide `mesh gui doctor HOST --json` for session availability, responsible executable, permission states, and grant instructions. First explicit use may request the required local system permission once. Remote requests do not repeatedly open prompts. After a denial, say which process to add under System Settings > Privacy & Security > Screen Recording or Accessibility. Explain whether that process must restart and provide the corresponding retry command. Screenshots and window metadata may need different grants.

Add `mesh windows HOST --json` with window ID, app name, bundle ID where available, PID, title, frame, focused state, and minimized state. Mark unavailable fields honestly. Add `mesh screenshot HOST [--window SELECTOR] [-o FILE]`. Accept a stable window ID from `windows` and the requested app/title selection. Refuse ambiguous text matches and return the available IDs. Whole-display capture is the default. A window that disappears during capture gives an explicit result.

On macOS, use the supported native window/capture APIs after the permission probe settles the correct owner. On Linux/Hyprland, adapt `hyprctl clients -j` and `grim` through bounded process execution. Unsupported compositors, missing tools, a locked session, or no GUI session return a stated reason. Do not silently capture a different desktop or window. This work adds observation only.

Authorize each call with Plan 290's destination-approved owner device key and OS account. Mere tailnet admission is insufficient. Reuse the destination's owner key authorization instead of adding a parallel GUI permission database. OS Screen Recording and Accessibility remain separate required grants. Check authorization before enumeration or capture and after reconnect. Audit host ID, caller device ID, requested operation, selected display/window identifier, result, and time. Keep image bytes and titles out of the audit event.

Plan 290 grants complete command authority for that destination OS account. An approved caller can also invoke available GUI tools through ordinary commands. GUI RPC checks provide the same owner boundary and clear permission behavior. They do not create a sandbox inside that account.

Stream a bounded PNG over the existing authenticated transport using explicit metadata and validated chunks. Save it atomically to the caller-selected path. Refuse unintended overwrite, invalid dimensions, oversized results, and incomplete output. Clean only request-owned temporary files. Never retain captured images on the host by default.

## Execution checklist

- [ ] Reproduce the original failure with a known visible test window on a disposable macOS GUI session. Establish a known-good native capture first. Identify actual TCC responsibility, permission state, and restart needs without inspecting private screen content.
- [ ] Probe grant persistence through a normal patch update. Choose daemon ownership or a stable signed helper from the observed result. Record the chosen executable and supported one-time grant steps.
- [ ] Implement the platform capability/permission probe and `gui doctor`. Verify grants independently, denied access, no GUI session, and revoked permission. Keep permission prompts explicit and once per missing grant interaction.
- [ ] Add window enumeration with the listed fields. Reproduce a Fregat window's title from a remote device. Keep native permission failure distinct from an empty window list.
- [ ] Add selected-window and whole-display capture, validated PNG streaming, and atomic caller output. Test ambiguous selectors, disappeared windows, cancellation, and transfer failure without leaving a partial image.
- [ ] Add the Linux/Hyprland adapter and explicit unsupported cases. Keep platform dependencies optional and document installation through the owning OS/compositor mechanism.
- [ ] Wire destination-approved device authorization, reconnect denial, revocation, and bounded metadata audit. Prove an unauthorized caller receives neither window metadata nor image bytes.
- [ ] Exercise grant, capture, revoke, and retry on macOS and supported Linux. Inspect returned images on the caller side. Run Mesh gates, commit and push, pass CI, publish a patch release, and verify the installed GUI owner and remote commands.

## Acceptance and verification

From a different approved device, `mesh windows mac --json` lists a visible Fregat window with its title and stable selector. `mesh screenshot mac --window Fregat -o x.png` returns an intact image of that window. An ambiguous match reports IDs. Permission denial names the missing grant, exact responsible process, System Settings location, restart requirement, and retry command.

Portable tests cover protocol limits, authorization, selector resolution, JSON output, atomic file publication, cancellation, and platform adapter outcomes. Native GUI checks use a disposable test window and run only where the relevant OS session exists. Skip unsupported environments with a stated reason. Keep owner-fleet demonstrations as one-off evidence outside committed scripts.

Run affected package tests first, then `go mod tidy -diff`, `go vet ./...`, `go test -race ./...`, and `./scripts/verify.sh`. Check packaged signing/helper identity on macOS if a helper proves necessary. The final evidence includes permission-denied output, successful window metadata, a returned PNG read back, and revoked-caller denial.

Apply `how` to OS permission ownership, `principle-sequence-verifiable-units` to doctor, enumeration, and capture, and `unslop` to permission instructions. The first probe decides whether a helper earns its maintenance cost.
