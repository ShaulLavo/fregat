import type { TextReadSnapshot } from '../documentTextSnapshot'

export class LineStartsView {
  private materialized: readonly number[] | null = null

  public constructor(private readonly snapshot: TextReadSnapshot) {}

  public get length(): number {
    return this.snapshot.lineCount
  }

  public at(index: number): number | undefined {
    if (index < 0 || index >= this.length || !Number.isInteger(index)) return undefined
    return this.snapshot.lineStart(index)
  }

  public indexForOffset(offset: number): number {
    return this.snapshot.lineAt(offset)
  }

  public firstIndexAtOrAfter(offset: number): number {
    if (offset > this.snapshot.length) return this.length
    const row = this.snapshot.lineAt(offset)
    return this.snapshot.lineStart(row) < offset ? row + 1 : row
  }

  public toArray(): readonly number[] {
    if (this.materialized) return this.materialized
    const starts: number[] = []
    for (let row = 0; row < this.length; row += 1) starts.push(this.snapshot.lineStart(row))
    this.materialized = starts
    return starts
  }
}
