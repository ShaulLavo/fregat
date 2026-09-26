import type { McpSignInFlow } from '../../mcp-sign-in'
import { mcpConfigErrors } from '../../structured-errors'

/** The CLI prints its authorization address within a second or two; past this it is stuck. */
const URL_WAIT_MS = 20_000

export type ClaudeMcpLoginProcess = {
  readonly exited: Promise<number>
  kill: () => void
  onOutput: (listener: (text: string) => void) => void
  write: (text: string) => void
}

/**
 * `claude mcp login --no-browser` in a terminal: without one it refuses to wait for the pasted
 * address. Injected in tests so no real CLI signs anything in.
 */
export type ClaudeMcpLoginSpawn = (
  args: readonly string[],
  options: { cwd: string },
) => ClaudeMcpLoginProcess

export function defaultClaudeMcpLoginSpawn(
  executable: () => Promise<string>,
  env: NodeJS.ProcessEnv,
): ClaudeMcpLoginSpawn {
  return (args, options) => {
    const listeners: Array<(text: string) => void> = []
    const decoder = new TextDecoder()
    let child: Bun.Subprocess | null = null
    let killed = false
    const exited = executable().then((path) => {
      if (killed) return 1
      // Wide enough that the address never wraps across lines.
      child = Bun.spawn([path, ...args], {
        cwd: options.cwd,
        env,
        terminal: {
          cols: 4000,
          rows: 40,
          data: (_terminal, data) => {
            const text = decoder.decode(data, { stream: true })
            for (const listener of listeners) listener(text)
          },
        },
      })
      return child.exited
    })
    return {
      exited,
      kill: () => {
        killed = true
        child?.kill()
      },
      onOutput: (listener) => listeners.push(listener),
      write: (text) => child?.terminal?.write(text),
    }
  }
}

/** Starts the CLI's sign-in and resolves once it has printed where the browser should go. */
export async function startClaudeMcpSignIn(
  spawn: ClaudeMcpLoginSpawn,
  input: { folder: string; name: string },
): Promise<McpSignInFlow> {
  const child = spawn(['mcp', 'login', '--no-browser', input.name], { cwd: input.folder })
  const authorizationUrl = await printedAuthorizationUrl(child).catch((error: unknown) => {
    child.kill()
    throw error
  })
  const done = child.exited.then((exitCode) => {
    if (exitCode === 0) return

    throw mcpConfigErrors.MCP_SIGN_IN_FAILED({ internal: { exitCode, stage: 'exchange' } })
  })
  return {
    authorizationUrl,
    cancel: () => child.kill(),
    done,
    // The CLI's own prompt takes the address the page ended on, like a person pasting it.
    finish: async (callbackUrl) => child.write(`${callbackUrl.toString()}\r`),
  }
}

function printedAuthorizationUrl(child: ClaudeMcpLoginProcess) {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(
      () => reject(mcpConfigErrors.MCP_SIGN_IN_FAILED({ internal: { stage: 'address-timeout' } })),
      URL_WAIT_MS,
    )
    child.onOutput((text) => {
      output += text
      const found = authorizationUrlIn(output)
      if (!found) return

      clearTimeout(timer)
      resolve(found)
    })
    void child.exited.then((exitCode) => {
      clearTimeout(timer)
      reject(mcpConfigErrors.MCP_SIGN_IN_FAILED({ internal: { exitCode, stage: 'address' } }))
    })
  })
}

/** The first address carrying an OAuth `redirect_uri`, once terminal styling is stripped. */
export function authorizationUrlIn(output: string) {
  const plain = output
    // OSC 8 hyperlinks wrap the address a second time; keep only the visible text.
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
  const match = plain.match(/https?:\/\/\S*[?&]redirect_uri=\S+/)
  return match?.[0] ?? null
}
