/*
 * The worker half of `fileProvider.ts`: one TypeScript language service over a project the host
 * owns, reading it either from a preloaded map or synchronously from the host, one call at a time.
 */

import ts from 'typescript'
import { heapSize } from 'bun:jsc'

declare const self: Worker

type Strategy = 'preload' | 'pull-project' | 'pull-open'

type Start = {
  readonly strategy: Strategy
  readonly projectDirectory: string
  readonly configFile: string
  readonly target: string
  readonly control?: SharedArrayBuffer
  readonly data?: SharedArrayBuffer
  readonly preload?: PreloadBundle
}

export type PreloadBundle = {
  readonly files: Record<string, string>
  readonly directories: readonly string[]
  readonly realpaths: Record<string, string>
  readonly roots: readonly string[]
  readonly options: ts.CompilerOptions
}

type FileSystem = {
  fileExists(path: string): boolean
  readFile(path: string): string | undefined
  directoryExists(path: string): boolean
  getDirectories(path: string): string[]
  realpath(path: string): string
  readDirectory(
    path: string,
    extensions?: readonly string[],
    exclude?: readonly string[],
    include?: readonly string[],
    depth?: number,
  ): string[]
  invalidate(paths: readonly string[]): void
  upsert(path: string, text: string): void
  readonly calls: number
  readonly bytes: number
}

const decoder = new TextDecoder()
const versions = new Map<string, number>()
let fileSystem: FileSystem
let service: ts.LanguageService
let target = ''

self.onmessage = (event: MessageEvent) => {
  const message = event.data as { type: string }
  if (message.type === 'start') start(event.data as Start)
  if (message.type === 'burst') burst(event.data as { edits: { path: string; text?: string }[] })
}

function start(message: Start): void {
  const started = performance.now()
  target = message.target
  fileSystem =
    message.strategy === 'preload'
      ? preloadFileSystem(message.preload as PreloadBundle)
      : pullFileSystem(message.control as SharedArrayBuffer, message.data as SharedArrayBuffer)
  const project =
    message.strategy === 'preload'
      ? {
          roots: [...(message.preload as PreloadBundle).roots],
          options: (message.preload as PreloadBundle).options,
        }
      : parseProject(message.configFile, message.projectDirectory)
  const roots = message.strategy === 'pull-open' ? [message.target] : project.roots
  service = ts.createLanguageService(host(roots, project.options, message.projectDirectory))
  const configured = performance.now()
  const diagnostics = diagnosticsFor(target)
  const finished = performance.now()
  Bun.gc(true)
  self.postMessage({
    type: 'started',
    configureMs: configured - started,
    firstDiagnosticsMs: finished - started,
    diagnostics: diagnostics.length,
    programFiles: service.getProgram()?.getSourceFiles().length ?? 0,
    hostCalls: fileSystem.calls,
    bytesRead: fileSystem.bytes,
    heapBytes: heapSize(),
  })
}

function burst(message: { edits: { path: string; text?: string }[] }): void {
  const started = performance.now()
  for (const edit of message.edits) {
    versions.set(edit.path, (versions.get(edit.path) ?? 0) + 1)
    if (edit.text === undefined) continue
    fileSystem.upsert(edit.path, edit.text)
  }
  fileSystem.invalidate(
    message.edits.filter((edit) => edit.text === undefined).map((edit) => edit.path),
  )
  const callsBefore = fileSystem.calls
  const diagnostics = diagnosticsFor(target)
  self.postMessage({
    type: 'burst',
    requestMs: performance.now() - started,
    diagnostics: diagnostics.length,
    hostCalls: fileSystem.calls - callsBefore,
  })
}

function diagnosticsFor(fileName: string): readonly ts.Diagnostic[] {
  return [...service.getSyntacticDiagnostics(fileName), ...service.getSemanticDiagnostics(fileName)]
}

