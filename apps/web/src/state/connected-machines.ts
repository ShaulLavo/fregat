import { globalChromeStorage } from '@/lib/environments/state/scoped-storage'

const KEY = 'platform.environments.connected.v1'

export function readConnectedMachines(): readonly string[] {
  try {
    const names: unknown = JSON.parse(globalChromeStorage.getItem(KEY) ?? '[]')
    return Array.isArray(names)
      ? names.filter((name): name is string => typeof name === 'string')
      : []
  } catch {
    return []
  }
}

export function writeConnectedMachines(names: ReadonlySet<string>) {
  globalChromeStorage.setItem(KEY, JSON.stringify([...names]))
}
