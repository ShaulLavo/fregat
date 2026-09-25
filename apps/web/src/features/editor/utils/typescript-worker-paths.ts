export function virtualPath(path: string) {
  return `/${path.replace(/^\/+/, '')}`
}
export function insideRoot(path: string, root: string) {
  const normalizedRoot = virtualPath(root).replace(/\/$/, '')
  const normalized = virtualPath(path)
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)
}

type Watch = {
  readonly include: readonly string[]
  readonly exclude: readonly string[]
  readonly allowJs: boolean
}
export function workerIncludedFile(path: string, watch: Watch): boolean {
  if (!/\.[cm]?tsx?$/.test(path) && !(watch.allowJs && /\.[cm]?jsx?$/.test(path))) return false
  const normalized = virtualPath(path)
  if (watch.exclude.some((pattern) => matches(normalized, pattern))) return false
  if (hasImplicitlyExcludedDirectory(normalized, watch.include)) return false
  return watch.include.some((pattern) => matches(normalized, pattern))
}

function hasImplicitlyExcludedDirectory(path: string, includes: readonly string[]): boolean {
  for (const part of path.split('/').slice(0, -1)) {
    if (
      !part.startsWith('.') &&
      !['node_modules', 'bower_components', 'jspm_packages'].includes(part)
    )
      continue
    if (
      !includes.some(
        (pattern) =>
          (pattern.includes(`/${part}/`) || pattern.endsWith(`/${part}`)) && matches(path, pattern),
      )
    )
      return true
  }
  return false
}

function matches(path: string, pattern: string): boolean {
  if (!/[?*]/.test(pattern))
    return path === pattern || path.startsWith(`${pattern.replace(/\/$/, '')}/`)
  let regex = '^'
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        regex += '(?:[^/]+/)*'
        index += 2
        continue
      }
      regex += '.*'
      index++
      continue
    }
    if (char === '*') {
      regex += '[^/]*'
      continue
    }
    if (char === '?') {
      regex += '[^/]'
      continue
    }
    regex += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  }
  return new RegExp(`${regex}$`).test(pattern.startsWith('/') ? path : path.replace(/^\//, ''))
}

export function workerIncludedDirectory(path: string, watch: Watch): boolean {
  const normalized = virtualPath(path).replace(/\/$/, '')
  if (
    watch.exclude.some(
      (pattern) => matches(normalized, pattern) || matches(`${normalized}/`, pattern),
    )
  )
    return false
  const intersects = watch.include.filter((pattern) =>
    directoryIntersectsPattern(normalized, pattern),
  )
  for (const part of normalized.split('/')) {
    if (
      !part.startsWith('.') &&
      !['node_modules', 'bower_components', 'jspm_packages'].includes(part)
    )
      continue
    if (
      !intersects.some((pattern) => pattern.includes(`/${part}/`) || pattern.endsWith(`/${part}`))
    )
      return false
  }
  return intersects.length > 0
}

function directoryIntersectsPattern(directory: string, pattern: string): boolean {
  const wildcard = pattern.search(/[?*]/)
  let prefix = wildcard < 0 ? pattern : pattern.slice(0, pattern.lastIndexOf('/', wildcard) + 1)
  if (wildcard < 0 && /\.[cm]?[jt]sx?$/.test(prefix))
    prefix = prefix.slice(0, prefix.lastIndexOf('/'))
  return insideRoot(directory, prefix) || insideRoot(prefix, directory)
}
