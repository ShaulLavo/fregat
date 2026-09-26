import * as v from 'valibot'
import { terminalContextSchema } from '@workspace/client-core/chat/terminal-context'
import { test, expect } from '../../../test/fixtures'

test('saved terminal context clamps line bounds and normalizes captured text', () => {
  expect(
    v.parse(terminalContextSchema, {
      source: ' shell ',
      text: '\r\n  output\r\n',
      lineStart: -3.8,
      lineEnd: -8.2,
    }),
  ).toEqual({ source: 'shell', text: '  output', lineStart: 1, lineEnd: 1 })
  expect(
    v.safeParse(terminalContextSchema, { source: 'shell', text: '   ', lineStart: 1, lineEnd: 2 })
      .success,
  ).toBe(false)
})
