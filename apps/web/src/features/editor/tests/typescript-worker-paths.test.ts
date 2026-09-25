import { expect, it } from 'vitest'
import { workerIncludedFile } from '@/features/editor/utils/typescript-worker-paths'
const watch = { include: ['/repo/src'], exclude: ['/repo/src/generated'], allowJs: false }
it.each(['/repo/src/new.ts', '/repo/src/deep/view.tsx', '/repo/src/types.d.mts'])(
  'accepts a new included source %s',
  (path) => {
    expect(workerIncludedFile(path, watch)).toBe(true)
  },
)
it.each([
  '/repo/other.ts',
  '/repo/src/generated/new.ts',
  '/repo/src/new.js',
  '/repo/src/.cache/new.ts',
  '/repo/src/node_modules/dep/new.ts',
  '/repo/src/config.json',
])('ignores unrelated source %s', (path) => {
  expect(workerIncludedFile(path, watch)).toBe(false)
})
it('honors recursive globs, explicit dependency includes, exclusions and allowJs', () => {
  const configuration = {
    include: ['/repo/**/*.ts', '/repo/node_modules/custom/**', '/repo/**/*.js'],
    exclude: ['/repo/**/dist/**'],
    allowJs: true,
  }
  expect(workerIncludedFile('/repo/root.ts', configuration)).toBe(true)
  expect(workerIncludedFile('/repo/a/b.ts', configuration)).toBe(true)
  expect(workerIncludedFile('/repo/a/dist/b.ts', configuration)).toBe(false)
  expect(workerIncludedFile('/repo/node_modules/custom/new.ts', configuration)).toBe(true)
  expect(workerIncludedFile('/repo/node_modules/other/new.ts', configuration)).toBe(false)
  expect(workerIncludedFile('/repo/a.js', configuration)).toBe(true)
})
