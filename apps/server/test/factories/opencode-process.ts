import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

export async function openCodeProcessFixture(
  options: {
    announcedUrl?: string
    occupyRequestedPort?: boolean
    wrapper?: 'alive' | 'exit'
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-opencode-process-'))
  const binaryPath = path.join(root, 'opencode')
  const marker = path.join(root, 'calls.jsonl')
  const factory = pathToFileURL(path.join(import.meta.dirname, 'opencode-http.ts')).href
  await writeFile(
    binaryPath,
    `#!${process.execPath}\nimport { startOpenCodeHttpFixture } from ${JSON.stringify(factory)}\nimport { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(marker)}, JSON.stringify({ args: process.argv.slice(2), dataHome: process.env.XDG_DATA_HOME }) + '\\n')\nif (process.argv[2] !== 'serve') process.exit(2)\nif (${JSON.stringify(options.wrapper === 'exit')}) await Bun.sleep(100)\nconst port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1])\nif (${JSON.stringify(options.occupyRequestedPort ?? false)}) startOpenCodeHttpFixture({ port })\nlet fixture\nif (port === 0) {\n  try { fixture = startOpenCodeHttpFixture({ port: 4096 }) } catch { fixture = startOpenCodeHttpFixture() }\n} else { fixture = startOpenCodeHttpFixture({ port }) }\nappendFileSync(${JSON.stringify(marker)}, JSON.stringify({ url: fixture.url, pid: process.pid }) + '\\n')\nconsole.log('OpenCode v2 server listening on ' + (${JSON.stringify(options.announcedUrl ?? null)} ?? fixture.url))\n`,
    { mode: 0o755 },
  )
  const wrapperPath = path.join(root, 'opencode-wrapper')
  if (options.wrapper)
    await writeFile(
      wrapperPath,
      `#!${process.execPath}\nimport { spawn } from 'node:child_process'\nimport { appendFileSync } from 'node:fs'\nconst child = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(binaryPath)}, ...process.argv.slice(2)], { env: process.env, stdio: ['ignore', 'inherit', 'inherit'] })\nappendFileSync(${JSON.stringify(marker)}, JSON.stringify({ wrapperPid: process.pid, childPid: child.pid }) + '\\n')\n${options.wrapper === 'exit' ? 'child.unref(); process.exit(0)' : "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"}\n`,
      { mode: 0o755 },
    )
  return {
    root,
    binaryPath: options.wrapper ? wrapperPath : binaryPath,
    marker,
    close: async () => {
      const text = await readFile(marker, 'utf8').catch(() => '')
      for (const line of text.trim().split('\n').filter(Boolean)) {
        const entry = JSON.parse(line)
        for (const pid of [entry.pid, entry.wrapperPid, entry.childPid]) {
          if (typeof pid !== 'number') continue
          const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
          if (!command.includes(root)) continue
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
        }
      }
      await rm(root, { recursive: true, force: true })
    },
  }
}
