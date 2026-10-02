# mac

Native macOS client. Second frontend beside `apps/web` — the web app stays for cross-platform; the Bun server stays the brain. Editor-first: see `plans/native-plan-of-plans.md` for the doctrine, the gate, and the plan queue.

## Toolchain

Requires full Xcode 26+ (Command Line Tools alone cannot build this — no AppKit-capable `xcodebuild`, stale Swift). After installing from the App Store:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && xcodebuild -runFirstLaunch
```

## Commands

All from `apps/mac`:

```bash
swift build                       # compile everything
swift test                        # EditorCore tests (swift-testing)
swift run -c release EditorBench  # the gate table — release, or the numbers are noise
swift run MacApp                  # stub window (no .app bundle yet, deliberately)
```

`EditorBench` prints the web editor's baselines with an empty native column; each plan
fills the rows it owns. Methodology, provenance tiers and the `os_signpost` → `xctrace`
recipe are in `docs/native-bench-harness.md`. To check the keystroke instrument itself:

```bash
xcrun xctrace record --template "Logging" --output /tmp/sig.trace \
  --launch -- "$(swift build -c release --show-bin-path)/EditorBench" --signpost-demo=60
```

(`--output` must come before `--launch`; anything after `--launch --` goes to the target.)

Not part of the bun/turbo workspace: no `package.json` here, on purpose.
