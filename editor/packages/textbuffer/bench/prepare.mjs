import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { fileHashes, gitBlobHash, pin, upstreamRoot } from './support.mjs'

export async function prepare() {
  mkdirSync(upstreamRoot, { recursive: true })
  for (const [filename, expected] of Object.entries(pin.files)) {
    const destination = path.join(upstreamRoot, filename)
    let bytes = existsSync(destination) ? readFileSync(destination) : null
    if (!bytes) {
      const url = `https://raw.githubusercontent.com/${pin.repository}/${pin.commit}/${filename}`
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`Cannot fetch pinned source: ${response.status} ${url}`)
      bytes = Buffer.from(await response.arrayBuffer())
    }
    assert.equal(
      gitBlobHash(bytes),
      expected,
      `Pinned source mismatch: ${filename}; remove bench/.cache to retry`,
    )
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, bytes)
  }

  // Compile original source without installing or running upstream lifecycle scripts.
  // A program emit (not isolated transpilation) preserves const-enum inlining.
  writeFileSync(path.join(upstreamRoot, 'package.json'), '{"type":"commonjs"}\n')
  const outDir = path.join(upstreamRoot, 'dist')
  rmSync(outDir, { recursive: true, force: true })
  const program = ts.createProgram(
    Object.keys(pin.files)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => path.join(upstreamRoot, name)),
    {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      rootDir: path.join(upstreamRoot, 'src'),
      outDir,
      strict: false,
      skipLibCheck: true,
      noEmitOnError: true,
      types: [],
      lib: ['lib.es2023.d.ts'],
    },
  )
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => upstreamRoot,
        getCanonicalFileName: (name) => name,
        getNewLine: () => '\n',
      }),
    )
  const result = program.emit()
  assert(!result.emitSkipped, 'Upstream build failed')
  const metadata = {
    repository: pin.repository,
    commit: pin.commit,
    compiler: ts.version,
    target: 'ES2023',
    format: 'CommonJS',
    sourceGitBlobs: pin.files,
    outputSha256: fileHashes(outDir),
  }
  writeFileSync(path.join(upstreamRoot, 'build.json'), JSON.stringify(metadata, null, 2) + '\n')
  return metadata
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await prepare()
  console.log(`Prepared ${pin.repository}@${pin.commit}`)
}
