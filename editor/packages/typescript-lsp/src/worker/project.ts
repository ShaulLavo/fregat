import ts from 'typescript'
import { isTypeScriptLspSourceFileName, sourcePathToFileName } from '../paths'
import { libraryFileName } from './libraries'
import { isRecord } from './protocol'

const REACT_JSX_RUNTIME_PACKAGE_JSON = '/node_modules/react/package.json'
const REACT_INDEX_TYPES = '/node_modules/react/index.d.ts'
const REACT_JSX_RUNTIME_TYPES = '/node_modules/react/jsx-runtime.d.ts'
const REACT_JSX_RUNTIME_FALLBACK_PACKAGE_JSON = `{"name":"react","version":"0.0.0","type":"module","exports":{"./jsx-runtime":"./jsx-runtime.d.ts",".":"./index.d.ts"}}`
const REACT_INDEX_FALLBACK_TYPES = `export type ReactNode = unknown;
export type Key = string | number;
export interface Attributes {
  key?: Key | null | undefined;
}
export const Fragment: unique symbol;
`
const REACT_JSX_RUNTIME_FALLBACK_TYPES = `export namespace JSX {
  export interface Element {}
  export interface ElementClass {}
  export interface ElementAttributesProperty {
    props: {};
  }
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicAttributes {
    key?: string | number | null | undefined;
  }
  export interface IntrinsicElements {
    [elementName: string]: any;
  }
}

export const Fragment: unique symbol;
export function jsx(type: unknown, props: unknown, key?: string): JSX.Element;
export function jsxs(type: unknown, props: unknown, key?: string): JSX.Element;
`

export type ProjectConfig = {
  readonly compilerOptions: ts.CompilerOptions
  readonly fileNames: readonly string[]
}

export type WorkspacePackage = {
  readonly name: string
  readonly root: string
}

export type WorkspaceFiles = ReadonlyMap<string, string>

function defaultCompilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    allowJs: true,
    checkJs: false,
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
  }
}

/** A `lib` given as `ES2024` in initialization options reaches the program as `lib.es2024.d.ts`. */
export function resolvedCompilerOptions(
  projectConfig: ProjectConfig | null,
  override: ts.CompilerOptions,
): ts.CompilerOptions {
  const options = {
    ...defaultCompilerOptions(),
    ...projectConfig?.compilerOptions,
    ...override,
  }
  if (!options.lib) return options
  return { ...options, lib: options.lib.map(libraryFileName) }
}

/** Every file the program can read: libs, workspace files and their package mirrors, fallbacks. */
export function projectFileMap(
  libraryFiles: ReadonlyMap<string, string>,
  workspaceFiles: WorkspaceFiles,
): Map<string, string> {
  const fsMap = new Map(libraryFiles)
  for (const [fileName, text] of workspaceFiles) fsMap.set(fileName, text)
  for (const workspacePackage of workspacePackages(workspaceFiles)) {
    addWorkspacePackageMirror(fsMap, workspaceFiles, workspacePackage)
  }
  setFallbackFile(fsMap, REACT_JSX_RUNTIME_PACKAGE_JSON, REACT_JSX_RUNTIME_FALLBACK_PACKAGE_JSON)
  setFallbackFile(fsMap, REACT_INDEX_TYPES, REACT_INDEX_FALLBACK_TYPES)
  setFallbackFile(fsMap, REACT_JSX_RUNTIME_TYPES, REACT_JSX_RUNTIME_FALLBACK_TYPES)
  return fsMap
}

/** Where a workspace file also appears as `node_modules/<package>/…`, so a change reaches both. */
export function mirrorPaths(packages: readonly WorkspacePackage[], fileName: string): string[] {
  return packages.flatMap((workspacePackage) => {
    const rootPrefix = `${workspacePackage.root}/`
    if (!isPackageFile(fileName, workspacePackage.root, rootPrefix)) return []
    return [`/node_modules/${workspacePackage.name}/${fileName.slice(rootPrefix.length)}`]
  })
}

/** Files that decide options, roots or package mirrors: changing one rebuilds the project. */
export function isProjectShapeFile(fileName: string): boolean {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1)
  return base === 'package.json' || /^[tj]sconfig(\..*)?\.json$/.test(base)
}

function setFallbackFile(fsMap: Map<string, string>, fileName: string, text: string): void {
  if (fsMap.has(fileName)) return
  fsMap.set(fileName, text)
}

function addWorkspacePackageMirror(
  fsMap: Map<string, string>,
  workspaceFiles: WorkspaceFiles,
  workspacePackage: WorkspacePackage,
): void {
  const rootPrefix = `${workspacePackage.root}/`
  const nodeModuleRoot = `/node_modules/${workspacePackage.name}`

  for (const [fileName, text] of workspaceFiles) {
    if (!isPackageFile(fileName, workspacePackage.root, rootPrefix)) continue

    const relativePath = fileName.slice(rootPrefix.length)
    fsMap.set(`${nodeModuleRoot}/${relativePath}`, text)
  }
}

