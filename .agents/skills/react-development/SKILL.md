---
name: react-development
description: Write and review Fregat React code with its state ownership, selectors, effect, and React Compiler rules. Use for components, hooks, providers, stores consumed by React, and compiler diagnostics.
---

# Fregat React development

Apply these repository rules when writing, reviewing, or refactoring React components, hooks, stores, or compiler-dependent code. Paths below are relative to the repository root.

## React

- One component per file, one hook per file; pure helpers go to `utils/`.
- A module variable filled from an effect so non-React code can reach it is a last resort, for DOM nodes, live sockets and held component state. Anything else is read where it lives or pushed by its non-React owner.
- No prop-drilling of app commands or setters: a prop that is only forwarded, or a command crossing more than two components, gets a narrow provider/hook. Command providers expose small domain actions (`selectTab`).
- State that outlives a component is a zustand store (web and TUI): `createStore` from `zustand/vanilla` when non-React code reads or writes it, read in React with `useStore(store, selector)`. A module `let` plus a listener set is a store; write it as one. A service with its own lifecycle keeps its state in a zustand store it exposes (`connections.store`), and components select from that.
- Prefer `Array.from(iterable, mapper)` when conversion and mapping are both needed. Keep a snapshot if mapping can mutate or reenter the iterable.
- Sort or reverse owned arrays in place when their original order is no longer needed. Use `toSorted` / `toReversed` for borrowed ordinary arrays over copying then calling `sort` / `reverse`. Compiler-cached models and selector/query results remain borrowed.
- Combine arrays with `concat`; use fresh `map`/`filter`/`flatMap` results directly. Follow root `AGENTS.md` for ownership, readonly inputs, iterable/typed-array conversion, tuple and sparse-array semantics. Removing a copy must preserve the input before mutation.
- Selectors return a primitive, a reference the store holds, or go through `useShallow`. A derived object needs a selector memoized on its inputs (`projectedTreeModel`); a `getSnapshot` that builds a fresh object or array each read re-renders forever.
- Stable object identity does not make a mutable getter reactive. Read the needed value or revision through its owner's query, selector, or subscription before deriving JSX; the compiler cannot observe changes hidden behind `row.getIsSelected()` or another service method.
- `useSyncExternalStore` is for sources zustand does not own: DOM and renderer events (`matchMedia`, held keys, geometry), mutable objects that publish a revision (an editor buffer), live sockets, and services with their own lifecycle. A zustand store is read with `useStore`, never through `useSyncExternalStore`. Convert a hand-built store only when the result is less code or measurably fewer renders.
- The React Compiler memoizes the app. Do not add `memo`, `useMemo` or `useCallback` by hand, except for predictable reuse at an identity-sensitive consumer: a value in a dependency array, a value passed to a hook (store selector, `useSyncExternalStore` pair), or a ref callback. A kept manual memo names the dependent hook in a comment.
- Both compiler caches and native `useMemo`/`useCallback` are disposable optimizations. Correctness must survive recomputation and effect cleanup/reconnection. Give mutable owners such as stores, coordinators, and resources a real lifetime through lazy `useState`, a ref used outside render, or their owning service. Define which input change replaces them; an empty dependency list is not a lifetime guarantee.
- Import built-in hooks directly from `react`. A third-party re-export can preserve runtime function identity while losing compiler recognition. Before adopting strict hook signatures or a `Stable<T>` brand, inspect compiled output and identify the exact API contract it protects; compiler-inferred memoization does not produce a TypeScript brand.
- Read what the compiler did; do not infer it. `bun run compiler:explain <file> [--component Name]` prints memo blocks as `[keys] → value`. `bun run compiler:memos [paths…]` compares each manual memo with a compiled variant that removes only that memo: `redundant`, `needed`, `differs`, or `review` when a caller can depend on its identity. Different key lists need inspection of the callback's reads: the compiler can merge scopes. `--undecided` keeps review cases and key differences; `--json` includes status, comparison, and manual-only/compiler-only keys. Rows are not independent: remove memos one at a time.
- `bun run compiler:memos:check` fails only on redundant local memos with matching compiler keys. It runs in commit gates, `verify`, and CI. Returned values, component props, and values without an isolated compiler cache need review; a selector captured by a hook or passed through options/aliases stays `needed`. The tool reports differences, and never changes source automatically.
- Reviewed decisions live in `scripts/lint/react-memo-reviewed.json`. Record `file`, `component`, `name`, and `signature` from `compiler:memos --json --all` with a concrete `reason`. Matching reviews are hidden and exempt from the check; `--all` shows them. The signature ignores formatting and comments, and includes the memo's code, compiler keys, and classification, so changed memos return to the review queue.
- Removing `useMemo<T>(…)` drops its contextual type; write `const value: T = …`.
- `exhaustive-deps` misreads compiler-memoized values. Use `useEffectEvent` when the dep is the action. When the effect truly keys on the value, suppress with `// oxlint-disable-next-line react/exhaustive-deps` and the compiler's keys; the `react-hooks/…` spelling makes the compiler refuse the component.
- `bun run compiler:census` fails on any refused component not excused in `scripts/lint/react-compiler-allow.json`. Repairs: lazily filled ref → lazy `useState`; `try`/`finally` → module-scope function; suppressed deps → `useEffectEvent` with the trigger as an argument; declare handlers after those they call; pass `ref` through JSX, not `createElement`.

