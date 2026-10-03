# Plan 297: Make the installed Mesh executable clear and reliable

Status: APPROVED.

Implementation owner: [ShaulLavo/mesh](https://github.com/ShaulLavo/mesh). Reported in [Mesh #79](https://github.com/ShaulLavo/mesh/issues/79).

## Outcome

Installation reports the exact executable it owns and explains when `mesh` resolves to another installation or is absent from the current shell. Remote automation invokes the intended installed executable without depending on shell startup files.

## Evidence and starting points

#79 confirms two shell contexts. Non-interactive Pi SSH omitted `~/.local/bin`, while the explicit installed path worked. The Mac login shell resolved an older Homebrew cask before the current per-user binary. A non-login Mac shell resolved neither. Installer ownership of shell configuration was left unconfirmed.

At Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, `scripts/install.sh` selects `${MESH_BIN_DIR:-$HOME/.local/bin}` and prints its installed path. Bootstrap scripts use the per-user path, and `internal/bootstrap/install.go` probes that absolute executable. `internal/updateinstall/ownership.go` refuses package-managed payload replacement. Preserve this ownership boundary. The dirty historical Mesh checkout contains separate installer edits. Rebase or inspect those changes without overwriting another session's work.

Use [T26's installation ownership](https://github.com/ShaulLavo/mesh/blob/main/docs/tasks/T26-mesh-updates.md) and the existing installer fixture infrastructure in `scripts/install/install_test.go`.

## Chosen contract

Mesh owns the executable selected by its installer and the service that invokes that path. The shell and package manager own their configuration and payloads. Installation detects shadowing and gives shell-specific instructions. It does not silently remove a Homebrew cask or edit global PATH.

Compare the installed executable with the command resolved in the shell that ran the installer. Report both paths and public version/build identity when they differ. A missing command gets a copyable absolute invocation and guidance for the user's shell. Explain that login, interactive, and non-interactive SSH shells can have different PATH values. Do not claim an installer can infer every future shell's resolution.

Bootstrap, update recovery, and verification use the canonical installed path or the installation journal's owned executable. Avoid new environment knobs and a package-manager migration framework. Preserve valid custom installer destinations.

## Execution checklist

- [ ] Repeat the reported lookup in clean temporary Linux and zsh shell fixtures. Establish known-good resolution first. Check fresh shells with a missing path, a competing older executable, and a matching executable.
- [ ] Trace every bootstrap and recovery command that launches Mesh by name. Resolve installed ownership from existing installer results or journal state. Replace only demonstrated ambiguous invocations with the owned absolute path.
- [ ] Add a bounded post-install diagnostic to the standalone installer. Show installed path/version and resolved path/version for shadowing. Keep install result markers parseable and put advisory text on the diagnostic channel where automation expects structured results.
- [ ] Add corresponding bootstrap handoff guidance when the remote shell cannot invoke the installed binary by name. Never invoke the stale package-owned payload to update the Mesh-owned daemon.
- [ ] Document copyable per-user shell setup and explicit SSH invocations for supported shells. Explain how to resolve a Homebrew conflict through its owner. Keep these instructions on the remote user's device and shell.
- [ ] Verify paths containing spaces through the supported Go/bootstrap interfaces. Respect the standalone shell installer's existing path constraints. Confirm reinstallation does not duplicate guidance edits or replace package-managed binaries.
- [ ] Run focused installer/bootstrap tests, packaging checks, and required Mesh checks. Commit, push, pass CI, publish a patch release, and verify fresh login and non-interactive shells against the installed release.

## Acceptance and verification

Use temporary homes, fixture executables with distinct versions, and controlled PATH values. Test real shell resolution where the shell exists. Skip a platform-specific case with a stated reason where its shell or service manager is absent. Do not hard-code the owner's hosts, usernames, or directories in committed tests.

Run `go test -race ./scripts/install ./internal/bootstrap ./internal/updateinstall` for affected code, `scripts/check-packaging.sh` for installer packaging, and Mesh's required `go mod tidy -diff`, `go vet ./...`, `go test -race ./...`, and `./scripts/verify.sh` before delivery. Capture a one-off read-only installed-host proof outside the repository.

A fresh supported install either resolves to the installed version in its supported shell or names the required action and exact installed invocation. Shadowed installations show both identities. Remote automation succeeds with PATH excluding `~/.local/bin`. The existing Homebrew payload and user shell files remain under their owners' control.

Apply `how` to installation ownership and `unslop` to diagnostic copy. Keep the change bounded to reliable invocation and actionable guidance.
