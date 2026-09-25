import { expect, test } from 'vitest'
import { rpcErrorPayload } from '../rpc-error'

const inner = { code: 'NOT_FOUND', message: 'gone' }
const listed = [{ error: inner }]

test.each([
  { name: 'an Eden envelope', input: { value: { error: inner } }, expected: inner },
  { name: 'a body without the error wrapper', input: { value: inner }, expected: inner },
  { name: 'a bare error envelope', input: { error: inner }, expected: inner },
  { name: 'a bare coded object', input: inner, expected: inner },
  { name: 'a string body', input: { value: 'oops' }, expected: 'oops' },
  { name: 'an array body', input: listed, expected: listed },
  { name: 'a string', input: 'oops', expected: 'oops' },
])('peels $name', ({ input, expected }) => {
  expect(rpcErrorPayload(input)).toBe(expected)
})
