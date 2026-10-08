import path from 'node:path'
import { checkoutRoot } from '../agent/paths'
import { createScriptError } from '../structured-errors'

export async function buildBenchmarkWeb(webRoot: string, log: string) {
  const child = Bun.spawn(['bun', '--bun', 'vite', 'build', '--base', '/', '--outDir', webRoot], {
    cwd: path.join(checkoutRoot, 'apps/web'),
    env: { ...process.env, NODE_ENV: 'production', VITE_SERVER_URL: undefined },
    stdout: Bun.file(log),
    stderr: 'inherit',
  })
  if (await child.exited) throw createScriptError(`Web build failed; see ${log}`)
}
