# @workspace/observability

Structured logging and telemetry configuration for every Fregat process, built on evlog. It reads the observability environment, sanitizes fields before they are logged and sets log retention. Private to this repository.

```sh
bun run --cwd packages/observability test
bun run logs --since 5m      # read this checkout's logs from the repository root
```

[Admission and retention](../../docs/observability-overhead.md) describes what the server records and keeps.
