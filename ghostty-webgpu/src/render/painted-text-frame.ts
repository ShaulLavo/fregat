import type { RendererFrameRow } from './renderer.js'

/** Accepted DOM rows own the run strings used by their completed paint. */
export interface PaintedTextFrame {
  readonly rows: readonly RendererFrameRow[]
  readonly previousRows: readonly RendererFrameRow[]
}
