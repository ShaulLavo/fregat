# Server rendering and hydration

Use this rule only for an SSR application. Platform's client-only workbench does not need
SSR machinery to use route loaders.

Create a QueryClient per server request. A module-global server client can share one user's
data with another request. The browser owns a stable client for its application lifetime.

```tsx
const queryClient = new QueryClient()
await queryClient.query(postQueries.list())
const state = dehydrate(queryClient)
```

This is a required read: rejection propagates to the request owner. For an optional warmup,
handle rejection explicitly before dehydration; do not accidentally turn all server failures
into success. See [imperative queries](imperative-queries.md).

Use the framework's supported Query hydration integration or `HydrationBoundary`. Share
query options with browser consumers, including a deliberate freshness window. Use the
framework's safe serialization path for inline payloads. Failed queries are excluded by
default; changing that requires an explicit error/serialization policy. Never dehydrate
opaque browser resources, native handles, or secrets.

For TanStack Start/Router, verify the installed integration and current official docs before
adding hydration callbacks. A route loader that fills the cache is only the loading part;
it does not itself implement request scoping, serialization, hydration, or streaming.

[Server rendering guide](https://tanstack.com/query/latest/docs/framework/react/guides/ssr)
