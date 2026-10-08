/**
 * The docs index in reading order. Pages written as `.md` open in the editor; `.mdx` pages are
 * still rendered by Starlight. Labels are short forms of the page titles.
 */
export const SECTIONS = [
  {
    label: 'Start here',
    pages: [
      ['start-here/introduction', 'Introduction'],
      ['start-here/quick-start', 'Quick start'],
      ['start-here/monaco', 'Coming from Monaco'],
      ['start-here/codemirror', 'Coming from CodeMirror'],
      ['start-here/playground', 'TypeScript playground'],
    ],
  },
  {
    label: 'Guides',
    pages: [
      ['guides/bundling', 'Bundling and workers'],
      ['guides/documents', 'Documents and sessions'],
      ['guides/themes', 'Themes'],
      ['guides/languages', 'Languages and tree-sitter'],
      ['guides/lsp', 'Language servers'],
      ['guides/frameworks', 'React and Solid'],
      ['guides/decorations', 'Decorations'],
      ['guides/large-files', 'Large files'],
      ['guides/plugins', 'Plugins'],
    ],
  },
  {
    label: 'Concepts',
    pages: [
      ['concepts/architecture', 'Architecture'],
      ['concepts/versions', 'Versions'],
      ['concepts/anchors', 'Anchors'],
      ['concepts/workers', 'Workers'],
      ['concepts/highlighting', 'Highlighting'],
      ['concepts/performance', 'Performance'],
    ],
  },
  {
    label: 'Reference',
    pages: [['reference/packages', 'Packages']],
  },
] as const satisfies readonly {
  readonly label: string
  readonly pages: readonly (readonly [string, string])[]
}[]
