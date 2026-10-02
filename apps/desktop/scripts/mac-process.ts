import { runMacCommand } from '../src/launcher/mac-browser'

export function macProcessAlive(pid: number) {
  return Boolean(runMacCommand(['/bin/ps', '-p', String(pid), '-o', 'pid='])?.trim())
}
