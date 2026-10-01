# diff colors

back to the [readme](../README.md)

pass an `EditorTheme` to each diff editor. base colors use the same fields as a plain editor: `backgroundColor`, `foregroundColor` and `gutterBackgroundColor`. rows and gutter inherit them, and `editor.setTheme(theme)` updates them without remounting.

```ts
editor.setTheme({
  type: 'light',
  backgroundColor: '#ffffff',
  foregroundColor: '#18181b',
  gutterBackgroundColor: '#f4f4f5',
  colors: { 'diff.added.bg': '#dcfce7' },
})
```

`createDiffPlugin` registers these `EditorTheme.colors` ids. defaults follow the theme's `type`, and explicit colors override them. a light theme should also supply its base colors.

- `diff.added`, `diff.deleted`: added and deleted gutter numbers and indicators
- `diff.modified`: input to the default hunk background mix
- `diff.added.bg`, `diff.deleted.bg`: changed rows and their gutter rows
- `diff.hunk.bg`, `diff.hunk.foreground`: hunk separators and their gutter rows
- `diff.placeholder.bg`: empty cells on one side of a split diff
- `diff.muted`: the empty diff message
- `diff.border`, `diff.split.handle`: host diff borders and split handles
