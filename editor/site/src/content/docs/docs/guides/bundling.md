# Bundling and workers

Serve the editor with its stylesheets and worker assets. You need an ESM-capable bundler and a browser page.

## 1. Start with the browser entry point

Import `@singapore-editor/core/editor` and `@singapore-editor/core/style.css` in code that runs after client-side mount. Give the container a height and use a column flex layout. In server-rendered React applications, place the integration in a client component.

## 2. Add assets for each plugin

The packages create module workers with URLs relative to their modules. Keep the package's built files available to the bundler. Tree-sitter also needs its runtime WebAssembly and grammar files; the bundled languages package supplies grammar URLs.

Use Vite's production build as the first integration to test. Other bundlers must preserve or rewrite `new URL(..., import.meta.url)` worker and asset references. Next.js, webpack and unbundled ESM have no universal setup shown here; check their emitted assets before shipping.

## 3. Check the production path

Open the built application under its real base path. In the network panel, verify that worker scripts and `.wasm` assets return successful responses. A development server's fallback HTML can hide a missing asset.

## 4. Check your Content Security Policy

Permit the actual worker origins in `worker-src`. WebAssembly compilation may require `wasm-unsafe-eval` in `script-src`, depending on the browser and policy. Restrict `connect-src` to the language-server endpoint when using WebSocket LSP.

Tree-sitter can use `SharedArrayBuffer` for cancellation on cross-origin-isolated pages. Cross-origin isolation is optional. Check that the worker still starts without it before adding COOP and COEP headers, which also affect cross-origin assets.

## Result

The core edits text immediately. Parsing, tokenization and language-service work arrive asynchronously after their workers load.

## If it doesn't work

### A worker response is HTML

Check the asset URL and your server's fallback route. Return the worker script at that URL.

### WebAssembly loading fails

Verify the grammar response and its MIME type. Check the console for CSP failures and the network panel for base-path mistakes.

### The page throws during server rendering

Mount the editor in the browser lifecycle. Framework adapters own the editor after their component mounts.

Continue with [languages and tree-sitter](languages.md) or [language servers](lsp.md).
