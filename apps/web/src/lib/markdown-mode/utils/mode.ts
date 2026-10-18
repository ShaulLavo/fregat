export type MarkdownView = 'preview' | 'source' | 'rendered'

const ORDER: readonly MarkdownView[] = ['preview', 'source', 'rendered']

export function nextMarkdownView(view: MarkdownView): MarkdownView {
  return ORDER[(ORDER.indexOf(view) + 1) % ORDER.length]!
}

export function isMarkdownPath(path: string) {
  return /\.(?:md|markdown|mdx)$/iu.test(path)
}
