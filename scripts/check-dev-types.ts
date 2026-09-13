import path from 'node:path'
import { readDevSources, writeDevTypeConfig } from './dev-sources'

const webRoot = path.resolve(import.meta.dirname, '../apps/web')
const config = writeDevTypeConfig(webRoot, readDevSources(webRoot))
const child = Bun.spawn({
  cmd: [path.join(webRoot, 'node_modules/.bin/tsgo'), '-p', config, ...Bun.argv.slice(2)],
  cwd: webRoot,
  stdout: 'inherit',
  stderr: 'inherit',
})
process.once('SIGINT', () => child.kill('SIGINT'))
process.once('SIGTERM', () => child.kill('SIGTERM'))
process.exit(await child.exited)
