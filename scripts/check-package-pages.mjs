import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageDirectories = ['packages/ghostty-webgpu']
for (const parent of ['packages/singapore/packages', 'packages/hotkeys/packages']) {
  const entries = await readdir(join(root, parent), { withFileTypes: true })
  packageDirectories.push(
    ...entries.filter((entry) => entry.isDirectory()).map((entry) => `${parent}/${entry.name}`),
  )
}

const links = new Set()
let readmes = 0
let manifests = 0
for (const directory of packageDirectories) {
  const manifestPath = join(root, directory, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.private) continue
  manifests++
  assert(manifest.description?.endsWith('.'), `${manifest.name}: description must be a sentence`)
  assert(
    manifest.keywords?.length >= 5 && manifest.keywords.length <= 10,
    `${manifest.name}: use 5–10 keywords`,
  )
  assert.equal(
    new Set(manifest.keywords).size,
    manifest.keywords.length,
    `${manifest.name}: keywords repeat`,
  )
  assert.equal(manifest.license, 'MIT', `${manifest.name}: license`)
  assert.equal(
    manifest.bugs?.url,
    'https://github.com/ShaulLavo/fregat/issues',
    `${manifest.name}: issues`,
  )
  assert.deepEqual(
    manifest.repository,
    {
      type: 'git',
      url: 'git+https://github.com/ShaulLavo/fregat.git',
      directory,
    },
    `${manifest.name}: repository provenance`,
  )
  let homepage = 'https://github.com/ShaulLavo/fregat/tree/main/packages/hotkeys'
  if (directory === 'packages/ghostty-webgpu') homepage = 'https://ghostty.shaulavo.dev/'
  if (directory.startsWith('packages/singapore/')) {
    homepage = `https://singapore.shaulavo.dev/docs/reference/api/${manifest.name.split('/')[1]}/overview/`
  }
  assert.equal(manifest.homepage, homepage, `${manifest.name}: homepage`)
  links.add(homepage)
  links.add(manifest.bugs.url)
  if (directory === 'packages/ghostty-webgpu') continue
  readmes++
  const readme = await readFile(join(root, directory, 'README.md'), 'utf8')
  for (const heading of ['Install', 'Usage', 'API highlights', 'License']) {
    assert(readme.includes(`## ${heading}\n`), `${manifest.name}: missing ${heading}`)
  }
  // A package that is not on npm yet says so instead of printing an install command that fails.
  const installed = readme.match(/^npm install (.+)$/m)?.[1].split(' ') ?? []
  const unpublished = /^Not on npm yet\./m.test(readme)
  assert(
    installed.includes(manifest.name) || unpublished,
    `${manifest.name}: install command, or a line starting "Not on npm yet."`,
  )
  assert.equal(
    [...readme.matchAll(/^```tsx?$/gm)].length,
    1,
    `${manifest.name}: one standalone typed example`,
  )
  const destinations = Array.from(readme.matchAll(/\]\(([^)]+)\)/g), (match) => match[1])
  for (const destination of destinations) {
    assert(destination.startsWith('https://'), `${manifest.name}: use absolute HTTPS links`)
    links.add(destination)
  }
  assert(destinations.includes(homepage), `${manifest.name}: API or family homepage link`)
}
const sourceLinks = new Set()
for (const link of links) {
  const prefix = 'https://github.com/ShaulLavo/fregat/blob/main/'
  if (!link.startsWith(prefix)) continue
  const path = link.slice(prefix.length).split('#')[0]
  assert(!path.split('/').includes('..'), `Source link must stay in the checkout: ${link}`)
  await readFile(join(root, path))
  sourceLinks.add(link)
}
console.log(`Checked metadata for ${manifests} published packages and ${readmes} package READMEs.`)
console.log(`Checked ${sourceLinks.size} repository source links against this checkout.`)

if (process.argv.includes('--links')) {
  const failures = []
  // Keep remote checks opt-in so ordinary verification works offline.
  let remoteCount = 0
  for (const link of links) {
    // New source files reach main after merge; their targets are checked locally above.
    if (process.argv.includes('--local-source-links') && sourceLinks.has(link)) continue
    remoteCount++
    try {
      const response = await fetch(link, { signal: AbortSignal.timeout(30_000) })
      await response.body?.cancel()
      console.log(`${response.status} ${link}`)
      if (!response.ok) failures.push(`${response.status} ${link}`)
    } catch (error) {
      failures.push(`${String(error)} ${link}`)
    }
  }
  assert.equal(failures.length, 0, `Unresolved package links:\n${failures.join('\n')}`)
  console.log(`Resolved ${remoteCount} distinct HTTPS links over HTTP.`)
}
