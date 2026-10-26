import assert from 'node:assert/strict'
import { readWorkspaceGraph, requiredLibraries } from './affected.mjs'

const [operation, source] = process.argv.slice(2)
const graph = readWorkspaceGraph(process.cwd())
function targetNames() {
  if (source === 'all') return Array.from(graph.packages.keys())
  return JSON.parse(source)
}
const names = targetNames()
assert(
  Array.isArray(names) &&
    names.every((name) => typeof name === 'string' && graph.packages.has(name)),
  'CI targets must name existing workspaces',
)

async function run(command) {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' })
  const status = await child.exited
  if (status !== 0) process.exit(status)
}

if (operation === 'build') {
  const libraries = requiredLibraries(graph, names)
  if (libraries.length)
    await run(
      ['bun', 'x', 'turbo', 'run', 'build'].concat(libraries.map((name) => `--filter=${name}`)),
    )
} else {
  assert(['checks', 'tests'].includes(operation), 'Unknown CI package operation')
  for (const name of names) {
    const pkg = graph.packages.get(name)
    if (operation === 'tests' && ['web', 'server', 'tui', 'scripts'].includes(name)) continue
    const tasks = operation === 'checks' ? ['format:check', 'lint', 'typecheck'] : ['test']
    for (const task of tasks) {
      if (!pkg.scripts[task]) continue
      if (name === 'scripts' && task === 'typecheck') continue
      await run(['bun', 'run', '--cwd', pkg.directory, task])
    }
  }
}
