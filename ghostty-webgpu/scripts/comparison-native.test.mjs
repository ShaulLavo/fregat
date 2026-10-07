import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createCounterReader } from './comparison-counters.mjs'

function pythonTest(context, source) {
  const result = spawnSync('python3', ['-B', '-c', source, import.meta.dirname], {
    encoding: 'utf8',
  })
  if (result.error?.code === 'ENOENT') {
    context.skip('Python 3 is unavailable; native readers require it')
    return
  }
  assert.equal(result.status, 0, result.stderr)
}

test('Mach conversion and v6 ABI layout preserve integer precision', (context) => {
  pythonTest(
    context,
    `
import ctypes, importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('reader', pathlib.Path(sys.argv[1]) / 'comparison-rusage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.nanoseconds(3, 125, 3) == 125
assert module.nanoseconds(100000000000000000001, 125, 3) == 4166666666666666666708
assert ctypes.sizeof(module.Usage) == 464
assert module.Usage.ri_proc_start_abstime.offset == 80
assert module.Usage.ri_instructions.offset == 248
assert module.Usage.ri_cycles.offset == 256
assert module.Usage.ri_energy_nj.offset == 336
assert 'ri_proc_start_abstime' in module.KEEP
assert 'ri_proc_exit_abstime' in module.KEEP
`,
  )
})

test('Linux perf attribute ABI has 64-bit hybrid config and thread-only inheritance', (context) => {
  pythonTest(
    context,
    `
import ctypes, importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('reader', pathlib.Path(sys.argv[1]) / 'comparison-perf.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert ctypes.sizeof(module.Attr) == 128
assert module.Attr.config.offset == 8
assert module.Attr.flags.offset == 40
attr = module.Attr()
attr.config = 1 | (10 << 32)
attr.flags = (1 << 1) | (1 << 5) | (1 << 6) | (1 << 35)
assert attr.config == 42949672961
assert attr.flags & (1 << 35)
`,
  )
})

test('unavailable platforms skip native channels with a stated reason', async () => {
  const reader = await createCounterReader({}, { platform: 'win32' })
  assert.equal(reader.skipped, true)
  assert.match(reader.reason, /unavailable on win32/)
})

test('Mac line server reports absence on other operating systems', (context) => {
  if (process.platform === 'darwin') return context.skip('This checks the non-macOS absence path')
  const result = spawnSync('python3', ['-B', join(import.meta.dirname, 'comparison-rusage.py')], {
    encoding: 'utf8',
  })
  if (result.error?.code === 'ENOENT') return context.skip('Python 3 is unavailable')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    ready: false,
    reason: 'RUSAGE_INFO_V6 requires macOS',
  })
})

test('Linux attachment rejects thread churn and closes partially attached descriptors', (context) => {
  pythonTest(
    context,
    `
import errno, importlib.util, os, pathlib, sys, types
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('reader', pathlib.Path(sys.argv[1]) / 'comparison-perf.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
reader = module.Reader.__new__(module.Reader)
reader.syscall = 298
reader.processes = {}
reader.pmus = [{'name': 'cpu', 'type': 0}]
opened = []
read_fd, write_fd = os.pipe()
def syscall(*args):
    fd = os.dup(read_fd)
    opened.append(fd)
    return fd
reader.libc = types.SimpleNamespace(syscall=syscall, ioctl=lambda *args: 0)
try:
    with patch.object(pathlib.Path, 'read_text', return_value='7 (worker) S ' + '0 ' * 18 + '42'), patch.object(pathlib.Path, 'iterdir', side_effect=[[pathlib.Path('7')], [pathlib.Path('7'), pathlib.Path('8')]]):
        try:
            reader.attach(7)
            raise AssertionError('Thread churn must make attachment unavailable')
        except OSError as error:
            assert error.errno == errno.EAGAIN
    assert not reader.processes
    for fd in opened:
        try:
            os.fstat(fd)
            raise AssertionError('Partially attached descriptor leaked')
        except OSError as error:
            assert error.errno == errno.EBADF
finally:
    reader.close()
    os.close(read_fd)
    os.close(write_fd)
`,
  )
})
