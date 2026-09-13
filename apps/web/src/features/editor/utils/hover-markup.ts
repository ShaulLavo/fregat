/**
 * Only the part of `textDocument/hover` we read. Declared here rather than pulled from
 * `vscode-languageserver-protocol`: that is a dependency of `@singapore-editor/lsp-plugin`, not of this
 * app, and taking one on to name two fields is the worse trade.
 */
export type HoverResponse = {
  readonly contents: HoverContents | readonly HoverContents[]
}

type HoverContents = string | { readonly value: string }

/**
 * The shapes `Hover.contents` is allowed to take, flattened to the text a tooltip shows.
 *
 * All three are in the protocol and servers pick freely between them, so getting this wrong does
 * not fail loudly — it renders `[object Object]`, or renders nothing and looks like a server that
 * had no answer.
 */
export function hoverMarkup(hover: HoverResponse | null): string | null {
  if (!hover) return null

  const { contents } = hover
  const text = Array.isArray(contents)
    ? contents.map(markedText).join('\n\n')
    : markedText(contents as HoverContents)

  return text.trim() || null
}

function markedText(value: HoverContents): string {
  return typeof value === 'string' ? value : value.value
}
