// Electrobun 2 projects its SDK into `.hutch/devkit` (gitignored), so a fresh
// clone has nothing for the `electrobun/*` path aliases to resolve. Runs
// `electrobun prepare` only when the projection is missing: it takes the Hutch
// build lock, which a running `electrobun dev` already holds.
import { existsSync } from 'node:fs'
import path from 'node:path'

const DESKTOP_DIR = path.join(import.meta.dirname, '..')
const MARKER = path.join(DESKTOP_DIR, '.hutch', 'devkit', 'api', 'sdks', 'main', 'index.ts')

if (existsSync(MARKER)) process.exit(0)

console.error('[devkit] .hutch/devkit is missing, running `electrobun prepare`')
const result = Bun.spawnSync({
  cmd: ['bun', 'x', 'electrobun', 'prepare'],
  cwd: DESKTOP_DIR,
  stdio: ['inherit', 'inherit', 'inherit'],
})
if (result.exitCode !== 0) process.exit(result.exitCode ?? 1)

if (!existsSync(MARKER)) {
  console.error(`[devkit] prepare finished but ${MARKER} is still missing`)
  process.exit(1)
}
