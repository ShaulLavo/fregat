import type { ThemedToken } from 'shiki/core'

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

export function previewTokenStyle(token: ThemedToken) {
  const fontStyle = token.fontStyle ?? 0
  return {
    color: token.color,
    fontStyle: fontStyle & 1 ? 'italic' : undefined,
    fontWeight: fontStyle & 2 ? 'bold' : undefined,
    textDecoration: fontStyle & 4 ? 'underline' : undefined,
  } satisfies {
    readonly color?: string
    readonly fontStyle?: 'italic'
    readonly fontWeight?: 'bold'
    readonly textDecoration?: 'underline'
  }
}
