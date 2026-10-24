import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const packages = join(root, 'packages')
const entries = await readdir(packages, { withFileTypes: true })
const temporary = []
let sampleCount = 0
let packageCount = 0

try {
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = join(packages, entry.name)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    if (manifest.private) continue
    const readme = join(directory, 'README.md')
    const text = await readFile(readme, 'utf8')
    const snippets = Array.from(text.matchAll(/^```(ts|tsx)\n([\s\S]*?)\n```/gm))
    assert(snippets.length > 0, `${manifest.name}: missing typed README sample`)
    // Keep samples beside their package so self imports use its published exports.
    const scratch = await mkdtemp(join(directory, '.readme-samples-'))
    temporary.push(scratch)
    const files = []
    for (const [index, snippet] of snippets.entries()) {
      const file = join(scratch, `sample-${index}.${snippet[1]}`)
      await writeFile(file, `${snippet[2]}\nexport {}\n`)
      files.push(file)
    }
    const config = join(scratch, 'tsconfig.json')
    await writeFile(
      config,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          jsx: 'react-jsx',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: [],
        },
        files,
      }),
    )
    const result = spawnSync(process.execPath, [compiler, '--noEmit', '-p', config], {
      cwd: directory,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, `${readme}\n${result.stdout}${result.stderr}`)
    sampleCount += snippets.length
    packageCount++
  }
  console.log(`Checked ${sampleCount} hotkeys README samples across ${packageCount} packages.`)
} finally {
  await Promise.all(temporary.map((directory) => rm(directory, { recursive: true, force: true })))
}
