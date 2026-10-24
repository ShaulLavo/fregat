import type { Theme } from 'shiki/textmate'

type TextmateScopePath = NonNullable<Parameters<Theme['match']>[0]>

/** Structural implementation of TextMate's scope path, whose constructor is not exported. */
export class ScopePath implements TextmateScopePath {
  constructor(
    readonly parent: TextmateScopePath | null,
    readonly scopeName: string,
  ) {}

  push(scopeName: string): ScopePath {
    return new ScopePath(this, scopeName)
  }

  getSegments(): string[] {
    const names = [this.scopeName]
    for (let path = this.parent; path; path = path.parent) names.push(path.scopeName)
    return names.reverse()
  }

  toString(): string {
    return this.getSegments().join(' ')
  }

  extends(other: TextmateScopePath): boolean {
    return this.getExtensionIfDefined(other) !== undefined
  }

  getExtensionIfDefined(base: TextmateScopePath | null): string[] | undefined {
    const names = this.getSegments()
    const prefix = base?.getSegments() ?? []
    if (prefix.length > names.length) return undefined
    if (prefix.some((name, index) => names[index] !== name)) return undefined
    return names.slice(prefix.length)
  }
}
