/**
 * The docs palette is a set of `--sg-*` CSS variables (`manual.css`). The editor resolves these roles when capturing and painting live documents.
 */
export const SYNTAX_COLORS = {
  attribute: 'prop',
  bracket: 'punct',
  comment: 'com',
  constant: 'num',
  function: 'fn',
  keyword: 'kw',
  // Markdown headings paint with this id (`text.title`), so it carries the heading colour.
  keywordDeclaration: 'title',
  keywordImport: 'kw',
  namespace: 'type',
  number: 'num',
  property: 'prop',
  string: 'str',
  textEmphasis: 'type',
  textStrong: 'num',
  type: 'type',
  typeDefinition: 'type',
  typeParameter: 'type',
  variable: 'fg',
  variableBuiltin: 'fg',
} as const

export type SyntaxColorId = keyof typeof SYNTAX_COLORS
