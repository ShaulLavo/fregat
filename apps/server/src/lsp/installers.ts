import { virtualEnvironmentPaths } from './environment'
import { exists } from './environment'
import { firstExistingPath } from './environment'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { createHash } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { lspErrors } from '../observability'
import {
  pinnedLspRuntimeManifest,
  type PinnedLspRuntimeId,
  type PinnedLspRuntimeManifestEntry,
} from './installer-manifest'
import type { LspServerHandle } from './registry'
import { platformHomePath } from '../home'

type CommandOptions = {
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
}

type GitHubAssetRelease = {
  readonly assets?: readonly {
    readonly browser_download_url?: string
    readonly name?: string
  }[]
  readonly name?: string
  readonly tag_name?: string
}

type HashiCorpRelease = {
  readonly builds?: readonly {
    readonly arch?: string
    readonly os?: string
    readonly url?: string
  }[]
  readonly version?: string
}

const lspRoot = platformHomePath('lsp')
const nodePackageRoot = path.join(lspRoot, 'node')
const toolRoot = path.join(lspRoot, 'bin')
const nodePackageBin = path.join(nodePackageRoot, 'node_modules', '.bin')
/**
 * Whether missing language servers may be downloaded.
 *
 * Module-level rather than a parameter because the check sits eleven frames
 * deep behind twenty `spawn` closures in `registry.ts`, none of which carry
 * settings. Held as a *getter* so a settings write takes effect without a
 * restart, and defaulted from the registry so a test that never calls
 * `setLspDownloadPolicy` behaves like a default install.
 */
let readDownloadRuntimes: () => boolean = () => DEFAULT_SETTING_VALUES['lsp.downloadRuntimes']

export function setLspDownloadPolicy(read: () => boolean): void {
  readDownloadRuntimes = read
}

/**
 * Exported for the polarity test only. The setting reads "may download"; every
 * one of the eleven call sites asks "must not download", and a missing `!` here
 * would silently stop the product downloading any language server with every
 * other gate still green.
 */
export function downloadsDisabled(): boolean {
  return !readDownloadRuntimes()
}

export async function spawnNodePackageBin(
  packageName: string,
  commandName: string,
  args: readonly string[],
  options: CommandOptions,
) {
  const bin = await resolvePackageBinary(packageName, commandName)
  if (!bin) return null

  return spawnCommand([bin].concat(args), options)
}

export async function spawnBiome(root: string) {
  const local = await existingPath(path.join(root, 'node_modules', '.bin', executableName('biome')))
  const bin = local ?? which('biome')
  if (bin) return spawnCommand([bin, 'lsp-proxy', '--stdio'], { cwd: root })

  return spawnNodePackageBin('@biomejs/biome', 'biome', ['lsp-proxy', '--stdio'], {
    cwd: root,
  })
}

export async function spawnClangd(root: string) {
  const existing = which('clangd', [toolRoot])
  if (existing)
    return spawnCommand([existing, '--background-index', '--clang-tidy'], {
      cwd: root,
    })

  const downloaded = await downloadClangd()
  if (!downloaded) return null

  return spawnCommand([downloaded, '--background-index', '--clang-tidy'], {
    cwd: root,
  })
}

export async function spawnDotnetTool(toolName: string, commandName: string, root: string) {
  const bin = which(commandName, [toolRoot])
  if (bin) return spawnCommand([bin], { cwd: root })
  if (!which('dotnet') || downloadsDisabled()) return null

  const exit = await runCommand(['dotnet', 'tool', 'install', toolName, '--tool-path', toolRoot], {
    cwd: root,
  })
  if (exit !== 0) return null

  return spawnCommand([commandName], { cwd: root })
}

export async function spawnElixirLs(root: string) {
  const bin = which('elixir-ls', [toolRoot])
  if (bin) return spawnCommand([bin], { cwd: root })
  if (!which('elixir') || !which('mix') || downloadsDisabled()) return null

  const script = await downloadElixirLs()
  if (!script) return null

  return spawnCommand([script], { cwd: root })
}

