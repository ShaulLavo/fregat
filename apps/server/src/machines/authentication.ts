import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  closeForward,
  forwardCommand,
  type ForwardOptions,
  type SshChild,
  type SshForward,
  type SshSpawner,
} from './forward'
import { shellQuote } from '../utils/shell'
import { createSshError } from './structured-errors'

type AuthenticationPrompt = { prompt: string; kind: 'secret' | 'confirmation' }

export async function createSshAuthentication(options: {
  request: (prompt: AuthenticationPrompt) => Promise<string | null>
  onCancel?: () => void
}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-ssh-'))
  await chmod(directory, 0o700)
  const socketPath = path.join(directory, 'auth.sock')
  const controlPath = path.join(directory, 'control.sock')
  const helperPath = path.join(directory, 'askpass')
  const scriptPath = path.join(directory, 'askpass.js')
  const token = crypto.randomUUID()
  const controller = new AbortController()
  let closing: Promise<void> | undefined
  let server: Bun.Server<undefined> | undefined
  let target: string | undefined
  let cancelled = false
  const active = new Set<SshChild>()
  const forwards = new Set<SshForward>()

  async function answer(request: Request) {
    if (request.method !== 'POST' || request.headers.get('authorization') !== `Bearer ${token}`)
      return new Response(null, { status: 403 })
    const prompt = await parsePrompt(request)
    if (!prompt) return new Response(null, { status: 400 })
    server?.timeout(request, 150)
    const value = await waitForAnswer(options.request, prompt, controller.signal)
    if (value === null && !controller.signal.aborted) cancel()
    return Response.json({ answer: value })
  }

  function cancel() {
    if (cancelled) return
    cancelled = true
    for (const child of active) child.kill('SIGKILL')
    options.onCancel?.()
  }

  function begin() {
    cancelled = false
  }

  async function close() {
    if (closing) return closing
    controller.abort()
    closing = (async () => {
      for (const child of active) child.kill('SIGKILL')
      await Promise.allSettled([...forwards].map((forward) => forward.close()))
      await server?.stop(true)
      await closeMaster(controlPath, target)
      await rm(directory, { recursive: true, force: true })
    })()
    return closing
  }

  try {
    await writeFile(scriptPath, helperSource, { mode: 0o600 })
    await writeFile(
      helperPath,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(scriptPath)} "$@"\n`,
      { mode: 0o700 },
    )
    server = Bun.serve({ unix: socketPath, fetch: answer })
    await chmod(socketPath, 0o600)
  } catch (error) {
    await close()
    throw error
  }

  function spawnChild(command: string[], stdin: 'ignore' | 'pipe') {
    if (controller.signal.aborted)
      throw createSshError('settings', 'SSH authentication is closing.')
    if (cancelled) throw createSshError('probe', 'SSH authentication was cancelled.')
    const args = command.map(interactiveOption)
    if (args[0] === 'ssh') {
      target = args[args.indexOf('--') + 1]
      args.splice(
        1,
        0,
        '-o',
        'ControlMaster=auto',
        '-o',
        'ControlPersist=60',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=2',
        '-S',
        controlPath,
      )
    }
    const child = Bun.spawn({
      cmd: args,
      env: {
        ...process.env,
        SSH_ASKPASS: helperPath,
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: process.env.DISPLAY || ':0',
        PLATFORM_SSH_ASKPASS_SOCKET: socketPath,
        PLATFORM_SSH_ASKPASS_TOKEN: token,
      },
      stdin,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (args[0] === 'ssh') {
      active.add(child)
      void child.exited.then(() => active.delete(child))
    }
    return child
  }

  const spawn: SshSpawner = (command) => spawnChild(command, 'ignore')

  async function openForward(options: ForwardOptions): Promise<SshForward> {
    // Open stdin keeps the mux session alive; its listener stays on the master until -O cancel.
    const command = forwardCommand(options, ['sh', '-c', shellQuote('exec cat >/dev/null')])
    const child = spawnChild(command, 'pipe')
    let stopping: Promise<void> | undefined
    const forward: SshForward = {
      child,
      close() {
        stopping ??= releaseForward(child, options).finally(() => forwards.delete(forward))
        return stopping
      },
    }
    forwards.add(forward)
    return forward
  }

  async function releaseForward(child: SshChild, options: ForwardOptions) {
    await closeForward(child)
    if (!existsSync(controlPath)) return
    const released = await controlCommand(controlPath, options.target, [
      '-O',
      'cancel',
      '-L',
      `127.0.0.1:${options.localPort}:127.0.0.1:${options.remotePort}`,
    ])
    if (!released) await closeMaster(controlPath, options.target)
  }

  return { spawn, openForward, cancel, begin, close }
}

async function closeMaster(controlPath: string, target: string | undefined) {
  if (!target || !existsSync(controlPath)) return
  await controlCommand(controlPath, target, ['-O', 'exit'])
}

async function controlCommand(controlPath: string, target: string, operation: readonly string[]) {
  const child = Bun.spawn({
    cmd: ['ssh', '-S', controlPath, ...operation, '--', target],
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 2000)
  try {
    return (await child.exited) === 0
  } finally {
    clearTimeout(timeout)
  }
}

function interactiveOption(option: string) {
  if (option === 'BatchMode=yes') return 'BatchMode=no'
  if (option === 'StrictHostKeyChecking=yes') return 'StrictHostKeyChecking=ask'
  return option
}

async function parsePrompt(request: Request): Promise<AuthenticationPrompt | null> {
  try {
    const input: unknown = await request.json()
    if (typeof input !== 'object' || input === null) return null
    if (!('prompt' in input) || typeof input.prompt !== 'string' || input.prompt.length > 8192)
      return null
    if (!('kind' in input) || (input.kind !== 'secret' && input.kind !== 'confirmation'))
      return null
    return { prompt: input.prompt, kind: input.kind }
  } catch {
    return null
  }
}

function waitForAnswer(
  request: (prompt: AuthenticationPrompt) => Promise<string | null>,
  prompt: AuthenticationPrompt,
  signal: AbortSignal,
) {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise<string | null>((resolve) => {
    const cancel = () => resolve(null)
    signal.addEventListener('abort', cancel, { once: true })
    Promise.resolve()
      .then(() => request(prompt))
      .then(resolve, cancel)
      .finally(() => signal.removeEventListener('abort', cancel))
  })
}

const helperSource = `
const socket = process.env.PLATFORM_SSH_ASKPASS_SOCKET;
const token = process.env.PLATFORM_SSH_ASKPASS_TOKEN;
if (!socket || !token) process.exit(1);
try {
  const response = await fetch('http://localhost/prompt', {
    unix: socket,
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: process.argv[2] ?? '',
      kind: process.env.SSH_ASKPASS_PROMPT === 'confirm' || /(?:Are you sure you want to continue connecting|Please type 'yes'(?:, 'no'| or 'no'))/.test(process.argv[2] ?? '') ? 'confirmation' : 'secret',
    }),
  });
  if (!response.ok) process.exit(1);
  const result = await response.json();
  if (typeof result.answer !== 'string') process.exit(1);
  process.stdout.write(result.answer + '\\n');
} catch {
  process.exit(1);
}
`
