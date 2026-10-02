import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import path from 'node:path'

type CommandResult = { code: number; stdout: string; stderr: string }

/** The operating system as setup touches it: tests pass a recording one. */
export type ServiceHost = {
  platform: NodeJS.Platform
  uid: number
  home: string
  env: Readonly<Record<string, string | undefined>>
  /** The Bun executable the service runs. */
  bun: string
  run: (argv: readonly string[]) => Promise<CommandResult>
  readFile: (file: string) => string | null
  /** Replaces the file in one rename, so a reader never sees half of it. */
  writeFile: (file: string, content: string) => void
  removeFile: (file: string) => void
}

export function realServiceHost(): ServiceHost {
  return {
    platform: process.platform,
    uid: userInfo().uid,
    home: homedir(),
    env: process.env,
    bun: process.execPath,
    run: async (argv) => {
      const child = Bun.spawn({ cmd: [...argv], stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return { code, stdout, stderr }
    },
    readFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
    writeFile: (file, content) => {
      mkdirSync(path.dirname(file), { recursive: true })
      const staging = `${file}.next-${process.pid}`
      writeFileSync(staging, content, { mode: 0o644 })
      renameSync(staging, file)
    },
    removeFile: (file) => rmSync(file, { force: true }),
  }
}