export async function spawnGemTool(
  gemName: string,
  commandName: string,
  args: readonly string[],
  root: string,
) {
  const bin = which(commandName, [toolRoot])
  if (bin) return spawnCommand([bin].concat(args), { cwd: root })
  if (!which('ruby') || !which('gem') || downloadsDisabled()) return null

  const exit = await runCommand(['gem', 'install', gemName, '--bindir', toolRoot], { cwd: root })
  if (exit !== 0) return null

  return spawnCommand([commandName].concat(args), { cwd: root })
}

export async function spawnGoTool(commandName: string, packageName: string, root: string) {
  const bin = which(commandName, [toolRoot])
  if (bin) return spawnCommand([bin], { cwd: root })
  if (!which('go') || downloadsDisabled()) return null

  const exit = await runCommand(['go', 'install', packageName], {
    cwd: root,
    env: { ...process.env, GOBIN: toolRoot },
  })
  if (exit !== 0) return null

  return spawnCommand([commandName], { cwd: root })
}

export async function spawnJdtls(root: string) {
  const java = which('java')
  if (!java) return null

  const distPath = path.join(toolRoot, 'jdtls')
  const launcher = await jdtlsLauncher(distPath)
  if (!launcher && !(await downloadJdtls(distPath))) return null

  const launcherJar = launcher ?? (await jdtlsLauncher(distPath))
  if (!launcherJar) return null

  const configFile = path.join(distPath, jdtlsConfigDirectory())
  const dataDir = path.join(toolRoot, 'jdtls-workspaces', path.basename(root))
  await mkdir(dataDir, { recursive: true })

  return spawnCommand(
    [
      java,
      '-jar',
      launcherJar,
      '-configuration',
      configFile,
      '-data',
      dataDir,
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '--add-modules=ALL-SYSTEM',
      '--add-opens',
      'java.base/java.util=ALL-UNNAMED',
      '--add-opens',
      'java.base/java.lang=ALL-UNNAMED',
    ],
    { cwd: root },
  )
}

export async function spawnKotlinLs(root: string) {
  const script = await kotlinLauncher()
  if (!script) return null

  return spawnCommand([script, '--stdio'], { cwd: root })
}

export async function spawnLuaLs(root: string) {
  const bin = which('lua-language-server', [toolRoot])
  if (bin) return spawnCommand([bin], { cwd: root })

  const downloaded = await downloadLuaLs()
  if (!downloaded) return null

  return spawnCommand([downloaded], { cwd: root })
}

export async function spawnOxlint(root: string) {
  const localLint = await existingPath(
    path.join(root, 'node_modules', '.bin', executableName('oxlint')),
  )
  const lintBin = localLint ?? which('oxlint')

  if (lintBin && (await commandHelpIncludes(lintBin, '--lsp'))) {
    return spawnCommand([lintBin, '--lsp'], { cwd: root })
  }

  const localServer = await existingPath(
    path.join(root, 'node_modules', '.bin', executableName('oxc_language_server')),
  )
  const serverBin = localServer ?? which('oxc_language_server')
  if (!serverBin) return null

  return spawnCommand([serverBin], { cwd: root })
}

export async function spawnSourceKit(root: string) {
  const bin = which('sourcekit-lsp')
  if (bin) return spawnCommand([bin], { cwd: root })
  if (!which('xcrun')) return null

  const resolved = await commandOutput(['xcrun', '--find', 'sourcekit-lsp'], {
    cwd: root,
  })
  if (!resolved) return null

  return spawnCommand([resolved.trim()], { cwd: root })
}

export async function spawnTy(root: string) {
  const fromPath = which('ty')
  if (fromPath) return spawnCommand([fromPath, 'server'], { cwd: root })

  const venvBin = await firstExistingPath(
    virtualEnvironmentPaths(root).map((venvPath) =>
      process.platform === 'win32'
        ? path.join(venvPath, 'Scripts', 'ty.exe')
        : path.join(venvPath, 'bin', 'ty'),
    ),
  )
  if (!venvBin) return null

  return spawnCommand([venvBin, 'server'], { cwd: root })
}

export async function spawnTerraformLs(root: string) {
  const bin = which('terraform-ls', [toolRoot])
  if (bin) return spawnCommand([bin, 'serve'], { cwd: root })

  const downloaded = await downloadTerraformLs()
  if (!downloaded) return null

  return spawnCommand([downloaded, 'serve'], { cwd: root })
}

