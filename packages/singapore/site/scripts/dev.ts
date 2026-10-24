import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { startCapture } from './capture'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('astro/package.json')), 'bin/astro.mjs')
const stopCapture = await startCapture()
try {
  const child = Bun.spawn(['node', cli, 'dev'].concat(process.argv.slice(2)), {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const stop = (signal: NodeJS.Signals) => child.kill(signal)
  const interrupt = () => stop('SIGINT')
  const terminate = () => stop('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    process.exitCode = await child.exited
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
} finally {
  await stopCapture()
}
