import type { SpellcheckChecker } from '../src/controller'

type PendingCheck = { readonly words: readonly string[]; readonly answer: () => void }

/** Answers only when told to, so a test can edit while a check is in flight. */
export class FakeChecker implements SpellcheckChecker {
  public readonly checks: PendingCheck[] = []
  private readonly misspelled: ReadonlySet<string>
  private accepted = new Set<string>()
  private readonly listeners = new Set<() => void>()

  public constructor(misspelled: readonly string[]) {
    this.misspelled = new Set(misspelled)
  }

  public check(words: readonly string[]): Promise<readonly string[]> {
    const misspelled = words.filter((word) => this.misspelled.has(word) && !this.isAccepted(word))
    return new Promise((resolve) => {
      this.checks.push({
        words,
        answer: () => resolve(misspelled),
      })
    })
  }

  public async answerAll(): Promise<void> {
    for (const check of this.checks.splice(0)) check.answer()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  public suggest(word: string): Promise<readonly string[]> {
    return Promise.resolve(word === 'befor' ? ['before', 'befog'] : [])
  }

  public isAccepted(word: string): boolean {
    return this.accepted.has(word)
  }

  public setAcceptedWords(words: readonly string[]): void {
    this.accepted = new Set(words)
    for (const listener of this.listeners) listener()
  }

  public onDidChangeAcceptedWords(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }
}
