import { open } from 'node:fs/promises'
import path from 'node:path'

type AskpassInvocation = {
  order: number
  kind: 'confirmation' | 'secret'
  startedAt: number
  finishedAt: number | null
  status: 'pending' | 'answered' | 'cancelled' | 'failed'
}

export function openSshDiagnostics(
  directory: string,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
) {
  const tracePath = path.join(directory, 'ssh.trace')
  const agent = {
    inheritedSocketPresent: Boolean(environment.SSH_AUTH_SOCK),
    inheritedPidPresent: Boolean(environment.SSH_AGENT_PID),
    fixtureSocketPresent: false,
    fixturePidPresent: false,
    identityAgent: 'none',
  }
  const askpass: AskpassInvocation[] = []
  let invocations = 0

  async function answer(kind: AskpassInvocation['kind'], request: () => Promise<string | null>) {
    const invocation: AskpassInvocation = {
      order: ++invocations,
      kind,
      startedAt: Date.now(),
      finishedAt: null,
      status: 'pending',
    }
    askpass.push(invocation)
    if (askpass.length > 32) askpass.shift()
    try {
      const value = await request()
      invocation.status = value === null ? 'cancelled' : 'answered'
      return value
    } catch (error) {
      invocation.status = 'failed'
      throw error
    } finally {
      invocation.finishedAt = Date.now()
    }
  }

  async function publish(write: (message: string) => void = console.error) {
    const trace = await readTrace(tracePath).catch(() => ({ lines: [], truncated: false }))
    write(
      `OpenSSH fixture diagnostics ${JSON.stringify({
        sshVerbose: trace.lines,
        traceTailTruncated: trace.truncated,
        agent,
        askpass,
        askpassInvocations: invocations,
      })}`,
    )
  }

  return { tracePath, answer, publish }
}

async function readTrace(filename: string) {
  const file = await open(filename, 'r').catch(() => null)
  if (!file) return { lines: [], truncated: false }
  try {
    const { size } = await file.stat()
    const length = Math.min(size, 65536)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, size - length)
    const lines = buffer.subarray(0, bytesRead).toString().split('\n')
    if (size > length) lines.shift()
    const safe = lines.map(safeVerboseLine).filter((line) => line !== null)
    return { lines: safe.slice(-128), truncated: size > length || safe.length > 128 }
  } finally {
    await file.close()
  }
}

const verboseEvents = [
  'multiplexing control connection',
  'setting up multiplex master socket',
  'forking to background',
  'auto-mux: Trying existing master',
  'ControlPersist timeout expired',
  'forwarding request failed',
  'Offering public key',
  'Server accepts key',
  'Permission denied',
  'Connection refused',
  'Address already in use',
] as const

function safeVerboseLine(line: string): string | null {
  for (const event of verboseEvents) {
    if (line.includes(event)) return event
  }
  if (/Authenticated to .* using "publickey"/.test(line)) return 'Authenticated using publickey'
  if (/Control socket .* does not exist/.test(line)) return 'Control socket missing'
  if (/ControlSocket .* already exists/.test(line)) return 'Control socket conflict'
  const operation =
    /^debug[123]: (mux_client_hello_exchange|mux_client_request_session|mux_client_request_forward|mux_client_request_alive|mux_client_request_terminate|mux_client_read_packet|mux_client_read_packet_timeout|mux_master_process_terminate|mux_master_process_new_session|mux_master_process_open_fwd|mux_master_process_close_fwd|control_persist_exit_time|ssh_get_authentication_socket|get_agent_identities)(?::|\b)/.exec(
      line,
    )
  if (!operation) return null
  const status = /\b(?:master session id|exit status|pid)[=: ]+(\d+)\b/.exec(line)
  return status ? `${operation[1]} status=${status[1]}` : operation[1]!
}
