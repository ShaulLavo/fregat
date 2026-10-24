import { expect, test } from 'vitest'

import { stripDisplayedPlanMarkdown } from '../proposed-plan'

function codeUnits(value: string) {
  return Array.from({ length: value.length }, (_, index) => value.charCodeAt(index))
}

test.each([
  { name: 'LF', separator: '\n' },
  { name: 'CRLF', separator: '\r\n' },
  { name: 'CR', separator: '\r' },
])('removes the title and blank prefix with $name separators', ({ separator }) => {
  const body = `first${separator}second${separator}third`

  expect(stripDisplayedPlanMarkdown(`# Title${separator}${separator}${body}`)).toBe(body)
})

test.each([
  { name: 'LF', separator: '\n' },
  { name: 'CRLF', separator: '\r\n' },
  { name: 'CR', separator: '\r' },
])('removes a summary and surrounding blank lines with $name separators', ({ separator }) => {
  const body = `first${separator}${separator}second`
  const source = `# Title${separator} \t${separator}## Summary${separator}${separator}${body}`

  expect(stripDisplayedPlanMarkdown(source)).toBe(body)
})

test.each([
  { name: 'unheaded', prefix: '' },
  { name: 'headed', prefix: '# Title\r\n\r' },
  { name: 'summary', prefix: '# Title\n\r## Summary\r\n\t\r' },
])('preserves mixed separators and exact UTF16 units in the $name suffix', ({ prefix }) => {
  const body = 'first \r\n\ud800\r\n\r\udc00\n😀\r\nlast'
  const result = stripDisplayedPlanMarkdown(`${prefix}${body}\r\n \t`)

  expect(result).toBe(body)
  expect(result.length).toBe(body.length)
  expect(codeUnits(result)).toEqual(codeUnits(body))
})

test.each([
  { source: '', expected: '' },
  { source: '\r\n \t\r\n', expected: '' },
  { source: '# Title', expected: '' },
  { source: '# Title\r\rbody', expected: 'body' },
  { source: 'body\r\rnext', expected: 'body\r\rnext' },
  { source: '\n \t\nbody', expected: 'body' },
  { source: '\r\n \t\rbody', expected: 'body' },
  { source: 'body  \nnext \t\n', expected: 'body  \nnext' },
  { source: 'body\r\n\rnext\r\n\u00a0', expected: 'body\r\n\rnext' },
  { source: '# Title\n\n  body', expected: '  body' },
  { source: '   ###### Title\nbody', expected: 'body' },
  { source: '    # Title\nbody', expected: '    # Title\nbody' },
  { source: '####### Title\nbody', expected: '####### Title\nbody' },
  { source: '#Title\nbody', expected: '#Title\nbody' },
  { source: '#\nbody', expected: '#\nbody' },
  { source: '# \nbody', expected: 'body' },
  { source: '\n# Title\nbody', expected: '# Title\nbody' },
  { source: '\n## Summary\n\nbody', expected: 'body' },
  { source: '# Title\n### sUmMaRy \n\nbody', expected: 'body' },
  { source: '# Title\n    ## Summary\nbody', expected: '    ## Summary\nbody' },
  { source: '# Title\n## Summary ###\nbody', expected: '## Summary ###\nbody' },
  { source: '# Title\n## Details\nbody', expected: '## Details\nbody' },
  { source: '# Title\n## Summary\n## Summary\nbody', expected: '## Summary\nbody' },
  { source: '# Title\nbody\n## Summary', expected: 'body\n## Summary' },
  { source: '# Title\n## Summary\n\t\n', expected: '' },
])('keeps the display policy for $source', ({ source, expected }) => {
  expect(stripDisplayedPlanMarkdown(source)).toBe(expected)
})
