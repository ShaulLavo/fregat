import type { ServiceHost } from './host'

export type PortHolder = { name: string; pid: number } | null

/** The program listening on a port, when the OS lets this user see it. */
export async function portHolder(host: ServiceHost, port: number): Promise<PortHolder> {
  if (host.platform === 'darwin') return lsofHolder(host, port)
  const result = await host.run(['ss', '-Hltnp', `sport = :${port}`]).catch(() => null)
  const match = result ? /users:\(\("([^"]+)",pid=(\d+)/.exec(result.stdout) : null
  return match?.[1] && match[2] ? { name: match[1], pid: Number(match[2]) } : null
}

async function lsofHolder(host: ServiceHost, port: number): Promise<PortHolder> {
  const result = await host
    .run(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'])
    .catch(() => null)
  const pid = result ? /^p(\d+)$/m.exec(result.stdout)?.[1] : undefined
  const name = result ? /^c(.+)$/m.exec(result.stdout)?.[1] : undefined
  return pid && name ? { name, pid: Number(pid) } : null
}
