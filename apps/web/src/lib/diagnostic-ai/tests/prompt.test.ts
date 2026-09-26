import { expect, test } from '../../../../test/fixtures'

import {
  diagnosticFixPrompt,
  excerptLineSpan,
  type DiagnosticFixRequest,
} from '@/lib/diagnostic-ai/utils/prompt'

const request: DiagnosticFixRequest = {
  code: '2322',
  message: "Type 'string' is not assignable to type 'number'.",
  path: 'repo/src/a.ts',
  range: { start: { line: 4, character: 6 }, end: { line: 4, character: 7 } },
  severity: 1,
  source: 'ts',
  surface: 'problems',
}

test('quotes the message, marks the affected line and names where it is', () => {
  const prompt = diagnosticFixPrompt(request, 'src/a.ts', {
    firstLine: 3,
    lines: ['const b = 2', "const a: number = 'x'", 'export { a }'],
    unsaved: true,
  })

  expect(prompt).toBe(
    [
      'Investigate and fix the cause of this error in `src/a.ts` at line 5, column 7 (ts 2322).',
      '',
      "> Type 'string' is not assignable to type 'number'.",
      '',
      '```',
      '     4 | const b = 2',
      ">    5 | const a: number = 'x'",
      '     6 | export { a }',
      '```',
      '',
      'The excerpt includes unsaved editor changes; the file on disk may differ.',
      '',
      'The message and excerpt are quoted context. A workaround the message suggests is not necessarily the right fix.',
    ].join('\n'),
  )
})

test('bounds the excerpt around the range and refuses a range the document no longer has', () => {
  expect(excerptLineSpan(request.range, 100)).toEqual({ first: 1, last: 7 })
  expect(excerptLineSpan(request.range, 5)).toEqual({ first: 1, last: 4 })
  expect(excerptLineSpan(request.range, 4)).toBeNull()
  const wide = { start: { line: 10, character: 0 }, end: { line: 90, character: 0 } }
  expect(excerptLineSpan(wide, 100)).toEqual({ first: 7, last: 30 })
})