export async function spawnTexlab(root: string) {
  const bin = which('texlab', [toolRoot])
  if (bin) return spawnCommand([bin], { cwd: root })

  const downloaded = await downloadPinnedRuntimeBinary('texlab')
  if (!downloaded) return null

  return spawnCommand([downloaded], { cwd: root })
}

export async function spawnTinymist(root: string) {
  const bin = which('tinymist', [toolRoot])
  if (bin) return spawnCommand([bin], { cwd: root })

  const downloaded = await downloadPinnedRuntimeBinary('tinymist')
  if (!downloaded) return null

  return spawnCommand([downloaded], { cwd: root })
}

/**
 * rust-analyzer, resolved past the rustup shim.
 *
 * `which('rust-analyzer')` finds `~/.cargo/bin/rust-analyzer` on any machine
 * with rustup, and that file is a **proxy, not the server**. Unless the
 * component happens to be installed for the active toolchain it prints
 * `error: 'rust-analyzer' is not installed for the toolchain '<tc>'` and exits
 * immediately — which reaches the browser as a socket closing with no message,
 * because nothing in this stack reports a backend death. The real binary lives
 * inside the toolchain at `~/.rustup/toolchains/<tc>/bin/rust-analyzer`.
 *
 * `rustup which` is asked first and asked **from the project root**, not with a
 * pinned `--toolchain stable`: a crate with a `rust-toolchain.toml` wants the
 * server its own toolchain ships, and asking for `stable` there would hand it a
 * different compiler's analysis. `--toolchain stable` is the fallback for a root
 * that pins nothing, and the toolchain directory scan is the fallback for a
 * machine with no `rustup` on PATH at all.
 */
export async function spawnRustAnalyzer(root: string) {
  const resolved =
    (await rustupRustAnalyzer(root)) ??
    (await installedToolchainRustAnalyzer()) ??
    pathRustAnalyzer()
  if (!resolved) return null

  return spawnCommand([resolved], { cwd: root })
}

async function rustupRustAnalyzer(root: string) {
  if (!which('rustup')) return null

  /**
   * Asking rustup must never *install* anything.
   *
   * `rustup which` is run from the project root so a crate's own
   * `rust-toolchain.toml` is honoured — and that file ships inside a cloned
   * repository. A repo naming a toolchain this machine does not have would
   * otherwise make opening one `.rs` file download a whole toolchain: hundreds of
   * megabytes, no progress anywhere in this stack, and the spawn blocked until it
   * finished. `RUSTUP_AUTO_INSTALL=0` turns that into an error, which falls
   * through to the installed-toolchain scan below.
   */
  const env = { ...process.env, RUSTUP_AUTO_INSTALL: '0' }
  // Trimmed because `commandOutput` hands back raw stdout: rustup prints the
  // path with a trailing newline, and every `access` check after this would fail
  // on it while looking like a missing binary.
  const active = trimmedPath(
    await commandOutput(['rustup', 'which', 'rust-analyzer'], { cwd: root, env }),
  )
  const stable = active
    ? null
    : trimmedPath(
        await commandOutput(['rustup', 'which', '--toolchain', 'stable', 'rust-analyzer'], {
          cwd: root,
          env,
        }),
      )

  return executableRustAnalyzer(active ?? stable)
}

async function installedToolchainRustAnalyzer() {
  const toolchains = path.join(homedir(), '.rustup', 'toolchains')
  const entries = await readdir(toolchains).catch(() => [])
  // Sorted so a machine with several toolchains resolves the same binary on
  // every spawn; an arbitrary readdir order would make a pooled backend's
  // capabilities depend on the filesystem.
  for (const entry of entries.toSorted()) {
    const candidate = executableRustAnalyzer(path.join(toolchains, entry, 'bin', 'rust-analyzer'))
    if (candidate) return candidate
  }

  return null
}

function pathRustAnalyzer() {
  const found = which('rust-analyzer', [toolRoot])
  // The shim again, reached the long way round. Spawning it would produce the
  // silent death this function exists to avoid, so refusing is the honest answer.
  if (found && isRustupShim(found)) return null

  return found
}

function executableRustAnalyzer(candidate: string | null) {
  if (!candidate) return null
  if (isRustupShim(candidate)) return null
  if (!existsSyncExecutable(candidate)) return null

  return candidate
}

