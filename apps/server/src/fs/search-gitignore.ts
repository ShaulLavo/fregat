import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import ignore, { type Ignore } from 'ignore'

import { toPosix, type WorkspacePaths } from './path'

/**
 * Ignore semantics for the workspace index and the fallback walker.
 *
 * These have to agree with `fd` and `rg`, because the index *replaces* `fd` for
 * name search and prefilters `rg` for content search: any divergence means the
 * same query returns different results depending on whether the index happens to
 * be warm. So this reads what those tools read, in their precedence order —
 * nested ignore files included.
 */

// Highest precedence last: `ignore` applies last-match-wins, and ripgrep gives
// `.ignore` precedence over `.gitignore`.
const DIRECTORY_IGNORE_FILE_NAMES = ['.gitignore', '.ignore'] as const
const GIT_INFO_EXCLUDE_PATH = '.git/info/exclude'

export type GitIgnoreMatcherOptions = {
  /**
   * Whether to read the user's global git excludes. On in production, because
   * `fd` and `rg` read it and this has to match them. Off in tests, which must
   * not depend on whatever the developer happens to have in `~/.config/git/ignore`.
   */
  globalExcludes?: boolean
}

export type GitIgnoreMatcher = {
  /**
   * `isDirectory` matters: a `dist/` pattern matches the directory `dist` and not
   * a file named `dist`. Leave it undefined when the type is not known yet and
   * both readings are accepted, which is the conservative direction — it can
   * only ignore more, never leak an ignored path into results.
   */
  ignores(relativePath: string, isDirectory?: boolean): boolean
}

export async function workspaceGitIgnoreMatcher(
  paths: WorkspacePaths,
  options: GitIgnoreMatcherOptions = {},
): Promise<GitIgnoreMatcher> {
  const root = paths.workspaceRoot
  const globalExcludes = options.globalExcludes !== false
  // Per matcher, so a search started after a `.gitignore` edit sees the edit.
  // Ignore files are read lazily on first use of the directory that owns them.
  const rulesByDirectory = new Map<string, Ignore | null>()

  return {
    ignores(relativePath, isDirectory) {
      return pathIsIgnored(root, rulesByDirectory, relativePath, isDirectory, globalExcludes)
    },
  }
}

function pathIsIgnored(
  root: string,
  rulesByDirectory: Map<string, Ignore | null>,
  relativePath: string,
  isDirectory: boolean | undefined,
  globalExcludes: boolean,
) {
  const parts = ignorePathParts(relativePath)
  if (parts.length === 0) return false

  // An ignored directory ignores everything beneath it, and git will not descend
  // to let a deeper negation rescue anything — so the first ignored prefix wins.
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const prefix = parts.slice(0, depth)
    const prefixIgnored = prefixIsIgnored(
      root,
      rulesByDirectory,
      prefix,
      prefixIsDirectory(parts, depth, isDirectory),
      globalExcludes,
    )
    if (prefixIgnored) return true
  }

  return false
}

function prefixIsDirectory(
  parts: readonly string[],
  depth: number,
  isDirectory: boolean | undefined,
) {
  if (depth < parts.length) return true

  return isDirectory
}

function prefixIsIgnored(
  root: string,
  rulesByDirectory: Map<string, Ignore | null>,
  prefix: readonly string[],
  isDirectory: boolean | undefined,
  globalExcludes: boolean,
) {
  let ignored = false

  for (let depth = 0; depth < prefix.length; depth += 1) {
    const rules = directoryRules(
      root,
      rulesByDirectory,
      prefix.slice(0, depth).join('/'),
      globalExcludes,
    )
    if (!rules) continue

    // Each ignore file addresses paths relative to its own directory, and a
    // deeper file overrides a shallower one, so this walks root-first and keeps
    // the last opinion rather than returning early.
    const verdict = ignoreVerdict(rules, prefix.slice(depth).join('/'), isDirectory)
    if (verdict !== null) ignored = verdict
  }

  return ignored
}

function ignoreVerdict(rules: Ignore, candidate: string, isDirectory: boolean | undefined) {
  if (isDirectory !== true) {
    const verdict = testIgnore(rules, candidate)
    if (verdict !== null) return verdict
  }
  if (isDirectory === false) return null

  return testIgnore(rules, `${candidate}/`)
}

