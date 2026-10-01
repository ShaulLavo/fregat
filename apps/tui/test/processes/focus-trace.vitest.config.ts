import base from '../../vitest.config'

// Runs only the timeout probe, which fails on purpose; focus-trace.test.ts reads its output.
export default {
  ...base,
  test: { ...base.test, include: ['test/processes/focus-trace-timeout.probe.ts'] },
}
