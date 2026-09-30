declare module '*.scm?raw' {
  const source: string
  export default source
}

declare module '*.wasm?url' {
  const url: string
  export default url
}
