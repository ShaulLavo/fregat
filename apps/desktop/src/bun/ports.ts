import net from 'node:net'
import { commandOutput, processName } from './processes'
import { desktopErrors } from './structured-errors'

/** A held port is the user's to resolve: the desktop only stops processes it leased. */
export async function requireFreePort(host: string, port: number, label: string) {
  if (!(await canConnect(host, port))) return

  const holders = await portHolders(port)
  throw desktopErrors.PORT_IN_USE({ label, host, port, holders })
}

/** Diagnostics for the conflict message only; never a reason to signal anything. */
async function portHolders(port: number) {
  const pids = await listenerPids(port).catch(() => [])
  return Promise.all(
    pids.map(async (pid) => ({ pid, name: await processName(pid).catch(() => '') })),
  )
}

async function listenerPids(port: number) {
  const output = await commandOutput(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('p'))
    .map((line) => Number(line.slice(1)))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function canConnect(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (available: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(available)
    }

    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(500, () => done(false))
  })
}
