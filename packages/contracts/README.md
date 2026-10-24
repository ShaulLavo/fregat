# @workspace/contracts

Shared types, runtime schemas and the settings registry. The server, the web app, the terminal client and the desktop launcher import it, so a change to a route or a command fails the build in every consumer. Private to this repository.

The settings registry is `src/settings/keys.ts`. Every user-facing setting is an entry there, and [`docs/settings-reference.md`](../../docs/settings-reference.md) is generated from it:

```sh
bun run settings:reference         # regenerate after changing the registry
bun run --cwd packages/contracts test
```
