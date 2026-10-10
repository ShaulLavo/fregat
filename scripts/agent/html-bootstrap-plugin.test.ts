import { expect, test } from 'vitest'
import { developmentDocumentOrigin } from '../../apps/web/scripts/html-bootstrap-plugin'

test('development document origin follows direct transport and trusted proxy metadata', () => {
  expect(developmentDocumentOrigin({ host: 'localhost:5173' }, false)).toBe('http://localhost:5173')
  expect(developmentDocumentOrigin({ host: 'localhost:5173' }, true)).toBe('https://localhost:5173')
  expect(
    developmentDocumentOrigin(
      {
        host: 'localhost:5173',
        'x-forwarded-host': 'app.example.test',
        'x-forwarded-proto': 'https',
      },
      false,
    ),
  ).toBe('https://app.example.test')
})

test.each([
  { 'x-forwarded-host': 'app.example.test' },
  { 'x-forwarded-proto': 'https' },
  { 'x-forwarded-host': 'user:password@app.example.test', 'x-forwarded-proto': 'https' },
  { 'x-forwarded-host': 'app.example.test/path', 'x-forwarded-proto': 'https' },
  { 'x-forwarded-host': 'app.example.test,another.test', 'x-forwarded-proto': 'https' },
])('development document rejects malformed proxy metadata %j', (headers) => {
  expect(() => developmentDocumentOrigin(headers, false)).toThrow()
})