function isPackageFile(fileName: string, root: string, rootPrefix: string): boolean {
  return fileName === `${root}/package.json` || fileName.startsWith(rootPrefix)
}

/** A scan of every file and a parse of every package.json: compute once, not per changed file. */
export function workspacePackages(workspaceFiles: WorkspaceFiles): readonly WorkspacePackage[] {
  return Array.from(workspaceFiles.entries()).flatMap(([fileName, text]) =>
    workspacePackageFromFile(fileName, text),
  )
}

function workspacePackageFromFile(fileName: string, text: string): readonly WorkspacePackage[] {
  if (!fileName.endsWith('/package.json')) return []

  const name = packageJsonName(text)
  if (!name) return []

  return [{ name, root: directoryName(fileName) }]
}

function packageJsonName(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) return null
    return typeof parsed.name === 'string' ? parsed.name : null
  } catch {
    return null
  }
}

/** The workspace path a result names, where TypeScript reached it through a package mirror. */
export function workspaceFileNameForResult(
  workspaceFiles: WorkspaceFiles,
  packages: readonly WorkspacePackage[],
  fileName: string,
): string {
  const normalized = sourcePathToFileName(fileName)
  if (workspaceFiles.has(normalized)) return normalized
  return workspaceFileNameFromNodeModulesMirror(workspaceFiles, packages, normalized) ?? normalized
}

function workspaceFileNameFromNodeModulesMirror(
  workspaceFiles: WorkspaceFiles,
  packages: readonly WorkspacePackage[],
  fileName: string,
): string | null {
  if (!fileName.startsWith('/node_modules/')) return null

  for (const workspacePackage of packages) {
    const prefix = `/node_modules/${workspacePackage.name}/`
    if (!fileName.startsWith(prefix)) continue

    const candidate = `${workspacePackage.root}/${fileName.slice(prefix.length)}`
    if (workspaceFiles.has(candidate)) return candidate
  }

  return null
}

/** The tsconfig's files, or without one every workspace source file; open documents join later. */
export function rootFileNames(
  workspaceFiles: WorkspaceFiles,
  projectConfig: ProjectConfig | null,
): string[] {
  const roots = projectConfig?.fileNames ?? Array.from(workspaceFiles.keys())
  return roots.filter(isTypeScriptLspSourceFileName)
}

export function readProjectConfig(
  workspaceFiles: WorkspaceFiles,
  report: (diagnostic: ts.Diagnostic) => void,
): ProjectConfig | null {
  const configFileName = projectConfigFileName(workspaceFiles)
  if (!configFileName) return null

  const text = workspaceFiles.get(configFileName)
  if (text === undefined) return null

  const parsed = ts.parseConfigFileTextToJson(configFileName, text)
  if (parsed.error) {
    report(parsed.error)
    return null
  }

  const config = ts.parseJsonConfigFileContent(
    parsed.config as object,
    parseConfigHost(workspaceFiles),
    directoryName(configFileName),
    undefined,
    configFileName,
  )
  for (const error of config.errors) report(error)
  return {
    compilerOptions: config.options,
    fileNames: config.fileNames.map(sourcePathToFileName),
  }
}

function projectConfigFileName(workspaceFiles: WorkspaceFiles): string | null {
  if (workspaceFiles.has('/tsconfig.json')) return '/tsconfig.json'
  return (
    Array.from(workspaceFiles.keys())
      .filter((fileName) => fileName.endsWith('/tsconfig.json'))
      .toSorted((left, right) => left.length - right.length || left.localeCompare(right))[0] ?? null
  )
}

function parseConfigHost(workspaceFiles: WorkspaceFiles): ts.ParseConfigHost {
  return {
    useCaseSensitiveFileNames: true,
    fileExists: (fileName) => workspaceFiles.has(sourcePathToFileName(fileName)),
    readFile: (fileName) => workspaceFiles.get(sourcePathToFileName(fileName)),
    readDirectory: (rootDir, extensions) =>
      readWorkspaceDirectory(workspaceFiles, rootDir, extensions ?? []),
  }
}

function readWorkspaceDirectory(
  workspaceFiles: WorkspaceFiles,
  rootDir: string,
  extensions: readonly string[],
): string[] {
  const root = sourcePathToFileName(rootDir)
  return Array.from(workspaceFiles.keys()).filter((fileName) =>
    isConfigDirectoryMatch(fileName, root, extensions),
  )
}

function isConfigDirectoryMatch(
  fileName: string,
  root: string,
  extensions: readonly string[],
): boolean {
  if (!isWithinConfigRoot(fileName, root)) return false
  if (extensions.length === 0) return true
  return extensions.some((extension) => fileName.endsWith(extension))
}

function isWithinConfigRoot(fileName: string, root: string): boolean {
  if (root === '/') return true
  return fileName === root || fileName.startsWith(`${root}/`)
}

function directoryName(fileName: string): string {
  const index = fileName.lastIndexOf('/')
  if (index <= 0) return '/'
  return fileName.slice(0, index)
}
