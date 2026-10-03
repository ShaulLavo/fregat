---
name: react-development
description: Write and review Fregat React code with its state ownership, selectors, effect, and React Compiler rules. Use for components, hooks, providers, stores consumed by React, and compiler diagnostics.
---

# Fregat React development

Apply these repository rules when writing, reviewing, or refactoring React components, hooks, stores, or compiler-dependent code. Paths below are relative to the repository root.

## React

- One component per file, one hook per file; pure helpers go to `utils/`.
- A module variable filled from an effect so non-React code can reach it is a last resort, for DOM nodes, live sockets and held component state. Anything else is read where it lives or pushed by its non-React owner.
- No prop-drilling of app commands or setters: a prop that is only forwarded, or a command crossing more than two components, gets a narrow provider/hook. Providers expose small domain actions (`selectTab`), not state blobs.
- State that outlives a component is a zustand store (web and TUI): `createStore` from `zustand/vanilla` when non-React code reads or writes it, read in React with `useStore(store, selector)`. A module `let` plus a listener set is a store; write it as one. A service with its own lifecycle keeps its state in a zustand store it exposes (`connections.store`), and components select from that.
- Selectors return a primitive, a reference the store holds, or go through `useShallow`. A derived object needs a selector memoized on its inputs (`projectedTreeModel`); a `getSnapshot` that builds a fresh object or array each read re-renders forever.
- `useSyncExternalStore` is for sources zustand does not own: DOM and renderer events (`matchMedia`, held keys, geometry), mutable objects that publish a revision (an editor buffer), live sockets, and services with their own lifecycle. A zustand store is read with `useStore`, never through `useSyncExternalStore`. Convert a hand-built store only when the result is less code or measurably fewer renders.
- The React Compiler memoizes the app. Do not add `memo`, `useMemo` or `useCallback` by hand, except where identity is load-bearing: a value in a dependency array, a value passed to a hook (store selector, `useSyncExternalStore` pair), or a ref callback. The compiler's cache may recompute; those keep their manual memo with a comment naming the dependent hook.
- Read what the compiler did; do not infer it. `bun run compiler:explain <file> [--component Name]` prints memo blocks as `[keys] → value`. `bun run compiler:memos [paths…]` classifies each manual memo: `redundant` (delete), `needed`, or `differs` (a missing key is a stale-value bug). Rows are not independent: remove memos one at a time.
- Removing `useMemo<T>(…)` drops its contextual type; write `const value: T = …`.
- `exhaustive-deps` misreads compiler-memoized values. Use `useEffectEvent` when the dep is the action. When the effect truly keys on the value, suppress with `// oxlint-disable-next-line react/exhaustive-deps` and the compiler's keys; the `react-hooks/…` spelling makes the compiler refuse the component.
- `bun run compiler:census` fails on any refused component not excused in `scripts/lint/react-compiler-allow.json`. Repairs: lazily filled ref → lazy `useState`; `try`/`finally` → module-scope function; suppressed deps → `useEffectEvent` with the trigger as an argument; declare handlers after those they call; pass `ref` through JSX, not `createElement`.
