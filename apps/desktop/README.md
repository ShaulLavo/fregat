# desktop

The Bun launcher that opens Fregat in its own window. It selects a native WebKit window on macOS and prefers an installed Chrome app on Linux, then connects that window to the machine server. Native system-webview hosts live in `native/`: Zig and WebKitGTK on Linux, Swift with AppKit and WKWebView on macOS.

```sh
bun run desktop:dev                       # from the repository root
bun run --cwd apps/desktop build:native   # build the host for this OS
bun run app:mac                           # build Fregat.app on macOS
```

`bun run dev` already starts this launcher beside the web app and the server. Building the Linux host needs Zig 0.17, `pkg-config` and the WebKitGTK 4.1 headers. Building the macOS host needs Swift 6.

[Development](../../docs/development.md#desktop-app) covers window selection and the installed-app behavior. [ADR 003](../../docs/adr/003-one-server-per-machine-shared-by-clients.md) explains why the window never owns the server.
