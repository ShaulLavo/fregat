import { cp, rename } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createScriptError } from './structured-errors'

const root = path.resolve(import.meta.dirname, '..')
const site = path.join(root, 'apps/site')
const web = path.join(root, 'apps/web')
const output = path.join(site, 'dist/demo')

await run(['bun', 'astro', 'build'], site)
await run(
  [
    'bun',
    '--bun',
    'vite',
    'build',
    '--mode',
    'demo',
    '--base',
    '/fregat/demo/',
    '--outDir',
    output,
    '--emptyOutDir',
  ],
  web,
)
await rename(path.join(output, 'demo.html'), path.join(output, 'index.html'))
await cp(path.join(web, 'demo-assets'), path.join(output, 'demo-assets'), { recursive: true })
const worker = createRequire(path.join(web, 'package.json')).resolve('msw/mockServiceWorker.js')
await cp(worker, path.join(output, 'mockServiceWorker.js'))
console.log(`Built landing page and interactive demo: ${path.join(site, 'dist')}`)

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' })
  const code = await process.exited
  if (code !== 0) throw createScriptError(`${command.join(' ')} failed with exit code ${code}`)
}
