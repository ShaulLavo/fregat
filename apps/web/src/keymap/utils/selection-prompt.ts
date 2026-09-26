import { markdownFence } from '@/lib/markdown-fence'

export type SelectedLines = {
  /** One-based, inclusive. */
  readonly startLine: number
  readonly endLine: number
  readonly text: string
}

/** Each selection quoted under its path and lines, the way a diff line comment reads. */
export function selectionPrompt(path: string, selections: readonly SelectedLines[]): string {
  return selections.map((selection) => selectionBlock(path, selection)).join('\n\n')
}

function selectionBlock(path: string, { endLine, startLine, text }: SelectedLines) {
  const lines = text.split('\n')
  const fence = markdownFence(lines)
  const where = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`

  return [
    `About \`${path}\`, ${where}:`,
    '',
    `${fence}${fenceLanguage(path)}`,
    ...lines,
    fence,
  ].join('\n')
}

function fenceLanguage(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}
