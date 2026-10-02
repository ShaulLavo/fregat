import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { isBuiltin } from 'node:module'
import { EvlogError } from 'evlog'
import { createScriptError, scriptFailureText } from '../../../scripts/structured-errors'
import {
  IMAGE_WORKER,
  PTY_HOST,
  REMOTE_SUPPORT,
  RUNTIME_LOCK,
  RUNTIME_MANIFEST,
  THIRD_PARTY_NOTICES,
  WATCH_WORKER,
} from '../../server/src/installation/release-files'

const releaseFiles = [
  'build-config.json',
  'bin/promote.js',
  'web/index.html',
  'server/index.js',
  'server/claude-discovery-worker.ts',
  ...[
    RUNTIME_MANIFEST,
    RUNTIME_LOCK,
    REMOTE_SUPPORT,
    PTY_HOST,
    WATCH_WORKER,
    IMAGE_WORKER,
    THIRD_PARTY_NOTICES,
  ].map((file) => `server/${file}`),
]

function requireEntry(root: string, name: string, kind: 'file' | 'directory', executable = false) {
  const entry = statSync(path.join(root, name))
  const valid = kind === 'file' ? entry.isFile() : entry.isDirectory()
  if (!valid) throw createScriptError(`${name} must be a ${kind}.`)
  if (executable && (entry.mode & 0o111) === 0)
    throw createScriptError(`${name} must be executable.`)
}

function contained(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function checkLink(root: string, link: string) {
  let current = path.dirname(link)
  const segments = [path.basename(link)]
  let followed = 0
  while (segments.length > 0) {
    const segment = segments.shift()!
    if (segment === '' || segment === '.') continue
    const next = path.join(current, segment)
    if (!contained(root, next))
      throw createScriptError(`Symlink escapes the app: ${path.relative(root, link)}.`)
    const entry = lstatSync(next)
    if (!entry.isSymbolicLink() && segments.length > 0 && !entry.isDirectory())
      throw createScriptError(`Symlink traverses a file: ${path.relative(root, link)}.`)
    if (!entry.isSymbolicLink()) {
      current = next
      continue
    }
    const target = readlinkSync(next)
    if (path.isAbsolute(target))
      throw createScriptError(`Absolute symlink prevents relocation: ${path.relative(root, next)}.`)
    followed++
    if (followed > 40)
      throw createScriptError(`Symlink chain is cyclic or too deep: ${path.relative(root, link)}.`)
    segments.unshift(...target.split(path.sep))
  }
  realpathSync(link)
}

function checkLinks(root: string) {
  const directories = [root]
  while (directories.length > 0) {
    const directory = directories.pop()!
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name)
      const entry = lstatSync(file)
      if (entry.isSymbolicLink()) checkLink(root, file)
      if (entry.isDirectory()) directories.push(file)
    }
  }
}

function checkPlist(file: string) {
  const xml = readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
  const dict = /^\s*<plist\s+version="1\.0">\s*<dict>([\s\S]*)<\/dict>\s*<\/plist>\s*$/.exec(
    xml,
  )?.[1]
  if (dict === undefined)
    throw createScriptError('Info.plist must contain an XML property dictionary.')
  const values = new Map<string, string | boolean>()
  const pair = /\s*<key>([^<]+)<\/key>\s*(?:<string>([^<]*)<\/string>|<(true|false)\s*\/>)/y
  let offset = 0
  while (dict.slice(offset).trim() !== '') {
    pair.lastIndex = offset
    const match = pair.exec(dict)
    if (!match) throw createScriptError('Info.plist contains an invalid property.')
    const key = match[1]!
    if (values.has(key)) throw createScriptError(`Info.plist contains duplicate ${key}.`)
    values.set(key, match[2] ?? match[3] === 'true')
    offset = pair.lastIndex
  }
  const required = new Map<string, string | boolean>([
    ['CFBundleIdentifier', 'dev.shaulavo.fregat'],
    ['CFBundleExecutable', 'fregat'],
    ['LSUIElement', true],
  ])
  for (const [key, value] of required) {
    if (values.get(key) !== value)
      throw createScriptError(`Info.plist ${key} must be ${String(value)}.`)
  }
}

function checkPromotion(release: string) {
  const source = readFileSync(path.join(release, 'bin/promote.js'), 'utf8')
  const imports = new Bun.Transpiler({ loader: 'js' }).scanImports(source)
  for (const dependency of imports) {
    const name = dependency.path
    if (isBuiltin(name) || name === 'bun' || name.startsWith('bun:')) continue
    throw createScriptError(`bin/promote.js must be self-contained; external import ${name}.`)
  }
}

export function checkApp(app: string): void {
  try {
    const root = realpathSync(app)
    requireEntry(root, 'Contents', 'directory')
    checkLinks(root)
    requireEntry(root, 'Contents/Info.plist', 'file')
    checkPlist(path.join(root, 'Contents/Info.plist'))
    requireEntry(root, 'Contents/MacOS/fregat', 'file', true)
    requireEntry(root, 'Contents/MacOS/platform-webview', 'file', true)
    requireEntry(root, 'Contents/Resources/Fregat.icns', 'file')
    const release = path.join(root, 'Contents/Resources/release')
    for (const name of releaseFiles) requireEntry(release, name, 'file')
    checkPromotion(release)
    for (const name of ['node_modules', 'server/node_modules', 'server/runtime/node_modules'])
      requireEntry(release, name, 'directory')
    const assets = path.join(release, 'web/assets')
    requireEntry(release, 'web/assets', 'directory')
    if (
      !readdirSync(assets).some(
        (name) => name.endsWith('.wasm') && statSync(path.join(assets, name)).isFile(),
      )
    )
      throw createScriptError('The release needs a WASM file in web/assets.')
  } catch (error) {
    if (error instanceof EvlogError) throw error
    throw createScriptError(`App verification failed: ${scriptFailureText(error)}`)
  }
}

if (import.meta.main) {
  try {
    const app = process.argv[2]
    if (!app || process.argv.length !== 3) throw createScriptError('Pass the path to Fregat.app.')
    checkApp(app)
    console.log('App bundle verified.')
  } catch (error) {
    console.error(scriptFailureText(error))
    process.exitCode = 1
  }
}
