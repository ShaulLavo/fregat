import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { caseScopeCommand, runCaseScope } from '../../scripts/large-file/case-scope'

const shim = path.resolve(import.meta.dirname, '../../scripts/large-file/scope.sh')
const traced = path.join(tmpdir(), 'scope-traced.sh')
const original = readFileSync(shim, 'utf8')
writeFileSync(
  traced,
  original
    .replace('grace=10\n', 'grace=10\nexec 2>>"$out.trace"; set -x\n')
    .replace(
      '{\n  printf',
      'ls "$drain_root" >&2; for f in memory.peak memory.current memory.events memory.max memory.swap.max cgroup.procs; do echo "== $f" >&2; cat "$drain_root/$f" >&2; done\n{\n  printf',
    ),
)

async function one(label: string, mib: number, memoryMiB: number, useTrace: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), 'diag-'))
  const unit = `diag-${process.pid}-${label}.scope`
  const accountingFile = path.join(root, 'scope.accounting')
  const run = {
    unit,
    memoryMiB,
    command: ['bun', '-e', `const b = Buffer.alloc(${mib} * 2 ** 20, 1); console.log(b.length)`],
    accountingFile,
    cwd: root,
    env: process.env,
    stdout: path.join(root, 'stdout.log'),
    stderr: path.join(root, 'stderr.log'),
    timeoutMs: 30_000,
  }
  let outcome
  if (useTrace) {
    const argv = caseScopeCommand(run).map((a) => (a === shim ? traced : a))
    const child = Bun.spawn(argv, {
      cwd: root,
      env: process.env,
      stdout: Bun.file(run.stdout),
      stderr: Bun.file(run.stderr),
    })
    const code = await child.exited
    let acc = '<missing>'
    try {
      acc = readFileSync(accountingFile, 'utf8')
    } catch {}
    outcome = { exited: code, signal: child.signalCode, accounting: acc }
    Bun.spawnSync(['systemctl', '--user', 'stop', unit])
    Bun.spawnSync(['systemctl', '--user', 'reset-failed', unit])
  } else {
    outcome = await runCaseScope(run)
  }
  const read = (f: string) => {
    try {
      return readFileSync(path.join(root, f), 'utf8')
    } catch {
      return '<none>'
    }
  }
  console.log(
    JSON.stringify(
      {
        label,
        outcome,
        stdout: read('stdout.log'),
        stderr: read('stderr.log'),
        trace: read('scope.accounting.trace'),
      },
      null,
      1,
    ),
  )
  rmSync(root, { recursive: true, force: true })
}

console.log('parent bun', Bun.version, 'constrainedMemory', process.constrainedMemory?.())
await one('ok', 220, 1024, false)
for (let i = 0; i < 4; i++) await one(`capped${i}`, 400, 128, false)
for (let i = 0; i < 2; i++) await one(`traced${i}`, 400, 128, true)
await one('constrained', 0, 128, false)
