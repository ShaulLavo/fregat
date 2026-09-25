import path from 'node:path'
import * as v from 'valibot'
import { createWorkspacePaths, isOutsideRoot } from '../../fs/path'
import { runBoundedProcess } from '../../git/utils/process'
import { prepareWorkerProject, workerCompilerOptions, workerSupportFiles } from './worker-program'
import { resolveTypeScriptCompiler } from './runtime'

const input = v.parse(
  v.object({ root: v.string(), filesystemRoot: v.string(), document: v.string() }),
  JSON.parse(await Bun.stdin.text()),
)
try {
  const paths = createWorkspacePaths(input.filesystemRoot)
  const project = prepareWorkerProject(paths, input.root, input.document)
  if (isOutsideRoot(path.relative(input.root, project.config)))
    throw new Error(`Configuration is outside ${input.root}`)
  const compiler = await resolveTypeScriptCompiler(input.root)
  const listed = await runBoundedProcess({
    argv: [process.execPath, compiler.compiler, '-p', project.config, '--listFilesOnly'],
    cwd: input.root,
    timeoutMs: 50_000,
    maxOutputBytes: 16 * 1024 * 1024,
  })
  if (listed.limit) throw new Error(`Compiler listing limit: ${JSON.stringify(listed.limit)}`)
  const sources = listed.stdout.split('\n').filter((file) => path.isAbsolute(file))
  if (!sources.length) throw new Error(`Compiler returned no files for ${project.config}`)
  const files = [
    ...new Set([...sources, ...workerSupportFiles(project.parsed, sources, input.filesystemRoot)]),
  ]
  process.stdout.write(
    JSON.stringify({
      config: project.config,
      roots: project.parsed.fileNames.map(
        (file) => `/${paths.toRealRelative(file).replace(/^\/+/, '')}`,
      ),
      options: workerCompilerOptions(paths, project.parsed.options),
      files,
      runtime: { kind: compiler.kind, version: compiler.version },
    }),
  )
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
