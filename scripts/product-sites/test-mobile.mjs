import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = await mkdtemp(join(tmpdir(), 'product-mobile-'))
const script = fileURLToPath(new URL('./verify-mobile.mjs', import.meta.url))
const fixture = (content) =>
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}</style>${content}`
try {
  for (const name of ['good', 'bad', 'clipped', 'fixed', 'sticky']) await mkdir(join(root, name))
  await writeFile(
    join(root, 'good', 'index.html'),
    fixture(
      '<pre style="max-width:100%;overflow-x:auto"><code>' +
        'long-code-'.repeat(100) +
        '</code></pre><div style="max-width:100%;overflow-x:auto"><table style="width:600px"><tr><td>Wide table</td></tr></table><div style="position:sticky;width:600px;height:20px">Scrollable sticky content</div></div>',
    ),
  )
  await writeFile(
    join(root, 'bad', 'index.html'),
    fixture('<div style="width:600px">Page overflow</div>'),
  )
  await writeFile(
    join(root, 'clipped', 'index.html'),
    fixture(
      '<style>html,body{width:100%;overflow-x:hidden}</style><div style="width:600px">Clipped content</div>',
    ),
  )
  await writeFile(
    join(root, 'fixed', 'index.html'),
    fixture(
      '<div style="width:100%;overflow-x:hidden"><button style="position:fixed;left:-40px;width:80px;height:40px">Off-screen control</button></div>',
    ),
  )
  await writeFile(
    join(root, 'sticky', 'index.html'),
    fixture(
      '<div style="width:100%;overflow-x:hidden"><button style="position:sticky;transform:translateX(-40px);width:80px;height:40px">Off-screen sticky control</button></div>',
    ),
  )
  const result = spawnSync(
    process.execPath,
    [script, '--directory', root, '--workers', '1', '--evidence', join(root, 'evidence')],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const rows = (await readFile(join(root, 'evidence', 'results.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.equal(rows.length, 30, result.stdout + result.stderr)
  for (const row of rows) {
    if (row.url.endsWith('/good/')) {
      assert.equal(
        row.width,
        row.requestedWidth,
        'Mobile emulation must retain the requested viewport',
      )
      assert.equal(row.scrollWidth, row.requestedWidth, 'Code must scroll inside its own box')
      assert.equal(
        row.overflowing.length,
        0,
        'Contained code is excluded from overflow diagnostics',
      )
      continue
    }
    if (!row.url.endsWith('/bad/')) {
      assert.equal(row.width, row.requestedWidth)
      assert.equal(
        row.scrollWidth,
        row.requestedWidth,
        'Hidden and positioned overflow leave the root fitting',
      )
      assert(
        row.overflowing.length > 0,
        'Element bounds must identify hidden or positioned overflow',
      )
      assert(row.screenshot, 'Hidden and positioned overflow must fail and capture evidence')
      continue
    }
    assert.equal(row.scrollWidth, 600, 'The check must catch page overflow')
    assert(row.overflowing.some((element) => element.tag === 'DIV' && element.right === 600))
  }
  for (const invalid of [
    ['--workers', '0'],
    ['--limit', '0'],
    ['--engines', 'firefox'],
    ['--offset', '999'],
  ]) {
    const rejected = spawnSync(process.execPath, [script, '--directory', root, ...invalid], {
      encoding: 'utf8',
    })
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr)
    assert.match(rejected.stderr, /AssertionError/, 'Invalid selections must fail before checking')
  }
  console.log('Mobile checker fixtures: 30 checks passed; 4 invalid selections rejected')
} finally {
  await rm(root, { recursive: true, force: true })
}
