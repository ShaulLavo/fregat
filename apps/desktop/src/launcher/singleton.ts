import { readlinkSync } from 'node:fs'
import { createConnection } from 'node:net'
import { hostname } from 'node:os'
import path from 'node:path'

export async function singletonState(
  profile: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<'live' | 'idle' | 'unverified'> {
  signal?.throwIfAborted()
  const socket = singletonSocket(profile)
  if (
    socket &&
    cookieMatches(socket) &&
    (await acceptsConnection(socket.path, timeoutMs, signal)) &&
    cookieMatches(socket)
  )
    return 'live'
  signal?.throwIfAborted()
  let lock: string
  try {
    lock = readlinkSync(path.join(profile, 'SingletonLock'))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'idle' : 'unverified'
  }
  const prefix = hostname() + '-'
  if (!lock.startsWith(prefix)) return 'unverified'
  const pid = lock.slice(prefix.length)
  if (!/^[1-9]\d*$/.test(pid) || !Number.isSafeInteger(Number(pid))) return 'unverified'
  try {
    process.kill(Number(pid), 0)
    return 'live'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return 'idle'
    return code === 'EPERM' ? 'live' : 'unverified'
  }
}

type SingletonSocket = { path: string; cookie?: { local: string; remote: string } }

function singletonSocket(profile: string): SingletonSocket | undefined {
  const file = path.join(profile, 'SingletonSocket')
  try {
    const target = path.resolve(profile, readlinkSync(file))
    return {
      path: target,
      cookie: {
        local: path.join(profile, 'SingletonCookie'),
        remote: path.join(path.dirname(target), 'SingletonCookie'),
      },
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EINVAL') return { path: file }
    return undefined
  }
}

function cookieMatches(socket: SingletonSocket) {
  if (!socket.cookie) return true
  try {
    return readlinkSync(socket.cookie.local) === readlinkSync(socket.cookie.remote)
  } catch {
    return false
  }
}

function acceptsConnection(file: string, timeoutMs: number, signal?: AbortSignal) {
  if (timeoutMs <= 0) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    // A connection followed by EOF probes the owner without sending any launch request.
    const socket = createConnection({ path: file, signal })
    const finish = (connected: boolean) => {
      socket.destroy()
      resolve(connected)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(timeoutMs, () => finish(false))
  })
}
