import type { EditorToken, EditorTokenStyle } from '@singapore-editor/core/syntax'

export const CODE_THEME_PREVIEW_SAMPLE = [
  '// Format a project for the sidebar.',
  'type Project = { name: string; stars: number };',
  '',
  'export function formatProject(project: Project) {',
  '  const { name, stars } = project;',
  '  return `${name} has ${stars} stars`;',
  '}',
  '',
  'formatProject({ name: "Platform", stars: 128 });',
].join('\n')

export type PreviewSegment = {
  readonly start: number
  readonly text: string
  readonly style: EditorTokenStyle | null
}

/** The sample split into lines of styled runs; text no token covers keeps the theme foreground. */
export function previewLines(
  text: string,
  tokens: readonly Readonly<EditorToken>[],
): readonly (readonly PreviewSegment[])[] {
  const lines: PreviewSegment[][] = [[]]
  let offset = 0
  const push = (end: number, style: EditorTokenStyle | null) => {
    while (offset < end) {
      const newline = text.indexOf('\n', offset)
      const stop = newline === -1 || newline >= end ? end : newline
      if (stop > offset)
        lines.at(-1)!.push({ start: offset, text: text.slice(offset, stop), style })
      if (stop === newline) lines.push([])
      offset = stop === newline ? stop + 1 : stop
    }
  }
  for (const token of tokens) {
    if (token.start > offset) push(token.start, null)
    if (token.end > offset) push(token.end, token.style)
  }
  push(text.length, null)
  return lines
}
