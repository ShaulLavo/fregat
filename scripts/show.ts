import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createScriptError, scriptFailureText } from './structured-errors'

interface MeshResult {
  exitCode: number
  stdout: string
  stderr: string
}
interface ShowOptions {
  run?: (args: string[]) => MeshResult
}

const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']
const videoExtensions = ['.mp4', '.webm', '.mov']
const htmlExtensions = ['.html', '.htm']

function runMesh(args: string[]): MeshResult {
  if (!Bun.which('mesh'))
    throw createScriptError('Mesh is required to show files.', {
      why: 'The page is published as a private disposable mesh website.',
      fix: 'Install mesh and adopt this machine, then run the command again.',
    })
  const result = Bun.spawnSync(['mesh', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}

function copyAsset(file: string, destination: string) {
  if (lstatSync(file).isDirectory())
    cpSync(file, destination, {
      recursive: true,
      filter: (source) => {
        if (lstatSync(source).isSymbolicLink())
          throw createScriptError('HTML folders must contain regular files.', {
            why: 'A symbolic link can expose files outside the selected folder.',
            fix: 'Copy the intended assets into the HTML folder and run the command again.',
          })
        return true
      },
    })
  else copyFileSync(file, destination)
}

function section(file: string, index: number, directory: string) {
  const name = path.basename(file)
  const asset = `${index}-${name}`
  const folder = lstatSync(file).isDirectory()
  const href = escape(encodeURIComponent(asset) + (folder ? '/index.html' : ''))
  const label = escape(name)
  const extension = path.extname(file).toLowerCase()
  copyAsset(file, path.join(directory, asset))
  if (folder || htmlExtensions.includes(extension)) return `<p><a href="${href}">${label}</a></p>`
  if (imageExtensions.includes(extension))
    return `<figure><img src="${href}" alt="${label}"><figcaption>${label}</figcaption></figure>`
  if (videoExtensions.includes(extension))
    return `<figure><video src="${href}" controls></video><figcaption>${label}</figcaption></figure>`
  return `<p><a href="${href}">${label}</a></p>`
}

function validateFiles(files: readonly string[]) {
  if (!files.length)
    throw createScriptError('Choose files to show.', {
      why: 'The page needs at least one file.',
      fix: 'Run `bun run show <files…>`.',
    })
  for (const [index, file] of files.entries()) {
    let valid = false
    let folder = false
    try {
      const stat = lstatSync(file)
      folder = stat.isDirectory()
      valid = stat.isFile() || (folder && lstatSync(path.join(file, 'index.html')).isFile())
    } catch {
      /* Missing files and folders without index.html share the same guidance. */
    }
    if (!valid)
      throw createScriptError('A selected file is missing or unavailable.', {
        why: 'Every argument must name an existing file or a folder containing index.html.',
        fix: 'Check the file arguments and run the command again.',
        internal: { argumentIndex: index },
      })
  }
}

// An HTML page plus the files it names (its script, styles, images) is one site, not a gallery.
function pageWithAssets(files: readonly string[]) {
  const pages = files.filter((file) => htmlExtensions.includes(path.extname(file).toLowerCase()))
  if (files.length < 2 || pages.length !== 1) return
  const page = pages[0]!
  const assets = files.filter((file) => file !== page)
  const html = readFileSync(page, 'utf8')
  const names = assets.map((file) => path.basename(file))
  if (new Set(names).size !== names.length) return
  if (!names.every((name) => html.includes(name))) return
  return { page, assets }
}

function writePage(files: readonly string[], directory: string) {
  const site = pageWithAssets(files)
  if (site) {
    copyAsset(site.page, path.join(directory, 'index.html'))
    for (const asset of site.assets) copyAsset(asset, path.join(directory, path.basename(asset)))
    return
  }
  const first = files[0]!
  if (
    files.length === 1 &&
    (lstatSync(first).isDirectory() || htmlExtensions.includes(path.extname(first).toLowerCase()))
  ) {
    copyAsset(
      first,
      lstatSync(first).isDirectory() ? directory : path.join(directory, 'index.html'),
    )
    return
  }
  const sections = files.map((file, index) => section(file, index, directory))
  writeFileSync(
    path.join(directory, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(path.basename(files[0]!))}</title>
<style>:root{color-scheme:light dark}body{font:16px/1.55 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem}img,video{max-width:100%}figure{margin:1.5rem 0}figcaption{font-size:.85rem}</style></head><body><main>${sections.join('\n')}</main></body></html>`,
  )
}

export function showFiles(files: readonly string[], options: ShowOptions = {}) {
  validateFiles(files)
  const directory = mkdtempSync(path.join(tmpdir(), 'fregat-show-'))
  try {
    writePage(files, directory)
    const result = (options.run ?? runMesh)(['app', 'create', 'local', directory, '--json'])
    const failure = () =>
      createScriptError('Mesh could not publish the show page.', {
        why: 'Mesh must return a private app URL and its expiry after uploading the files.',
        fix: 'Check `mesh version` and this machine’s mesh connection, then run the command again.',
        internal: { exitCode: result.exitCode, stderr: result.stderr },
      })
    if (result.exitCode !== 0) throw failure()
    let published: { url?: string; app?: { expiresAt?: string; visibility?: string } }
    try {
      published = JSON.parse(result.stdout)
    } catch {
      throw failure()
    }
    if (
      !published?.url ||
      !URL.canParse(published.url) ||
      !published.app?.expiresAt ||
      !Number.isFinite(Date.parse(published.app.expiresAt)) ||
      published.app.visibility !== 'private'
    )
      throw failure()
    return { url: published.url, expiresAt: published.app.expiresAt }
  } finally {
    // Mesh uploads an archive into its managed workspace before create returns.
    rmSync(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  try {
    const result = showFiles(Bun.argv.slice(2))
    console.log(result.url)
    console.log(`Expires: ${result.expiresAt} (24 h idle lifetime)`)
  } catch (error) {
    console.error(scriptFailureText(error))
    process.exitCode = 1
  }
}
