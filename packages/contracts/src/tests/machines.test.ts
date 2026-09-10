import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import { machinesSchema } from '../machines'
import { descriptorFor } from '../settings/keys'
import {
  applySettingsOperations,
  settingsMutationResourcesIntersect,
  settingsOperationResourceKeys,
  settingsOperationSchema,
} from '../settings/mutations'

describe('machines', () => {
  it('accepts an SSH address without a repository or installation path', () => {
    const machine = { kind: 'ssh', target: 'user@devbox' }
    expect(v.parse(machinesSchema, { remote: machine })).toEqual({ remote: machine })
  })
  it.each([
    'https://pc.mesh.example/platform',
    'http://127.0.0.1:3002',
    'http://localhost:3002',
    'http://[::1]:3002',
  ])('accepts %s', (url) => {
    expect(v.safeParse(machinesSchema, { remote: { kind: 'origin', url } }).success).toBe(true)
  })

  it.each(['http://10.0.0.5:3001', 'http://127.attacker.example', 'ftp://localhost:3002'])(
    'refuses %s with the real reason',
    (url) => {
      const result = v.safeParse(machinesSchema, { remote: { kind: 'origin', url } })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.issues[0].message).toBe(
        'plain http off loopback is refused; use an SSH machine or https',
      )
    },
  )

  it.each([
    { remote: { kind: 'origin', url: 'https://user:secret@example.com' } },
    { remote: { kind: 'ssh', target: '-oProxyCommand=sh' } },
    { remote: { kind: 'ssh', target: 'host;command' } },
    { remote: { kind: 'ssh', target: 'host', remotePort: 65_536 } },
    { 'Upper Case': { kind: 'ssh', target: 'host' } },
  ])('rejects unsafe machine input', (input) => {
    expect(v.safeParse(machinesSchema, input).success).toBe(false)
  })

  it('registers machines only in the user file with a dedicated control', () => {
    expect(descriptorFor('environments.machines')).toMatchObject({
      default: {},
      merge: 'record',
      scope: 'machine',
      widget: 'machines',
    })
  })

  it('reserves local for the implicit primary machine at both settings boundaries', () => {
    const machine = { kind: 'origin', url: 'http://localhost:3002' }
    expect(v.safeParse(machinesSchema, { local: machine }).success).toBe(false)
    expect(
      v.safeParse(settingsOperationSchema, { kind: 'machine.set', name: 'local', machine }).success,
    ).toBe(false)
  })

  it('edits one machine without replacing another concurrent edit', () => {
    const first = {
      kind: 'machine.set',
      name: 'first',
      machine: { kind: 'ssh', target: 'first' },
    } as const
    const second = {
      kind: 'machine.set',
      name: 'second',
      machine: { kind: 'origin', url: 'http://localhost:3002' },
    } as const
    const result = applySettingsOperations({}, [first, second])
    expect(result.raw['environments.machines']).toEqual({
      first: first.machine,
      second: second.machine,
    })
    const removed = applySettingsOperations(result.raw, [{ kind: 'machine.remove', name: 'first' }])
    expect(removed.raw['environments.machines']).toEqual({ second: second.machine })
    expect(
      settingsMutationResourcesIntersect(
        settingsOperationResourceKeys(first)[0]!,
        settingsOperationResourceKeys(second)[0]!,
      ),
    ).toBe(false)
    expect(removed.touchedSettingIds).toEqual(['environments.machines'])
  })
})
