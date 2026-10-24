# appearance

## theme colors

Pass `theme` when constructing an editor, or call `editor.setTheme(theme)` to update it in place.
Themes work with `new Editor(element)` and `setText(text)` without a document session.

```ts
editor.setTheme({
  type: 'dark',
  backgroundColor: '#1e1e1e',
  foregroundColor: '#d4d4d4',
  gutterBackgroundColor: '#252526',
  caretColor: '#ffffff',
  selectionColor: '#264f78',
  inactiveSelectionColor: '#3a3d41',
  popupBackgroundColor: '#252526',
})
```

`selectionColor` paints focused selections; `inactiveSelectionColor` paints them after blur.
`popupBackgroundColor` is the background of hover, completion and rename popups. `syntax` maps
token kinds (`keyword`, `string`, `comment`, …) to colors.

Plugins can register more colors with `registerEditorColor` from `@singapore-editor/core/rendering`.
Set those through `theme.colors`, keyed by the registered id. The [diff theme](../../diff/docs/theme.md)
lists the colors it registers.

## gutter inset

`gutterLeadingInset` puts empty pixels at the gutter's leading edge, before the first lane: room
between a screen edge and the line numbers. The lanes keep their widths and move right; the text
starts after the widened gutter. Row decorations and diff tints paint the gutter row, so they cover
the inset and a tinted row runs from the pane's edge to its text. With `cursorLineHighlight`
`gutterBackground: true`, the cursor line's gutter band covers it too.

```ts
const editor = new Editor(container, { gutterLeadingInset: 12 })
editor.setGutterLeadingInset(0) // back to a flush gutter
```

It defaults to 0, and at 0 the gutter is unchanged. An editor with no gutter lanes ignores it.