function host(
  roots: readonly string[],
  options: ts.CompilerOptions,
  currentDirectory: string,
): ts.LanguageServiceHost {
  return {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...roots],
    getScriptVersion: (fileName) => String(versions.get(fileName) ?? 0),
    getScriptSnapshot: (fileName) => {
      const text = fileSystem.readFile(fileName)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => currentDirectory,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    fileExists: (path) => fileSystem.fileExists(path),
    readFile: (path) => fileSystem.readFile(path),
    directoryExists: (path) => fileSystem.directoryExists(path),
    getDirectories: (path) => fileSystem.getDirectories(path),
    readDirectory: (path, extensions, exclude, include, depth) =>
      fileSystem.readDirectory(path, extensions, exclude, include, depth),
    realpath: (path) => fileSystem.realpath(path),
    useCaseSensitiveFileNames: () => true,
  }
}

function parseProject(
  configFile: string,
  projectDirectory: string,
): { roots: string[]; options: ts.CompilerOptions } {
  const text = fileSystem.readFile(configFile) ?? '{}'
  const json = ts.parseConfigFileTextToJson(configFile, text).config as object
  const parsed = ts.parseJsonConfigFileContent(
    json,
    {
      useCaseSensitiveFileNames: true,
      fileExists: (path) => fileSystem.fileExists(path),
      readFile: (path) => fileSystem.readFile(path),
      readDirectory: (path, extensions, exclude, include, depth) =>
        fileSystem.readDirectory(path, extensions, exclude, include, depth),
    },
    projectDirectory,
    undefined,
    configFile,
  )
  return { roots: parsed.fileNames, options: { ...parsed.options, noEmit: true } }
}

function preloadFileSystem(bundle: PreloadBundle): FileSystem {
  const files = new Map(Object.entries(bundle.files))
  const directories = new Set(bundle.directories)
  const realpaths = new Map(Object.entries(bundle.realpaths))
  return {
    calls: 0,
    bytes: 0,
    fileExists: (path) => files.has(path),
    readFile: (path) => files.get(path),
    directoryExists: (path) => directories.has(path),
    getDirectories: (path) => childDirectories(directories, path),
    realpath: (path) => realpaths.get(path) ?? path,
    readDirectory: () => [...bundle.roots],
    invalidate: () => undefined,
    upsert: (path, text) => {
      files.set(path, text)
    },
  }
}

function childDirectories(directories: ReadonlySet<string>, parent: string): string[] {
  const prefix = parent.endsWith('/') ? parent : `${parent}/`
  const children: string[] = []
  for (const directory of directories) {
    if (!directory.startsWith(prefix)) continue
    const rest = directory.slice(prefix.length)
    if (rest.length > 0 && !rest.includes('/')) children.push(rest)
  }
  return children
}

/**
 * Every call is one blocking round trip: post the question, sleep on the control word until the
 * host has written the answer into the shared buffer. Answers are cached until invalidated, which
 * is what a real provider would have to do to be usable at all.
 */
function pullFileSystem(control: SharedArrayBuffer, data: SharedArrayBuffer): FileSystem {
  const state = new Int32Array(control)
  const bytes = new Uint8Array(data)
  const cache = new Map<string, unknown>()
  let calls = 0
  let bytesRead = 0

  const ask = <T>(op: string, path: string, extra?: unknown): T => {
    const key = `${op}\u0000${path}\u0000${extra === undefined ? '' : JSON.stringify(extra)}`
    if (cache.has(key)) return cache.get(key) as T
    calls += 1
    Atomics.store(state, 0, 0)
    self.postMessage({ type: 'fs', op, path, extra })
    Atomics.wait(state, 0, 0)
    const length = Atomics.load(state, 1)
    bytesRead += length
    const answer = JSON.parse(decoder.decode(bytes.slice(0, length))) as T
    cache.set(key, answer)
    return answer
  }

  return {
    get calls() {
      return calls
    },
    get bytes() {
      return bytesRead
    },
    fileExists: (path) => ask<boolean>('fileExists', path),
    readFile: (path) => ask<string | null>('readFile', path) ?? undefined,
    directoryExists: (path) => ask<boolean>('directoryExists', path),
    getDirectories: (path) => ask<string[]>('getDirectories', path),
    realpath: (path) => ask<string>('realpath', path),
    readDirectory: (path, extensions, exclude, include, depth) =>
      ask<string[]>('readDirectory', path, { extensions, exclude, include, depth }),
    invalidate: (paths) => {
      for (const path of paths) cache.delete(`readFile\u0000${path}\u0000`)
    },
    upsert: () => undefined,
  }
}
