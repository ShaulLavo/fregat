import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'

import { downloadsDisabled, setLspDownloadPolicy, spawnRustAnalyzer } from '../installers'

afterEach(() => {
  setLspDownloadPolicy(() => DEFAULT_SETTING_VALUES['lsp.downloadRuntimes'])
})

describe('LSP download policy', () => {
  it('allows downloads until something turns them off', () => {
    // Both directions, because the setting reads "may download" and the eleven
    // call sites ask "must not download". A dropped `!` inverts the product.
    expect(downloadsDisabled()).toBe(false)

    setLspDownloadPolicy(() => false)
    expect(downloadsDisabled()).toBe(true)

    setLspDownloadPolicy(() => true)
    expect(downloadsDisabled()).toBe(false)
  })
})

/**
 * `~/.cargo/bin/rust-analyzer` is either the rustup proxy, which exits at once
 * when the component is missing, or a real `cargo install`. Only running it can tell.
 */
describe('rust-analyzer resolution', () => {
  // Installed toolchains are scanned before PATH, and Bun's homedir() ignores a changed HOME.
  const hasToolchains = existsSync(path.join(homedir(), '.rustup', 'toolchains'))

  async function resolveWith(script: string) {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-rust-analyzer-'))
    const bin = path.join(root, '.cargo', 'bin')
    const savedPath = process.env.PATH
    await mkdir(bin, { recursive: true })
    await writeFile(path.join(bin, 'rust-analyzer'), script, { mode: 0o755 })
    process.env.PATH = bin
    try {
      const handle = await spawnRustAnalyzer(root)
      handle?.process.kill()
      return handle?.process.spawnfile ?? null
    } finally {
      process.env.PATH = savedPath
      await rm(root, { force: true, recursive: true })
    }
  }

  it.skipIf(hasToolchains)('keeps a real server installed beside the rustup proxies', async () => {
    const spawned = await resolveWith(
      '#!/bin/sh\n[ "$1" = --version ] && echo "rust-analyzer 1.0.0" && exit 0\nexec sleep 30\n',
    )

    expect(spawned).toMatch(/\.cargo\/bin\/rust-analyzer$/)
  })

  it.skipIf(hasToolchains)('skips a proxy whose toolchain has no rust-analyzer', async () => {
    const spawned = await resolveWith(
      "#!/bin/sh\necho \"error: 'rust-analyzer' is not installed for the toolchain 'stable'\" >&2\nexit 1\n",
    )

    expect(spawned).toBeNull()
  })

  it.skipIf(hasToolchains)(
    'gives up on a candidate that never answers',
    async () => {
      const started = Date.now()
      const spawned = await resolveWith('#!/bin/sh\nexec sleep 60\n')

      expect(spawned).toBeNull()
      expect(Date.now() - started).toBeLessThan(10_000)
    },
    15_000,
  )
})
