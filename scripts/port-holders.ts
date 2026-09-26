import net from 'node:net'
import { scriptErrors } from './structured-errors'

export type PortHolder = { pid: number; name: string }

/** A port counts as held when it accepts a connection, whoever bound it and on which address. */
function portAccepts(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (accepted: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(accepted)
    }

    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(500, () => done(false))
  })
}

/**
 * A held dev port is an error, never a reason to pick another: the server's origin allowlist and
 * the mesh route are exact. `route` names the mesh route that may own the port.
 */
export async function requireFreeDevPorts(host: string, ports: readonly number[], route: string) {
  for (const port of ports) {
    if (!(await portAccepts(host, port))) continue

    const holders = await portHolders(port)
    if (holders.some((holder) => holder.name === 'mesh')) {
      throw scriptErrors.DEV_ROUTE_HOLDS_PORT({ port, route, internal: { host, holders } })
    }
    throw scriptErrors.DEV_PORT_IN_USE({ port, holders: holderText(holders), internal: { host } })
  }
}

/** Diagnostics for a conflict message only; never a reason to signal anything. */
async function portHolders(port: number): Promise<PortHolder[]> {
  const pids = await listenerPids(port).catch(() => [])
  return Promise.all(pids.map(async (pid) => ({ pid, name: await processName(pid) })))
}

function holderText(holders: readonly PortHolder[]) {
  if (holders.length === 0) return 'a process this user cannot inspect'
  return holders
    .map((holder) => (holder.name ? `${holder.name} (pid ${holder.pid})` : `pid ${holder.pid}`))
    .join(', ')
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

/** The executable name only: a full command line can carry another program's secrets. */
async function processName(pid: number) {
  const output = await commandOutput(['ps', '-p', String(pid), '-o', 'comm=']).catch(() => '')
  return output.trim()
}

async function commandOutput(command: string[]) {
  const child = Bun.spawn({ cmd: command, stderr: 'ignore', stdout: 'pipe' })
  const output = await new Response(child.stdout).text()
  await child.exited
  return output
}