function trimmedPath(output: string | null) {
  return output?.trim() || null
}

/** Every rustup proxy lives in the cargo bin directory; the real servers do not. */
function isRustupShim(candidate: string) {
  return path.dirname(candidate) === path.join(homedir(), '.cargo', 'bin')
}

export async function spawnZls(root: string) {
  const bin = which('zls', [toolRoot])
  if (bin) return spawnCommand([bin], { cwd: root })
  if (!which('zig')) return null

  const downloaded = await downloadPinnedRuntimeBinary('zls')
  if (!downloaded) return null

  return spawnCommand([downloaded], { cwd: root })
}

export async function spawnCommand(
  command: readonly string[],
  options: CommandOptions,
): Promise<LspServerHandle | null> {
  const [binary, ...args] = command
  if (!binary) return null

  const resolved = path.isAbsolute(binary) ? binary : which(binary, [toolRoot, nodePackageBin])
  if (!resolved) return null

  return {
    process: spawn(resolved, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: 'pipe',
    }),
  }
}

async function resolvePackageBinary(packageName: string, commandName: string) {
  const local = await resolveLocalBinary(commandName)
  if (local) return local

  const global = which(commandName)
  if (global) return global
  if (downloadsDisabled()) return null

  await ensureNodePackage(packageName)
  return resolveLocalBinary(commandName)
}

async function resolveLocalBinary(commandName: string) {
  const candidate = path.join(nodePackageBin, commandName)
  if (await exists(candidate)) return candidate
  if (process.platform !== 'win32') return null

  const windowsCandidate = `${candidate}.cmd`
  return (await exists(windowsCandidate)) ? windowsCandidate : null
}

async function ensureNodePackage(packageName: string) {
  await mkdir(nodePackageRoot, { recursive: true })
  await ensurePackageJson()

  const exit = await runCommand([process.execPath, 'add', packageName], {
    cwd: nodePackageRoot,
    env: { ...process.env, BUN_BE_BUN: '1' },
  })
  if (exit !== 0)
    throw lspErrors.PACKAGE_INSTALL_FAILED({
      internal: { exitCode: exit },
      packageName,
    })
}

async function ensurePackageJson() {
  const packagePath = path.join(nodePackageRoot, 'package.json')
  if (await exists(packagePath)) return

  await writeFile(packagePath, JSON.stringify({ private: true, type: 'module' }, null, 2))
}

async function downloadClangd() {
  const existing = await firstClangdInstall()
  if (existing) return existing
  if (downloadsDisabled()) return null

  const release = await githubRelease('https://api.github.com/repos/clangd/clangd/releases/latest')
  const tag = release?.tag_name
  if (!release || !tag) return null

  const token = platformToken({
    darwin: 'mac',
    linux: 'linux',
    win32: 'windows',
  })
  const asset = release.assets?.find((item) =>
    Boolean(item.name?.includes(token) && item.name.includes(tag)),
  )
  if (!asset?.browser_download_url || !asset.name) return null

  const archive = await downloadAsset(asset.browser_download_url, asset.name)
  if (!archive) return null

  await extractArchive(archive, toolRoot)
  await rm(archive, { force: true })

  const bin = path.join(toolRoot, `clangd_${tag}`, 'bin', executableName('clangd'))
  return (await makeExecutableIfExists(bin)) ? bin : null
}

async function downloadJdtls(distPath: string) {
  if (downloadsDisabled()) return false

  await mkdir(distPath, { recursive: true })
  const url =
    'https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz'
  const archive = path.join(distPath, 'release.tar.gz')
  if (!(await downloadToFile(url, archive))) return false

  const exit = await runCommand(['tar', '-xzf', archive], { cwd: distPath })
  await rm(archive, { force: true })
  return exit === 0
}

async function downloadElixirLs() {
  const distPath = path.join(toolRoot, 'elixir-ls-master')
  const script = path.join(
    distPath,
    'release',
    process.platform === 'win32' ? 'language_server.bat' : 'language_server.sh',
  )
  if (await exists(script)) return script

  const archive = await downloadAsset(
    'https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip',
    'elixir-ls.zip',
  )
  if (!archive) return null

  await extractArchive(archive, toolRoot)
  await rm(archive, { force: true })

  const env = { ...process.env, MIX_ENV: 'prod' }
  if ((await runCommand(['mix', 'deps.get'], { cwd: distPath, env })) !== 0) return null
  if ((await runCommand(['mix', 'compile'], { cwd: distPath, env })) !== 0) return null
  if (
    (await runCommand(['mix', 'elixir_ls.release2', '-o', 'release'], {
      cwd: distPath,
      env,
    })) !== 0
  )
    return null

  await makeExecutableIfExists(script)
  return (await exists(script)) ? script : null
}

