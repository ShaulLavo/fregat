import { spawnSync } from 'node:child_process'
import { write } from 'node:fs'

type QueryResult = ReturnType<typeof spawnSync>
type Sink = (line: string) => unknown

function excerpt(value: unknown) {
  if (typeof value !== 'string') return { text: null, characters: null, truncated: false }
  return { text: value.slice(0, 128), characters: value.length, truncated: value.length > 128 }
}

export function recordEmptyServiceState(
  service: string,
  result: QueryResult,
  sink: Sink = (line) => write(2, line, () => {}),
) {
  try {
    const errorCode = result.error && 'code' in result.error ? result.error.code : null
    const line =
      '[heavy-service-state-query] ' +
      JSON.stringify({
        event: 'empty-service-state-query',
        service: service.slice(0, 128),
        serviceTruncated: service.length > 128,
        pid: result.pid,
        status: result.status,
        signal: result.signal,
        spawnError: result.error !== undefined,
        errorCode: typeof errorCode === 'string' ? errorCode.slice(0, 32) : null,
        errorCodeTruncated: typeof errorCode === 'string' && errorCode.length > 32,
        stdout: excerpt(result.stdout),
        stderr: excerpt(result.stderr),
      }) +
      '\n'
    if (Buffer.byteLength(line) <= 4096) {
      sink(line)
      return
    }
    sink(
      '[heavy-service-state-query] ' +
        JSON.stringify({
          event: 'empty-service-state-query',
          pid: result.pid,
          status: result.status,
          refused: true,
          byteLimit: 4096,
        }) +
        '\n',
    )
  } catch {}
}

export function serviceState(service: string, env?: NodeJS.ProcessEnv, sink?: Sink): string {
  const result = spawnSync('systemctl', ['--user', 'show', service, '-p', 'LoadState', '--value'], {
    encoding: 'utf8',
    ...(env ? { env } : {}),
  })
  const state = result.stdout.trim()
  if (state === '') recordEmptyServiceState(service, result, sink)
  return state
}
