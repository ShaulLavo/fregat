export class ReplayWindow {
  private highWater = 0
  private readonly bits: Uint32Array

  constructor(private readonly size: number) {
    this.bits = new Uint32Array(Math.ceil(size / 32))
  }

  accept(id: number): boolean {
    if (id <= this.highWater - this.size) return false
    if (id > this.highWater) {
      this.advance(id)
      this.highWater = id
    }
    const slot = id % this.size
    const word = Math.floor(slot / 32)
    const bit = 1 << (slot % 32)
    if (this.bits[word]! & bit) return false
    this.bits[word] = this.bits[word]! | bit
    return true
  }

  private advance(id: number): void {
    if (id - this.highWater >= this.size) {
      this.bits.fill(0)
      return
    }
    for (let next = this.highWater + 1; next <= id; next++) {
      const slot = next % this.size
      const word = Math.floor(slot / 32)
      this.bits[word] = this.bits[word]! & ~(1 << (slot % 32))
    }
  }
}
