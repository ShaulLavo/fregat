// Pins web-tree-sitter to the newest build on tree-sitter-x's web-tree-sitter branch, which the
// fork's CI rebuilds after every green master run. Bun locks a git dependency to one commit, so
// following the fork means rewriting that commit; `bun install` then relocks only this package.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { $, Glob } from 'bun'

const root = resolve(import.meta.dir, '..')
const pin = /github:ShaulLavo\/tree-sitter-x#([0-9a-f]+)/

const heads =
  await $`git ls-remote https://github.com/ShaulLavo/tree-sitter-x refs/heads/web-tree-sitter`.text()
const latest = heads.slice(0, 7)
if (!/^[0-9a-f]{7}$/.test(latest))
  throw new Error(`No web-tree-sitter branch on tree-sitter-x: ${heads}`)

const previous = new Set<string>()
for await (const file of new Glob('packages/*/package.json').scan(root)) {
  const path = resolve(root, file)
  const text = await readFile(path, 'utf8')
  const current = text.match(pin)?.[1]
  if (!current || current === latest) continue
  previous.add(current)
  await writeFile(path, text.replace(pin, `github:ShaulLavo/tree-sitter-x#${latest}`))
}

if (previous.size === 0) {
  console.log(`web-tree-sitter is at tree-sitter-x ${latest}`)
} else {
  await $`bun install`.cwd(root)
  console.log(`web-tree-sitter: tree-sitter-x ${[...previous].join(', ')} -> ${latest}`)
}
