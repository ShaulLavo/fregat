import { settingsMutationRequestSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { requestRejection } from '../request-rejection'

const BASE = { mutationId: '11111111-1111-4111-8111-111111111111', target: 'user' }

function reject(body: unknown) {
  const parsed = v.safeParse(settingsMutationRequestSchema, body)
  if (parsed.success) throw new Error('expected the request to be rejected')

  const error = requestRejection(body, parsed.issues)
  return { code: error.code, message: error.message }
}

function write(operations: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return { ...BASE, ...overrides, operations }
}

describe('settings request rejection', () => {
  it('names a key the registry does not know, rather than the union mismatch', () => {
    expect(reject(write([{ kind: 'set', key: 'workbench.gone', value: true }]))).toEqual({
      code: 'settings.UNKNOWN_KEY',
      message: 'Unknown setting: workbench.gone',
    })
  })

  it('names an unregistered key inside a reset', () => {
    expect(reject(write([{ kind: 'reset', keys: ['workbench.gone'] }])).code).toBe(
      'settings.UNKNOWN_KEY',
    )
  })

  it('reports the failing constraint of a registered setting', () => {
    expect(reject(write([{ kind: 'set', key: 'editor.fontSize', value: 'big' }]))).toEqual({
      code: 'settings.WRITE_INVALID',
      message: 'Cannot set editor.fontSize: value: Invalid type: Expected number, received string',
    })
    expect(reject(write([{ kind: 'set', key: 'editor.fontSize', value: 9000 }])).message).toContain(
      'Expected <=72',
    )
  })

  // The store holds tokens, paths and machine names; a rejected value must not
  // land in the log line the rejection writes.
  it('never repeats the rejected value', () => {
    const secret = 'SETTING_VALUE_MUST_NOT_BE_LOGGED'
    const { message } = reject(write([{ kind: 'set', key: 'editor.fontSize', value: secret }]))
    expect(message).not.toContain(secret)
  })

  it('distinguishes a setting that is not written with `set`', () => {
    expect(reject(write([{ kind: 'set', key: 'keybindings.overrides', value: {} }])).message).toBe(
      'Cannot set keybindings.overrides: this setting changes only through its own operation kind',
    )
  })

  it('names an unknown operation kind', () => {
    expect(reject(write([{ kind: 'nonsense' }])).message).toBe(
      'Cannot set operations.0: unknown operation kind "nonsense"',
    )
    expect(reject(write([{ key: 'editor.fontSize' }])).message).toBe(
      'Cannot set operations.0: operation has no `kind`',
    )
  })

  it('checks a non-`set` operation against its own branch only', () => {
    expect(
      reject(write([{ kind: 'keybinding.set', command: '', keys: ['ctrl+k'] }])).message,
    ).toMatch(/^Cannot set operations\.0: command: Invalid length/)
  })

  it('reports a failure outside the operations array at its own path', () => {
    expect(
      reject(write([{ kind: 'set', key: 'editor.fontSize', value: 14 }], { target: 'galaxy' })),
    ).toEqual({
      code: 'settings.WRITE_INVALID',
      message: 'Cannot set target: Invalid type: Expected ("user" | "workspace"), received string',
    })
    expect(reject({ ...BASE, operations: [] }).message).toBe(
      'Cannot set operations: Invalid length: Expected >=1, received array',
    )
  })

  it('points at the operation that failed, not the first one', () => {
    const message = reject(
      write([
        { kind: 'set', key: 'editor.fontSize', value: 14 },
        { kind: 'set', key: 'editor.tabSize', value: 'x' },
      ]),
    ).message
    expect(message).toContain('editor.tabSize')
  })
})
