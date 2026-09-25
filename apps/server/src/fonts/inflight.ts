/** Concurrent asks for one key share one run, so two requests never race to write one file. */
export class Inflight {
  private readonly pending = new Map<string, Promise<unknown>>()

  join<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key)
    if (existing) return existing as Promise<T>

    const started = run().finally(() => this.pending.delete(key))
    this.pending.set(key, started)
    return started
  }
}
