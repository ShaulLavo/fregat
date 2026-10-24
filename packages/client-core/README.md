# @workspace/client-core

Client logic that the web app and the terminal client share: the server transport, environment connections, the command catalog, history and optimistic state. It has no UI. Private to this repository.

```sh
bun run --cwd packages/client-core test
```

Import from the path you need, for example `@workspace/client-core/transport/client`. The package has no barrel entry.
