import base from '../../vitest.config.ts'

// Deliberate failures let the parent test inspect the reporter's original-source locations.
export default {
  ...base,
  test: { ...base.test, include: ['test/processes/source-location.probe.tsx'] },
}