## Compiler-sensitive tests

- Name web regressions `*.compiler.test.tsx` when they depend on memoization, mutable-owner snapshots, or owner replacement. The compiler project uses the production OXC transform and runs once in normal tests and CI. The ordinary Happy DOM project uses the SSR consumer, which omits compilation despite the React plugin's `compiler: true` option.
- To qualify an existing DOM test before migrating it, run `bun --bun vitest run --config vitest.compiler.config.ts <test-file> -t '<case>'` from `apps/web`. Keep the file filter narrow and use the shared fixtures. See [Web test fixtures](../../../apps/web/test/README.md).

## Composition

- Reusable UI starts with props and children. Add named slots or compound pieces when flags and layout-specific props accumulate. Add a provider when descendants share domain actions or multiple real sources fill the same view contract. Each step needs a current use case; a provider is not required just to render fixture data in a test.
- Keep source ownership separate from layout: Query owns reads and mutations, a feature provider may expose the relevant data and domain actions, and the reusable UI composes shared primitives. Follow existing names and feature boundaries rather than adding a naming layer for this pattern.

Source: [Props, Composers, and Providers](https://backstage.orus.eu/react-composition-patterns-at-orus/).

## Context and render cost

- Keep component-owned UI state in `useState` or `useReducer`; share it through a narrow context when descendants need it. Choose a store for ownership outside React, a longer lifetime, or a measured bottleneck.
- A changed context value notifies every consumer. The compiler can still reuse calculations and JSX whose inputs stayed equal. Consumer execution, subtree rendering, and DOM work are different costs.
- Derive the smallest value the view uses, such as `checked = context.value === value`. Extract the action used by a callback so it closes over `onSelect` and `value`; passing or capturing the entire context object can invalidate cached work on unrelated updates.
- Inspect the consumer's output with `bun run compiler:explain <file> --component Name` before adding a selector abstraction, splitting a component for memoization, or moving React-owned state into a store. When a measured context bottleneck remains, split contexts by independent update patterns or use a store selector.
- Render counts locate repeated work. A speed claim needs `trace --compare` from the verification skill on the same user path, alongside render evidence. Check production behavior before generalizing a compiler benchmark; development and StrictMode counts alone do not establish user cost.
- External-store mutations are synchronous and cannot become non-blocking React Transitions. Keep this tradeoff in view when moving React-owned state into a store; existing external state still belongs with its owner.

Sources: [Making React Context Cheap with React Compiler](https://jjenzz.com/making-react-context-cheap/), [React Compiler memoization](https://react.dev/learn/react-compiler/introduction#what-kind-of-memoization-does-react-compiler-add), [context updates](https://react.dev/reference/react/useContext#caveats), [external-store caveats](https://react.dev/reference/react/useSyncExternalStore#caveats).