async function downloadLuaLs() {
  if (downloadsDisabled()) return null

  const release = await githubRelease(
    'https://api.github.com/repos/LuaLS/lua-language-server/releases/latest',
  )
  if (!release?.tag_name) return null

  const platform = process.platform === 'win32' ? 'win32' : process.platform
  const arch = process.arch === 'ia32' ? 'ia32' : process.arch === 'arm64' ? 'arm64' : 'x64'
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const name = `lua-language-server-${release.tag_name}-${platform}-${arch}.${ext}`
  const asset = release.assets?.find((item) => item.name === name)
  if (!asset?.browser_download_url) return null

  const archive = await downloadAsset(asset.browser_download_url, name)
  if (!archive) return null

  const installDir = path.join(toolRoot, `lua-language-server-${arch}-${platform}`)
  await rm(installDir, { force: true, recursive: true })
  await mkdir(installDir, { recursive: true })
  await extractArchive(archive, installDir)
  await rm(archive, { force: true })

  const bin = path.join(installDir, 'bin', executableName('lua-language-server'))
  return (await makeExecutableIfExists(bin)) ? bin : null
}

async function downloadTerraformLs() {
  if (downloadsDisabled()) return null

  const response = await fetch('https://api.releases.hashicorp.com/v1/releases/terraform-ls/latest')
  if (!response.ok) return null

  const release = (await response.json()) as HashiCorpRelease
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const os = process.platform === 'win32' ? 'windows' : process.platform
  const build = release.builds?.find((item) => item.arch === arch && item.os === os)
  if (!build?.url) return null

  const archive = await downloadAsset(build.url, 'terraform-ls.zip')
  if (!archive) return null

  await extractArchive(archive, toolRoot)
  await rm(archive, { force: true })

  const bin = path.join(toolRoot, executableName('terraform-ls'))
  return (await makeExecutableIfExists(bin)) ? bin : null
}

async function downloadPinnedRuntimeBinary(id: PinnedLspRuntimeId) {
  if (downloadsDisabled()) return null

  const manifest: PinnedLspRuntimeManifestEntry = pinnedLspRuntimeManifest[id]
  const asset = manifest.platforms[process.platform]?.[process.arch]
  if (!asset) return null

  const archive = await downloadAsset(asset.url, asset.name, asset.sha256)
  if (!archive) return null

  await extractArchive(archive, toolRoot, asset.extractArgs)
  await rm(archive, { force: true })

  const bin = path.join(toolRoot, executableName(manifest.binaryName))
  return (await makeExecutableIfExists(bin)) ? bin : null
}

