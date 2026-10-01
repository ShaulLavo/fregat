import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

export async function openCodeProcessFixture(
  options: { announcedUrl?: string; occupyRequestedPort?: boolean } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-opencode-process-'))
  const binaryPath = path.join(root, 'opencode')
  const marker = path.join(root, 'calls.jsonl')
  const factory = pathToFileURL(path.join(import.meta.dirname, 'opencode-http.ts')).href
  await writeFile(
    binaryPath,
    `#!${process.execPath}\nimport { startOpenCodeHttpFixture } from ${JSON.stringify(factory)}\nimport { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(marker)}, JSON.stringify({ args: process.argv.slice(2), dataHome: process.env.XDG_DATA_HOME }) + '\\n')\nif (process.argv[2] !== 'serve') process.exit(2)\nconst port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1])\nif (${JSON.stringify(options.occupyRequestedPort ?? false)}) startOpenCodeHttpFixture({ port })\nlet fixture\nif (port === 0) {\n  try { fixture = startOpenCodeHttpFixture({ port: 4096 }) } catch { fixture = startOpenCodeHttpFixture() }\n} else { fixture = startOpenCodeHttpFixture({ port }) }\nappendFileSync(${JSON.stringify(marker)}, JSON.stringify({ url: fixture.url, pid: process.pid }) + '\\n')\nconsole.log('OpenCode v2 server listening on ' + (${JSON.stringify(options.announcedUrl ?? null)} ?? fixture.url))\n`,
    { mode: 0o755 },
  )
  return { root, binaryPath, marker, close: () => rm(root, { recursive: true, force: true }) }
}
