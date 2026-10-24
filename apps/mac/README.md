# mac

Scaffold and benchmarks for a planned native macOS client. `MacApp` opens a stub window. The shipped Fregat desktop app uses the WebKit host in [`apps/desktop`](../desktop/). The [native editor core design](../../docs/native-editor-core-design.md) records the architecture.

## Requirements

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
recipe are in [native-bench-harness.md](../../docs/native-bench-harness.md). To check the keystroke instrument itself:

```bash
xcrun xctrace record --template "Logging" --output /tmp/sig.trace \
  --launch -- "$(swift build -c release --show-bin-path)/EditorBench" --signpost-demo=60
```

(`--output` must come before `--launch`; anything after `--launch --` goes to the target.)

Not part of the bun/turbo workspace: no `package.json` here, on purpose.
