import { expect, test } from 'vitest'

import { comparisonReport } from './report'

const metrics = { openToTextMs: 3525.1, saveMs: 614.6, keyLatencyMs: { p95: 639.8 } }

test('labels each row with its host and rendering path', () => {
  const report = comparisonReport([
    {
      sizeMiB: 1,
      status: 'passed',
      metrics,
      browser: '153.0.8010.12',
      host: { name: 'pi', arch: 'arm64', cpus: 4, memoryBytes: 3_976_200_192 },
      rendering: {
        renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))',
        path: 'software',
      },
    },
  ])

  expect(report).toContain('| Host | Renderer | MiB |')
  expect(report).toContain('| pi arm64 4 CPU 3.7 GiB | software, Chromium 153.0.8010.12 | 1 |')
})

test('marks results recorded before host labels as unlabelled', () => {
  const report = comparisonReport([{ sizeMiB: 1, status: 'passed', metrics }])

  expect(report).toContain('| — | — | 1 |')
})
