import type { RGBA8 } from './types'

export class RasterBuffer {
  public readonly imageData: ImageData
  private readonly pixels: Uint32Array
  private readonly background: number

  public constructor(
    context: OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
    background: RGBA8,
  ) {
    this.imageData = context.createImageData(Math.max(1, width), Math.max(1, height))
    this.pixels = new Uint32Array(this.imageData.data.buffer)
    const channels = Uint8ClampedArray.of(background.r, background.g, background.b, background.a)
    this.background = new Uint32Array(channels.buffer)[0]!
  }

  public clearRows(start: number, end: number): void {
    this.pixels.fill(this.background, start * this.imageData.width, end * this.imageData.width)
  }

  public copyRows(source: number, destination: number, count: number): void {
    const width = this.imageData.width
    this.pixels.copyWithin(destination * width, source * width, (source + count) * width)
  }
}
