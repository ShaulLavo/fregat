import { describe, expect, it } from 'vitest'
import { machineIdFrom, readOsMachineId } from '../machine-id'

describe('OS machine id lookup', () => {
  it('uses the absolute macOS ioreg path without reading files', () => {
    const commands: string[][] = []
    const files: string[] = []
    const uuid = '11111111-2222-3333-4444-555555555555'
    const result = readOsMachineId({
      platform: 'darwin',
      readFile: (file) => {
        files.push(file)
        return ''
      },
      run: (command) => {
        commands.push(command)
        return {
          stdout: new TextEncoder().encode(`"IOPlatformUUID" = "${uuid}"`),
          exitCode: 0,
        }
      },
    })
    expect(result).toBe(uuid)
    expect(commands).toEqual([['/usr/sbin/ioreg', '-rd1', '-c', 'IOPlatformExpertDevice']])
    expect(files).toEqual([])
  })

  it.each(['primary', 'missing', 'empty'] as const)(
    'reads absolute Linux machine-id files with a %s primary file',
    (primary) => {
      const files: string[] = []
      const commands: string[][] = []
      const result = readOsMachineId({
        platform: 'linux',
        readFile: (file) => {
          files.push(file)
          if (file === '/var/lib/dbus/machine-id') return 'fallback-id\n'
          if (primary === 'missing') throw { code: 'ENOENT' }
          return primary === 'empty' ? '\n' : 'primary-id\n'
        },
        run: (command) => {
          commands.push(command)
          return { stdout: new Uint8Array(), exitCode: 1 }
        },
      })
      expect(result).toBe(primary === 'primary' ? 'primary-id' : 'fallback-id')
      expect(files).toEqual(
        primary === 'primary'
          ? ['/etc/machine-id']
          : ['/etc/machine-id', '/var/lib/dbus/machine-id'],
      )
      expect(commands).toEqual([])
    },
  )
  it('persists and reuses a fallback machine id on wasm32 when OS files are absent', () => {
    const store = new Map<string, string>()
    const provider = {
      platform: 'linux' as const,
      arch: 'wasm32',
      fallbackFile: () => '/virtual/state/machine-id',
      readFile: (file: string) => {
        const value = store.get(file)
        if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return value
      },
      writeFileExclusive: (file: string, value: string) => {
        if (store.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
        store.set(file, value)
      },
      run: () => ({ stdout: new Uint8Array(), exitCode: 1 }),
    }
    const first = readOsMachineId(provider)
    const second = readOsMachineId(provider)
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(second).toBe(first)
    expect(machineIdFrom(first)).toMatch(/^[0-9a-f]{32}$/)
  })

  it('still fails on native linux when OS machine-id files are absent', () => {
    expect(() =>
      readOsMachineId({
        platform: 'linux',
        arch: 'x64',
        readFile: () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
        run: () => ({ stdout: new Uint8Array(), exitCode: 1 }),
      }),
    ).toThrow(expect.objectContaining({ code: 'system.MACHINE_ID_UNAVAILABLE' }))
  })
})

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
