# diagnostic actions

`getDiagnosticActions({ documentUri, textVersion, diagnostic })` returns buttons shown beside each diagnostic note in the hover. the server, server-set and adapter plugins all take it, and so does `createTypeScriptLspPlugin`

```ts
createLanguageServerPlugin({
  webSocketRoute: 'ws://localhost:3001/lsp',
  getDiagnosticActions: ({ diagnostic }) => [
    { label: 'Ask for a fix', run: () => askForFix(diagnostic) },
  ],
})
```

return an empty array when no action applies. each action has a `label` and `run(): void | Promise<void>`

while an action runs, the tooltip blocks a second click and keeps keyboard focus. a rejected action shows its message beside its button. progressive hover replies keep pending actions and their errors

an action refuses to run after its document, text version or diagnostic changes. the user reopens the hover to get a fresh one

the host owns what the action does and any async state around it
