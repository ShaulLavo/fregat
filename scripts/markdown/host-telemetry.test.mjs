import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const directory = fileURLToPath(new URL('.', import.meta.url))

test.skipIf(process.platform !== 'linux')(
  'host telemetry OS and native launch controls require Linux lifetime containment',
  () => {
    const result = spawnSync(
      'python3',
      ['-m', 'unittest', 'discover', '-s', directory, '-p', 'test_host_telemetry*.py', '-v'],
      {
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    )
    const output = (result.stdout ?? '').concat(result.stderr ?? '')
    expect(result.error, output).toBeUndefined()
    expect(result.status, output).toBe(0)
    expect(output).toContain('test_cli_binds_original_report_bytes_and_preserves_actual_samples')
    expect(output).toContain('test_native_mode_binds_actual_runtime_argv_report_and_samples')
    expect(output).toContain('test_unobserved_double_fork_is_adopted_and_reaped')
    expect(output).not.toContain('skipped=')
    process.stdout.write(output)
  },
  130_000,
)
