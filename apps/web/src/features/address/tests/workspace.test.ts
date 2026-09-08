import { formatAddress, emptyAddress, parseAddress } from '@workspace/client-core/address/grammar'
import {
  NO_WORKSPACE_TOKEN,
  parseWorkspaceToken,
  workspaceToken,
} from '@workspace/client-core/address/workspace'
import { expect, test } from '../../../../test/fixtures'
import { testWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { workspaceAddressSchema } from '@workspace/contracts'
import * as v from 'valibot'

test('names a workspace by its readable name and stable identity without its path', () => {
  const address = testWorkspaceAddress('private/checkouts/platform')
  const token = workspaceToken(address)

  expect(token).toBe(`platform.${address.id}`)
  expect(token).not.toContain('private')
  expect(parseWorkspaceToken(token)).toEqual({ kind: 'workspace', id: address.id })
})

test('the readable name cannot select a different workspace', () => {
  const address = testWorkspaceAddress('projects/platform')

  expect(parseWorkspaceToken(workspaceToken({ ...address, name: 'anything.else' }))).toEqual({
    kind: 'workspace',
    id: address.id,
  })
})

test('two checkouts with the same name carry independent identities', () => {
  const first = testWorkspaceAddress('projects/platform')
  const second = testWorkspaceAddress('forks/platform')

  expect(first.name).toBe(second.name)
  expect(workspaceToken(first)).not.toBe(workspaceToken(second))
  expect(parseWorkspaceToken(workspaceToken(first))).toEqual({ kind: 'workspace', id: first.id })
  expect(parseWorkspaceToken(workspaceToken(second))).toEqual({ kind: 'workspace', id: second.id })
})

test('the configured filesystem root and a folder named dash remain addressable', () => {
  for (const path of ['', 'projects/-']) {
    const address = testWorkspaceAddress(path)
    expect(workspaceToken(address)).not.toBe(NO_WORKSPACE_TOKEN)
    expect(parseWorkspaceToken(workspaceToken(address))).toEqual({
      kind: 'workspace',
      id: address.id,
    })
  }
  expect(parseWorkspaceToken(NO_WORKSPACE_TOKEN)).toEqual({ kind: 'none' })
})

test('a dotted Unicode name and structural separators survive the whole address', () => {
  const address = testWorkspaceAddress('projects/a~b.ünïcödé')
  const token = workspaceToken(address)
  const href = formatAddress({ ...emptyAddress(), workspace: token })

  expect(href).toContain('a%7Eb.')
  expect(parseAddress(href).workspace).toBe(token)
  expect(parseWorkspaceToken(parseAddress(href).workspace ?? '')).toEqual({
    kind: 'workspace',
    id: address.id,
  })
})

test('rejects missing identities and malformed tokens without a basename fallback', () => {
  const address = testWorkspaceAddress('platform')
  for (const token of ['', 'platform', address.id, `.${address.id}`, 'platform.not-an-id']) {
    expect(parseWorkspaceToken(token), token).toEqual({ kind: 'invalid' })
  }
})

test('preserves the full 16-character Nano ID alphabet and case through the URL', () => {
  const address = v.parse(workspaceAddressSchema, {
    id: 'aB3_cD4-eF5_gH6-',
    name: 'platform',
    path: 'projects/platform',
  })
  const token = workspaceToken(address)
  const href = formatAddress({ ...emptyAddress(), workspace: token })

  expect(href).toBe('/~platform.aB3_cD4-eF5_gH6-')
  expect(parseWorkspaceToken(parseAddress(href).workspace ?? '')).toEqual({
    kind: 'workspace',
    id: address.id,
  })
})

test.each([
  'a'.repeat(15),
  'a'.repeat(17),
  `${'a'.repeat(15)}+`,
  `${'a'.repeat(15)}/`,
  `${'a'.repeat(15)}é`,
  `${'a'.repeat(15)} `,
  `${'a'.repeat(16)}\n`,
  '00000000-0000-4000-8000-000000000001',
])('rejects a workspace ID outside the exact Nano ID format: %j', (id) => {
  expect(parseWorkspaceToken(`platform.${id}`)).toEqual({ kind: 'invalid' })
})
