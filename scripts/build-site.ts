import path from 'node:path'
import { createScriptError } from './structured-errors'

const root = path.resolve(import.meta.dirname, '..')
const site = path.join(root, 'apps/site')

await run(['bun', 'astro', 'build'], site)
console.log(`Built landing page: ${path.join(site, 'dist')}`)

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' })
  const code = await process.exited
  if (code !== 0) throw createScriptError(`${command.join(' ')} failed with exit code ${code}`)
}
