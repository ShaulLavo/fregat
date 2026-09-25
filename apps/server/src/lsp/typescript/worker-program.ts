import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript-language-service'

import { isOutsideRoot, type WorkspacePaths } from '../../fs/path'
import { lspErrors } from '../errors'

export function prepareWorkerProject(paths: WorkspacePaths, root: string, documentPath: string) {
  const document = path.resolve(paths.workspaceRootReal, documentPath.replace(/^\/+/, ''))
  const system = boundedSystem(paths.workspaceRootReal)
  const config = ts.findConfigFile(path.dirname(document), system.fileExists)
  if (!config || isOutsideRoot(path.relative(root, config))) {
    throw lspErrors.PROGRAM_LIST_FAILED({
      internal: { documentPath, rootPath: root, reason: 'No project configuration' },
    })
  }
  const project = containingProject(config, document, new Set(), system)
  if (!project)
    throw lspErrors.PROGRAM_LIST_FAILED({
      internal: { documentPath, config, reason: 'No containing project' },
    })
  return project
}

function containingProject(
  config: string,
  document: string,
  visited: Set<string>,
  system: ts.System,
): { config: string; parsed: ts.ParsedCommandLine } | null {
  if (visited.has(config) || visited.size >= 32) return null
  visited.add(config)
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    { ...system, onUnRecoverableConfigFileDiagnostic: () => undefined },
  )
  if (!parsed) return null
  if (parsed.fileNames.includes(document)) return { config, parsed }
  for (const reference of parsed.projectReferences ?? []) {
    const referenced = containingProject(
      ts.resolveProjectReferencePath(reference),
      document,
      visited,
      system,
    )
    if (referenced) return referenced
  }
  return null
}

/** Resolve under logical link paths so the worker can read the same module names without a real filesystem. */
export function workerSupportFiles(
  project: ts.ParsedCommandLine,
  sourceFiles: readonly string[],
  filesystemRoot = '/',
) {
  const files = new Set<string>()
  const system = boundedSystem(filesystemRoot)
  const host: ts.ModuleResolutionHost = {
    ...system,
    realpath: (file) => file,
    readFile: (file) => {
      const text = system.readFile(file)
      if (text !== undefined) files.add(file)
      return text
    },
  }
  const options = { ...project.options, preserveSymlinks: true }
  const cache = ts.createModuleResolutionCache(
    ts.sys.getCurrentDirectory(),
    (file) => file,
    options,
  )
  const pending = [...sourceFiles]
  const visited = new Set<string>()
  for (let index = 0; index < pending.length; index++) {
    const file = pending[index]!
    if (visited.has(file)) continue
    visited.add(file)
    const text = host.readFile?.(file)
    if (text === undefined) continue
    const info = ts.preProcessFile(text, true, true)
    for (const imported of info.importedFiles) {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        file,
        options,
        host,
        cache,
      ).resolvedModule
      if (resolved && !visited.has(resolved.resolvedFileName))
        pending.push(resolved.resolvedFileName)
    }
    for (const reference of info.referencedFiles) {
      const resolved = path.resolve(path.dirname(file), reference.fileName)
      if (host.fileExists(resolved)) pending.push(resolved)
    }
    for (const reference of info.typeReferenceDirectives) {
      const resolved = ts.resolveTypeReferenceDirective(
        reference.fileName,
        file,
        options,
        host,
      ).resolvedTypeReferenceDirective
      if (resolved?.resolvedFileName) pending.push(resolved.resolvedFileName)
    }
  }
  return [...files]
}

export function workerCompilerOptions(paths: WorkspacePaths, options: ts.CompilerOptions) {
  const virtual = (file: string) => `/${paths.toRealRelative(file).replace(/^\/+/, '')}`
  const mapped: ts.CompilerOptions = { ...options, preserveSymlinks: false }
  for (const key of ['baseUrl', 'rootDir', 'outDir', 'configFilePath', 'pathsBasePath'] as const) {
    if (typeof mapped[key] === 'string') mapped[key] = virtual(mapped[key] as string)
  }
  for (const key of ['rootDirs', 'typeRoots'] as const) {
    if (mapped[key]) mapped[key] = mapped[key].map(virtual)
  }
  return mapped
}

function boundedSystem(filesystemRoot: string): ts.System {
  const read = new Set<string>()
  let bytes = 0
  return {
    ...ts.sys,
    readFile: (file) => {
      let real: string
      try {
        real = realpathSync(file)
      } catch {
        return undefined
      }
      if (isOutsideRoot(path.relative(filesystemRoot, real))) return undefined
      if (!read.has(file)) bytes += statSync(real).size
      read.add(file)
      if (read.size > 50_000 || bytes > 268_435_456)
        throw lspErrors.PROGRAM_LIST_LIMIT({ internal: { files: read.size, bytes } })
      return ts.sys.readFile(file)
    },
  }
}
