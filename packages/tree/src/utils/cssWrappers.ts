// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
const LAYER_ORDER = `@layer base, unsafe;`

export function wrapCoreCSS(coreCSS: string): string {
  return `${LAYER_ORDER}
@layer base {
  ${coreCSS}
}`
}

export function wrapUnsafeCSS(unsafeCSS: string): string {
  return `${LAYER_ORDER}
@layer unsafe {
  ${unsafeCSS}
}`
}
