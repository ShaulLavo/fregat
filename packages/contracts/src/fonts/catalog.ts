/** One font the server can fetch and cache, as `GET /fonts` lists it. */
export type FontCatalogEntry = {
  readonly ref: string
  readonly family: string
  /** The server lists `nerd`, `fontsource` and its installed `local` fonts; the client adds `bundled`. */
  readonly source: 'bundled' | 'nerd' | 'fontsource' | 'local'
  /** Fontsource's category (`sans-serif`, `monospace`, …); every Nerd Font is `monospace`,
   *  and an installed font is `monospace` or `proportional`. */
  readonly category: string
  readonly variable: boolean
  readonly weights: readonly number[]
  readonly license: string | null
}
