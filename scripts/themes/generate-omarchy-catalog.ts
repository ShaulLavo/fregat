import { createHash } from 'node:crypto'
import path from 'node:path'
import { parseArgs } from 'node:util'

// Hashes every theme background at one Omarchy commit so the server can fetch and verify
// each file from GitHub without an API call. Reads blobs from the `references/omarchy` clone.
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    ref: { type: 'string', default: 'origin/quattro' },
    clone: { type: 'string', default: 'references/omarchy' },
    output: { type: 'string', default: 'apps/server/src/themes/wallpapers/omarchy-catalog.json' },
  },
})

const REPOSITORY = 'basecamp/omarchy'
const clone = path.resolve(values.clone)

function git(...args: string[]) {
  const result = Bun.spawnSync(['git', '-C', clone, ...args], { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`)
  return result.stdout
}

const commit = git('rev-parse', values.ref).toString().trim()
const files = git('ls-tree', '-r', '--name-only', commit, '--', 'themes')
  .toString()
  .split('\n')
  .filter((file) => /^themes\/[^/]+\/backgrounds\/[^/]+\.(jpe?g|png|webp)$/iu.test(file))
  .sort()

const wallpapers = files.map((file) => {
  const bytes = git('cat-file', 'blob', `${commit}:${file}`)
  const [, theme, , name] = file.split('/')
  return {
    theme: theme!,
    file: name!,
    asset: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  }
})

await Bun.write(
  path.resolve(values.output),
  `${JSON.stringify({ repository: REPOSITORY, commit, wallpapers }, null, 2)}\n`,
)
process.stdout.write(`${wallpapers.length} wallpapers at ${REPOSITORY}@${commit}\n`)
