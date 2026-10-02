import { describe, expect, it } from 'vitest'
import { machineIdFrom } from '../machine-id'

describe('machine id', () => {
  it('hashes the OS id so the raw value never leaves the machine', () => {
    const id = machineIdFrom('4f2b0c1d9e8a7b6c5d4e3f2a1b0c9d8e')
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(id).not.toContain('4f2b0c1d')
    expect(machineIdFrom('4f2b0c1d9e8a7b6c5d4e3f2a1b0c9d8e\n')).toBe(id)
  })

  it('gives different machines different ids', () => {
    expect(machineIdFrom('a')).not.toBe(machineIdFrom('b'))
  })
})
