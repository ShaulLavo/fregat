import path from 'node:path'
import { createHash } from 'node:crypto'
import * as v from 'valibot'
import { createWorkspacePaths, isOutsideRoot } from '../../fs/path'
import { runBoundedProcess } from '../../git/utils/process'
import { prepareWorkerProject, workerCompilerOptions, workerSupportFiles } from './worker-program'
import { resolveTypeScriptCompiler } from './runtime'
import { lspErrors } from '../../observability/structured-errors'
import { serializeDiscoveryError } from './worker-discovery-errors'

const input = v.parse(
  v.object({
    root: v.string(),
    filesystemRoot: v.string(),
    document: v.string(),
    tsconfig: v.optional(v.string()),
    mode: v.optional(v.picklist(['resolve', 'list']), 'list'),
  }),
  JSON.parse(await Bun.stdin.text()),
)
try {
  const paths = createWorkspacePaths(input.filesystemRoot)
  const project = prepareWorkerProject(paths, input.root, input.document, input.tsconfig)
  if (isOutsideRoot(path.relative(input.root, project.config)))
    throw lspErrors.PROGRAM_TSCONFIG_OUTSIDE_ROOT({
      internal: { root: input.root, config: project.config },
    })
  if (input.mode === 'resolve') {
    process.stdout.write(JSON.stringify(projectMetadata(paths, project)))
  } else {
    await listProject(paths, project)
  }
} catch (error) {
  process.stderr.write(serializeDiscoveryError(error))
  process.exitCode = 1
}

async function listProject(
  paths: ReturnType<typeof createWorkspacePaths>,
  project: ReturnType<typeof prepareWorkerProject>,
) {
  const compiler = await resolveTypeScriptCompiler(input.root)
  const listed = await runBoundedProcess({
    argv: [process.execPath, compiler.compiler, '-p', project.config, '--listFilesOnly'],
    cwd: input.root,
    timeoutMs: 50_000,
    maxOutputBytes: 16 * 1024 * 1024,
  })
  if (listed.limit)
    throw lspErrors.PROGRAM_LIST_LIMIT({
      internal: { limit: listed.limit, config: project.config },
    })
  const sources = listed.stdout.split('\n').filter((file) => path.isAbsolute(file))
  if (!sources.length)
    throw lspErrors.PROGRAM_LIST_FAILED({
      internal: {
        config: project.config,
        exitCode: listed.exitCode,
        diagnosticCodes: listed.stdout.match(/\bTS\d+\b/g) ?? [],
      },
    })
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
}

function projectMetadata(
  paths: ReturnType<typeof createWorkspacePaths>,
  project: ReturnType<typeof prepareWorkerProject>,
) {
  const raw = v.parse(
    v.object({
      include: v.optional(v.array(v.string())),
      exclude: v.optional(v.array(v.string())),
      files: v.optional(v.array(v.string())),
    }),
    project.parsed.raw ?? {},
  )
  const virtual = (file: string) => `/${paths.toRealRelative(file).replace(/^\/+/, '')}`
  const pattern = (value: string) =>
    virtual(
      path.resolve(
        path.dirname(project.config),
        value.replaceAll('${configDir}', path.dirname(project.config)),
      ),
    )
  const include = raw.include ?? (raw.files ? [] : ['**/*'])
  const exclude =
    raw.exclude ??
    [project.parsed.options.outDir, project.parsed.options.declarationDir].filter(
      (value): value is string => Boolean(value),
    )
  return {
    optionsVersion: createHash('sha256')
      .update(JSON.stringify(workerCompilerOptions(paths, project.parsed.options)))
      .digest('hex'),
    config: virtual(project.config),
    roots: project.parsed.fileNames.map(virtual),
    watch: {
      include: include.map(pattern),
      exclude: exclude.map(pattern),
      configFiles: project.configFiles.map(virtual),
      allowJs: project.parsed.options.allowJs ?? false,
    },
  }
}
