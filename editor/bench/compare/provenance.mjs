import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { editors } from './protocol.mjs'

export async function sourceIdentity(root) {
  const files = []
  for (const path of [
    '../../packages/editor/src',
    '../../packages/textbuffer/src',
    '../../packages/tree-sitter/src',
    '../../packages/tree-sitter-languages/src',
    '../../../hotkeys/packages/hotkeys/src',
  ]) {
    const folder = resolve(root, path)
    for (const file of (await readdir(folder, { recursive: true })).sort()) {
      if (!(await stat(resolve(folder, file))).isFile()) continue
      files.push([
        `${path}/${file}`,
        createHash('sha256')
          .update(await readFile(resolve(folder, file)))
          .digest('hex'),
      ])
    }
  }
  for (const file of [
    'full-document.mjs',
    'output-proof.mjs',
    'page.js',
    'page.html',
    'fixture.mjs',
    'singapore.js',
    'monaco.js',
    'codemirror.js',
    'build.mjs',
    'provenance.mjs',
    '../../../bun.lock',
  ])
    files.push([
      file,
      createHash('sha256')
        .update(await readFile(resolve(root, file)))
        .digest('hex'),
    ])
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

export async function readServedBuilds(directory) {
  const builds = []
  for (const editor of editors) {
    for (const mode of ['core', 'typescript']) {
      const id = `${editor}-${mode}`
      const folder = resolve(directory, id)
      const files = []
      for (const file of (await readdir(folder, { recursive: true })).sort()) {
        const path = resolve(folder, file)
        if (!(await stat(path)).isFile()) continue
        files.push({
          file: file.split(sep).join('/'),
          sha256: createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        })
      }
      if (!['index.html', 'entry.js'].every((name) => files.some((file) => file.file === name)))
        throw new RangeError(`Incomplete served build: ${id}`)
      builds.push({ id, files })
    }
  }
  return builds
}

export function verifyResume(previous, current) {
  if (!Array.isArray(previous.builds) || !previous.builds.length)
    throw new RangeError('Resume requires recorded served-build hashes')
  for (const key of [
    'browser',
    'tooling',
    'versions',
    'rootLockSha256',
    'benchmarkSha256',
    'builds',
    'bundles',
    'config',
    'machine',
  ]) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(current[key]))
      throw new RangeError(`Resume differs in ${key}`)
  }
}