async function kotlinLauncher() {
  const distPath = path.join(toolRoot, 'kotlin-ls')
  const launcher = path.join(
    distPath,
    process.platform === 'win32' ? 'kotlin-lsp.cmd' : 'kotlin-lsp.sh',
  )
  if (await exists(launcher)) return launcher
  if (downloadsDisabled()) return null

  const release = await githubRelease(
    'https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest',
  )
  const version = release?.name?.replace(/^v/u, '')
  if (!version) return null

  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  const platform = platformToken({
    darwin: 'mac',
    linux: 'linux',
    win32: 'win',
  })
  const name = `kotlin-lsp-${version}-${platform}-${arch}.zip`
  const url = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${name}`
  const archive = await downloadAsset(url, name)
  if (!archive) return null

  await mkdir(distPath, { recursive: true })
  await extractArchive(archive, distPath)
  await rm(archive, { force: true })
  await makeExecutableIfExists(launcher)
  return (await exists(launcher)) ? launcher : null
}

async function jdtlsLauncher(distPath: string) {
  const launcherDir = path.join(distPath, 'plugins')
  const entries = await readdir(launcherDir).catch(() => [])
  const jar = entries.find((item) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/u.test(item))
  return jar ? path.join(launcherDir, jar) : null
}

function jdtlsConfigDirectory() {
  if (process.platform === 'darwin') return 'config_mac'
  if (process.platform === 'win32') return 'config_win'

  return 'config_linux'
}

async function firstClangdInstall() {
  const direct = path.join(toolRoot, executableName('clangd'))
  if (await exists(direct)) return direct

  const entries = await readdir(toolRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('clangd_')) continue

    const candidate = path.join(toolRoot, entry.name, 'bin', executableName('clangd'))
    if (await exists(candidate)) return candidate
  }

  return null
}

async function githubRelease(url: string) {
  const response = await fetch(url)
  if (!response.ok) return null

  return (await response.json()) as GitHubAssetRelease
}

async function downloadAsset(url: string, name: string, sha256?: string) {
  await mkdir(toolRoot, { recursive: true })
  const target = path.join(toolRoot, name)
  await rm(target, { force: true })
  return (await downloadToFile(url, target, sha256)) ? target : null
}

async function downloadToFile(url: string, target: string, sha256?: string) {
  const response = await fetch(url)
  if (!response.ok) return false

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0) return false
  if (sha256 && sha256ForBuffer(buffer) !== sha256) return false

  await writeFile(target, buffer)
  return true
}

async function extractArchive(
  archive: string,
  destination: string,
  extraArgs: readonly string[] = [],
) {
  await mkdir(destination, { recursive: true })
  if (archive.endsWith('.zip')) {
    await runCommand(['unzip', '-q', '-o', archive, '-d', destination], {
      cwd: destination,
    })
    return
  }

  await runCommand(['tar', '-xf', archive, '-C', destination].concat(extraArgs), {
    cwd: destination,
  })
}

async function makeExecutableIfExists(filePath: string) {
  if (!(await exists(filePath))) return false
  if (process.platform !== 'win32') await chmod(filePath, 0o755).catch(() => undefined)

  return true
}

async function commandHelpIncludes(binary: string, text: string) {
  const output = await commandOutput([binary, '--help'], { cwd: process.cwd() })
  return output?.includes(text) ?? false
}

async function commandOutput(command: readonly string[], options: CommandOptions) {
  const [binary, ...args] = command
  if (!binary) return null

  const proc = spawn(binary, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const chunks: Buffer[] = []
  proc.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const exit = await waitForExit(proc)
  if (exit !== 0) return null

  return Buffer.concat(chunks).toString('utf8')
}

async function runCommand(command: readonly string[], options: CommandOptions) {
  const [binary, ...args] = command
  if (!binary) return 1

  await mkdir(toolRoot, { recursive: true })
  const proc = spawn(binary, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: 'ignore',
  })
  return waitForExit(proc)
}

function waitForExit(process: ChildProcessWithoutNullStreams | ReturnType<typeof spawn>) {
  return new Promise<number>((resolve) => {
    process.once('error', () => resolve(1))
    process.once('exit', (code) => resolve(code ?? 1))
  })
}

function which(command: string, extraPaths: readonly string[] = []) {
  const paths = extraPaths.concat(process.env.PATH?.split(path.delimiter) ?? [])
  const names = commandNames(command)

  for (const directory of paths) {
    const found = firstExecutable(directory, names)
    if (found) return found
  }

  return null
}

function firstExecutable(directory: string, names: readonly string[]) {
  for (const name of names) {
    const candidate = path.join(directory, name)
    if (!existsSyncExecutable(candidate)) continue

    return candidate
  }

  return null
}

function commandNames(command: string) {
  if (process.platform !== 'win32') return [command]
  if (/\.(cmd|bat|exe)$/iu.test(command)) return [command]

  return [command, `${command}.cmd`, `${command}.bat`, `${command}.exe`]
}

function existsSyncExecutable(candidate: string) {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function existingPath(candidate: string) {
  return (await exists(candidate)) ? candidate : null
}

function executableName(command: string) {
  return process.platform === 'win32' ? `${command}.exe` : command
}

function platformToken(tokens: {
  readonly darwin: string
  readonly linux: string
  readonly win32: string
}) {
  if (process.platform === 'darwin') return tokens.darwin
  if (process.platform === 'win32') return tokens.win32

  return tokens.linux
}

function sha256ForBuffer(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}
