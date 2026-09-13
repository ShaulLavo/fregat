import type { VscodeThemeRegistration } from '@singapore-editor/core/shiki'

type ThemeModule = { readonly default: VscodeThemeRegistration }

export function deferredThemeModule(importModule: () => Promise<ThemeModule>) {
  let requested = false
  let resolve!: (module: ThemeModule) => void
  const promise = new Promise<ThemeModule>((next) => {
    resolve = next
  })
  return {
    get requested() {
      return requested
    },
    load() {
      requested = true
      return promise
    },
    async release() {
      resolve(await importModule())
    },
  }
}
