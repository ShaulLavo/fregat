// The parts of the untyped `@pierre/vscode-icons` build scripts the generator reads.

declare module '@pierre/vscode-icons/scripts/palette.mjs' {
  export const palette: Readonly<
    Record<string, { readonly 400: string; readonly 600: string; readonly 800?: string }>
  >
}

declare module '@pierre/vscode-icons/scripts/themes/*.mjs' {
  const tier: readonly {
    readonly name: string
    readonly svgName?: string
    readonly fileNames?: readonly string[]
    readonly fileExtensions?: readonly string[]
  }[]
  export default tier
}
