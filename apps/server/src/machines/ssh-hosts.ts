import { realpath, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { recordRequestContext } from '../observability'
import { createSshError } from './structured-errors'
import { isSelectableSshHost, parseSshConfig } from './utils/ssh-config'

export type SshConfigDirectories = {
  homeDirectory: string
  systemDirectory: string
}

type Discovery = SshConfigDirectories & {
  hosts: Set<string>
  visited: Set<string>
  bytes: number
  skippedIncludes: number
}

type ConfigFile = {
  filename: string
  includeDirectory: string
  depth: number
}

export async function discoverSshHosts(directories: SshConfigDirectories): Promise<string[]> {
  const discovery: Discovery = {
    ...directories,
    hosts: new Set(),
    visited: new Set(),
    bytes: 0,
    skippedIncludes: 0,
  }
  try {
    await readConfig(discovery, {
      filename: path.join(directories.homeDirectory, '.ssh/config'),
      includeDirectory: path.join(directories.homeDirectory, '.ssh'),
      depth: 0,
    })
    await readConfig(discovery, {
      filename: path.join(directories.systemDirectory, 'ssh_config'),
      includeDirectory: directories.systemDirectory,
      depth: 0,
    })
    return [...discovery.hosts].sort()
  } catch (cause) {
    throw createSshError('discovery', undefined, cause)
  } finally {
    recordRequestContext({
      sshDiscovery: {
        configFiles: discovery.visited.size,
        hosts: discovery.hosts.size,
        skippedIncludes: discovery.skippedIncludes,
      },
    })
  }
}

async function readConfig(discovery: Discovery, source: ConfigFile): Promise<void> {
  const filename = await existingConfigPath(source.filename)
  if (!filename) return
  const identity = `${source.includeDirectory}\0${filename}`
  if (discovery.visited.has(identity)) return
  if (source.depth > 32 || discovery.visited.size >= 1024)
    throw createSshError('discovery', 'Too many included configuration files.')
  const info = await stat(filename)
  if (!info.isFile())
    throw createSshError('discovery', 'A configuration path is not a regular file.')
  discovery.bytes += info.size
  if (discovery.bytes > 4 * 1024 * 1024)
    throw createSshError('discovery', 'SSH configuration exceeds the discovery size limit.')
  discovery.visited.add(identity)
  const directives = parseSshConfig(await readFile(filename, 'utf8'))
  for (const directive of directives) {
    if (directive.kind === 'host') {
      directive.values.filter(isSelectableSshHost).forEach((host) => discovery.hosts.add(host))
      continue
    }
    await readIncludes(discovery, source, directive.values)
  }
}

async function readIncludes(discovery: Discovery, source: ConfigFile, values: readonly string[]) {
  for (const value of values) {
    const pattern = includePattern(value, discovery.homeDirectory, source.includeDirectory)
    if (pattern === null) {
      discovery.skippedIncludes++
      continue
    }
    const filenames = await includedPaths(pattern)
    for (const filename of filenames)
      await readConfig(discovery, { ...source, filename, depth: source.depth + 1 })
  }
}

function includePattern(value: string, homeDirectory: string, includeDirectory: string) {
  let unresolved = false
  const expanded = value.replaceAll(/\$\{([^}]+)\}|%([a-zA-Z%])/g, (_match, variable, token) => {
    if (variable === 'HOME' || token === 'd') return homeDirectory
    if (token === '%') return '%'
    const replacement = variable ? process.env[variable] : undefined
    if (replacement !== undefined) return replacement
    unresolved = true
    return ''
  })
  if (unresolved) return null
  if (expanded.startsWith('~/')) return path.join(homeDirectory, expanded.slice(2))
  if (expanded.startsWith('~')) return null
  return path.resolve(includeDirectory, expanded)
}

async function includedPaths(pattern: string) {
  if (!/[*?[\]{]/.test(pattern)) return [pattern]
  const paths: string[] = []
  const matches = new Bun.Glob(pattern).scan({
    absolute: true,
    dot: true,
    onlyFiles: false,
    followSymlinks: true,
  })
  for await (const filename of matches) {
    if (paths.length >= 1024)
      throw createSshError('discovery', 'Too many included configuration files.')
    paths.push(filename)
  }
  return paths.sort()
}

async function existingConfigPath(filename: string) {
  try {
    return await realpath(filename)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}
