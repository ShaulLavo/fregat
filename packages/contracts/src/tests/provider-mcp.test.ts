import { expect, test } from 'vitest'
import * as v from 'valibot'
import { providerMcpSignInSchema } from '../provider'

test.each([
  'javascript:alert(1)',
  'data:text/html,hello',
  'file:///tmp/auth',
  'custom://login',
  '/auth',
])('rejects an MCP authorization URL with an unsafe scheme: %s', (authorizationUrl) => {
  expect(v.safeParse(providerMcpSignInSchema, { authorizationUrl }).success).toBe(false)
})

test.each(['https://auth.example.test/login?state=123', 'http://localhost:7890/login'])(
  'accepts a browser sign-in URL: %s',
  (authorizationUrl) => {
    expect(v.parse(providerMcpSignInSchema, { authorizationUrl })).toEqual({ authorizationUrl })
  },
)
