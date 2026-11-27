/** True under WASI (`bun-wasm` reports `process.platform === 'linux'` and `process.arch === 'wasm32'`). */
export function isWasiRuntime(arch: string = process.arch): boolean {
  return arch === 'wasm32'
}
