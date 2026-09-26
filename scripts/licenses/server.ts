import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runtimePackageFiles } from './runtime'
import { packageNotices } from './notices'

const server = path.resolve(import.meta.dirname, '../../apps/server')
const output = path.join(server, 'dist')
const files: string[] = []
for (const entry of readdirSync(output)) {
  if (!/\.(js|ts)$/.test(entry)) continue
  const source = readFileSync(path.join(output, entry), 'utf8')
  for (const match of source.matchAll(/^\/\/ (.*\/node_modules\/.*)$/gm))
    files.push(path.resolve(server, match[1]!))
}

files.push(...runtimePackageFiles(path.resolve(server, '../..')))
writeFileSync(
  path.join(output, 'THIRD_PARTY_NOTICES.txt'),
  'Server bundle and installed runtime dependencies\n\n' + packageNotices(files),
)
