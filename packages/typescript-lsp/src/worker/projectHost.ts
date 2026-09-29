import ts from 'typescript'

const ROOT = '/'

/** What request handlers read: the language service and the program's view of one file. */
export type ProjectService = {
  readonly languageService: ts.LanguageService
  getSourceFile(fileName: string): ts.SourceFile | undefined
}

/**
 * The files one TypeScript program sees, held in memory and changed one file at a time.
 *
 * Every file carries a version, so after an upsert the language service reparses that file and
 * reuses every other one; nothing here rebuilds the program from scratch. Open documents sit over
 * the files: their text wins until they close, and closing falls back to the file, if there is one.
 * Logical package links resolve to one canonical file, including unsaved document overlays.
 */
export class ProjectHost implements ProjectService {
  public readonly languageService: ts.LanguageService
  readonly #files: Map<string, string>
  readonly #logicalFiles = new Map<string, Map<string, string>>()
  readonly #openOwners = new Map<string, Map<string, { path: string; text: string }>>()
  readonly #open = new Map<string, string>()
  readonly #versions = new Map<string, number>()
  readonly #directories = new Set<string>([ROOT])
  #roots: readonly string[]
  #projectVersion = 0

  public constructor(
    files: Map<string, string>,
    roots: readonly string[],
    private readonly options: ts.CompilerOptions,
    private readonly canonicalPaths: Readonly<Record<string, string>> = {},
  ) {
    this.#files = new Map()
    for (const [fileName, text] of files) {
      const canonical = this.canonical(fileName)
      const logical = this.#logicalFiles.get(canonical) ?? new Map<string, string>()
      logical.set(fileName, text)
      this.#logicalFiles.set(canonical, logical)
      this.#files.set(canonical, files.get(canonical) ?? text)
    }
    this.#roots = [...new Set(roots.map((file) => this.canonical(file)))]
    for (const fileName of files.keys()) this.#addDirectories(fileName)
    this.languageService = ts.createLanguageService(this.#host())
  }

  public getSourceFile(fileName: string): ts.SourceFile | undefined {
    return this.languageService.getProgram()?.getSourceFile(this.canonical(fileName))
  }

  public setFile(fileName: string, text: string): void {
    const canonical = this.canonical(fileName)
    const logical = this.#logicalFiles.get(canonical) ?? new Map<string, string>()
    const added = !logical.has(fileName)
    logical.set(fileName, text)
    this.#logicalFiles.set(canonical, logical)
    this.#addDirectories(fileName)
    if (added) this.languageService.cleanupSemanticCache()
    if (!added && this.#files.get(canonical) === text) return
    this.#files.set(canonical, text)
    this.#changed(canonical)
  }

  public deleteFile(fileName: string): void {
    const canonical = this.canonical(fileName)
    const logical = this.#logicalFiles.get(canonical)
    if (!logical?.delete(fileName)) return
    // Cached imports must stop resolving a removed logical path, even when its source survives.
    this.languageService.cleanupSemanticCache()
    const remaining = logical.get(canonical) ?? [...logical.values()].at(-1)
    if (remaining === undefined) {
      this.#logicalFiles.delete(canonical)
      this.#files.delete(canonical)
    } else this.#files.set(canonical, remaining)
    this.#changed(canonical)
  }

  public setOpen(fileName: string, text: string, owner = fileName): void {
    const canonical = this.canonical(fileName)
    const owners =
      this.#openOwners.get(canonical) ?? new Map<string, { path: string; text: string }>()
    owners.delete(owner)
    owners.set(owner, { path: fileName, text })
    this.#openOwners.set(canonical, owners)
    this.#addDirectories(fileName)
    if (this.#open.get(canonical) === text) return
    this.#open.set(canonical, text)
    this.#changed(canonical)
  }

  public closeOpen(fileName: string, owner = fileName): void {
    const canonical = this.canonical(fileName)
    const owners = this.#openOwners.get(canonical)
    if (!owners?.delete(owner)) return
    const remaining = [...owners.values()].at(-1)
    if (remaining) this.#open.set(canonical, remaining.text)
    else {
      this.#openOwners.delete(canonical)
      this.#open.delete(canonical)
    }
    this.#changed(canonical)
  }

  public setRoots(roots: readonly string[]): void {
    roots = [...new Set(roots.map((file) => this.canonical(file)))]
    if (sameList(this.#roots, roots)) return
    this.#roots = roots
    this.#projectVersion += 1
  }

  #changed(fileName: string): void {
    this.#versions.set(fileName, (this.#versions.get(fileName) ?? 0) + 1)
    this.#projectVersion += 1
  }

  private canonical(fileName: string): string {
    return this.canonicalPaths[fileName] ?? fileName
  }

  #text(fileName: string): string | undefined {
    if (!this.#exists(fileName)) return undefined
    const canonical = this.canonical(fileName)
    return this.#open.get(canonical) ?? this.#files.get(canonical)
  }

  // A surviving alias keeps the shared text, but a deleted canonical name must stop resolving.
  #exists(fileName: string): boolean {
    const canonical = this.canonical(fileName)
    if (fileName === canonical && this.#openOwners.has(canonical)) return true
    if (this.#logicalFiles.get(canonical)?.has(fileName)) return true
    const owners = this.#openOwners.get(canonical)?.values() ?? []
    return [...owners].some((owner) => owner.path === fileName)
  }

  #addDirectories(fileName: string): void {
    for (
      let index = fileName.lastIndexOf('/');
      index > 0;
      index = fileName.lastIndexOf('/', index - 1)
    ) {
      const directory = fileName.slice(0, index)
      if (this.#directories.has(directory)) return
      this.#directories.add(directory)
    }
  }

  #host(): ts.LanguageServiceHost {
    return {
      getCompilationSettings: () => this.options,
      getProjectVersion: () => String(this.#projectVersion),
      getScriptFileNames: () => [...this.#roots, ...this.#openOutsideRoots()],
      getScriptVersion: (fileName) => String(this.#versions.get(this.canonical(fileName)) ?? 0),
      getScriptSnapshot: (fileName) => {
        const text = this.#text(fileName)
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
      },
      getCurrentDirectory: () => ROOT,
      getDefaultLibFileName: (options) => `${ROOT}${ts.getDefaultLibFileName(options)}`,
      fileExists: (fileName) => this.#text(fileName) !== undefined,
      readFile: (fileName) => this.#text(fileName),
      directoryExists: (directory) => this.#directories.has(trimSlash(directory)),
      getDirectories: (directory) => this.#childDirectories(trimSlash(directory)),
      readDirectory: (directory, extensions) =>
        this.#readDirectory(trimSlash(directory), extensions),
      realpath: (fileName) => this.canonical(fileName),
      useCaseSensitiveFileNames: () => true,
    }
  }

  /** An open document outside the project's roots is still a file the client asks about. */
  #openOutsideRoots(): string[] {
    const roots = new Set(this.#roots)
    return Array.from(this.#open.keys()).filter((fileName) => !roots.has(fileName))
  }

  #childDirectories(parent: string): string[] {
    const prefix = parent === ROOT ? ROOT : `${parent}/`
    const children: string[] = []
    for (const directory of this.#directories) {
      if (!directory.startsWith(prefix) || directory === parent) continue
      const rest = directory.slice(prefix.length)
      if (!rest.includes('/')) children.push(rest)
    }
    return children
  }

  #readDirectory(directory: string, extensions: readonly string[] | undefined): string[] {
    const prefix = directory === ROOT ? ROOT : `${directory}/`
    return Array.from(this.#files.keys()).filter(
      (fileName) =>
        fileName.startsWith(prefix) &&
        this.#exists(fileName) &&
        (!extensions || extensions.some((extension) => fileName.endsWith(extension))),
    )
  }
}

function trimSlash(directory: string): string {
  if (directory.length > 1 && directory.endsWith('/')) return directory.slice(0, -1)
  return directory
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
