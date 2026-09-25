import { defineErrorCatalog } from 'evlog'

export const installationErrors = defineErrorCatalog('installation', {
  RUNTIME_PACKAGE_MISSING: {
    status: 500,
    message: ({ packages }: { packages: string }) =>
      `bun.lock resolves no version for the server runtime packages ${packages}.`,
    why: 'A release lists the exact version of every package its bundle loads at runtime, and bun.lock is where those versions come from.',
    fix: 'Add the package to apps/server/package.json, run bun install, then build the release again.',
  },
})