function testIgnore(rules: Ignore, candidate: string) {
  const result = rules.test(candidate)
  if (result.unignored) return false
  if (result.ignored) return true

  return null
}

function directoryRules(
  root: string,
  rulesByDirectory: Map<string, Ignore | null>,
  directory: string,
  globalExcludes: boolean,
) {
  const cached = rulesByDirectory.get(directory)
  if (cached !== undefined) return cached

  const rules = readDirectoryRules(root, directory, globalExcludes)
  rulesByDirectory.set(directory, rules)
  return rules
}

function readDirectoryRules(root: string, directory: string, globalExcludes: boolean) {
  let rules: Ignore | null = null

  for (const source of ignoreSourcePaths(root, directory, globalExcludes)) {
    const patterns = readIgnoreFile(source)
    if (patterns === null) continue

    rules ??= ignore()
    rules.add(patterns)
  }

  return rules
}

function ignoreSourcePaths(root: string, directory: string, globalExcludes: boolean) {
  const absoluteDirectory = path.join(root, directory)
  const directorySources = DIRECTORY_IGNORE_FILE_NAMES.map((name) =>
    path.join(absoluteDirectory, name),
  )
  if (directory !== '') return directorySources

  // Repository-wide sources, lowest precedence first.
  return [
    globalExcludes ? globalExcludesFile() : null,
    path.join(root, GIT_INFO_EXCLUDE_PATH),
  ].concat(directorySources)
}

function readIgnoreFile(absolutePath: string | null) {
  if (!absolutePath) return null

  try {
    return readFileSync(absolutePath, 'utf8')
  } catch {
    // Unreadable is indistinguishable from absent here, and both mean "no rules
    // from this source". A read error must not fail the search.
    return null
  }
}

let cachedGlobalExcludesFile: string | null | undefined

/**
 * `core.excludesFile`, resolved the way git resolves it. Read from the config
 * files directly rather than by spawning `git config`: a matcher is built per
 * search, and git may not be installed at all.
 */
function globalExcludesFile() {
  if (cachedGlobalExcludesFile !== undefined) return cachedGlobalExcludesFile

  cachedGlobalExcludesFile = resolveGlobalExcludesFile()
  return cachedGlobalExcludesFile
}

function resolveGlobalExcludesFile() {
  for (const configPath of gitConfigPaths()) {
    const configured = coreExcludesFile(readIgnoreFile(configPath))
    if (configured) return expandHomePath(configured)
  }

  return defaultGlobalExcludesFile()
}

function gitConfigPaths() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  const home = homedir()
  const xdgPath = xdgConfigHome
    ? path.join(xdgConfigHome, 'git', 'config')
    : path.join(home, '.config', 'git', 'config')

  return [path.join(home, '.gitconfig'), xdgPath]
}

function defaultGlobalExcludesFile() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) return path.join(xdgConfigHome, 'git', 'ignore')

  return path.join(homedir(), '.config', 'git', 'ignore')
}

function coreExcludesFile(config: string | null) {
  if (!config) return null

  let inCoreSection = false
  for (const rawLine of config.split(/\r?\n/u)) {
    const line = stripConfigComment(rawLine)
    const section = configSectionName(line)
    if (section !== null) {
      inCoreSection = section === 'core'
      continue
    }
    if (!inCoreSection) continue

    const value = configValue(line, 'excludesfile')
    if (value) return value
  }

  return null
}

function stripConfigComment(line: string) {
  return line.replace(/[#;].*$/u, '').trim()
}

function configSectionName(line: string) {
  const match = /^\[([^\]\s]+)/u.exec(line)
  if (!match?.[1]) return null

  return match[1].toLowerCase()
}

function configValue(line: string, key: string) {
  const separator = line.indexOf('=')
  if (separator < 0) return null
  if (line.slice(0, separator).trim().toLowerCase() !== key) return null

  return unquoteConfigValue(line.slice(separator + 1).trim())
}

function unquoteConfigValue(value: string) {
  if (value.length < 2) return value
  if (!value.startsWith('"') || !value.endsWith('"')) return value

  return value.slice(1, -1)
}

function expandHomePath(input: string) {
  if (input === '~') return homedir()
  if (!input.startsWith('~/')) return input

  return path.join(homedir(), input.slice(2))
}

function ignorePathParts(relativePath: string) {
  return toPosix(relativePath)
    .split('/')
    .filter((part) => part !== '' && part !== '.')
}
