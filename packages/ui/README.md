# @workspace/ui

React components, styles and shared UI patterns for the web app. Components stay free of application imports. Patterns in `src/patterns/` compose theme tokens and components into rows, list interaction, virtualization and pane shells. Private to this repository.

```sh
bun run --cwd packages/ui test
bun run --cwd packages/ui test:browser
bun run --cwd packages/ui tables:check   # class tables are generated
```

[Shared patterns](../../docs/pattern-layer.md) and the [design language](../../docs/web-design-language.md) describe the rules.
