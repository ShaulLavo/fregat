import { createSemanticTokenStyles } from '@singapore-editor/core/syntax'
import { describe } from 'vitest'
import { test as it, expect } from '../../../../test/fixtures'
import { SEMANTIC_TOKEN_LEGENDS } from '../../../../test/factories/semantic-token-legends'

import { SEMANTIC_TOKEN_SERVER_IDS, semanticTokenProfileFor } from '@/lib/semantic-token-servers'

/**
 * Coverage, not vibes.
 *
 * A token name that resolves to nothing paints nothing, and what shows through
 * is the syntactic colour that was already there — so by eye a legend two thirds
 * on the floor is indistinguishable from one that worked. This is the assertion
 * that would have caught 38 of rust-analyzer's 57 types dropping silently, and
 * it reads the same resolver the paint layer reads.
 */
describe('semantic token alias coverage', () => {
  for (const { serverId, runtime, tokenTypes: legend } of SEMANTIC_TOKEN_LEGENDS) {
    it(`resolves or deliberately declines every name ${runtime} advertises`, () => {
      const profile = semanticTokenProfileFor(serverId)
      const styles = createSemanticTokenStyles({ scopeAliases: profile.scopeAliases })

      const unexplained = [...new Set(legend)].filter(
        (name) => styles.resolve(name) === null && !(name in profile.uncovered),
      )

      expect(unexplained).toEqual([])
    })

    it(`paints nothing for the names ${runtime} is declared not to cover`, () => {
      const profile = semanticTokenProfileFor(serverId)
      const styles = createSemanticTokenStyles({ scopeAliases: profile.scopeAliases })

      // The other direction, and it is the half that rots: a name listed as
      // uncovered which later starts resolving is a stale entry claiming a gap
      // that closed, and the list is only worth reading if every row is live.
      for (const name of Object.keys(profile.uncovered)) {
        expect(styles.resolve(name)).toBeNull()
      }
    })
  }

  it('leaves nothing uncovered that the server is confident about', () => {
    const profile = semanticTokenProfileFor('rust')

    // The two rust-analyzer names this app refuses on purpose: both mean the
    // server does *not* know, and confident colour over either would be a lie
    // the diagnostics layer then has to argue with.
    expect(profile.uncovered.unresolvedReference).toBe('server-uncertain')
    expect(profile.uncovered.invalidEscapeSequence).toBe('server-uncertain')
  })

  it('maps every alias onto a scope the theme actually resolves', () => {
    const styles = createSemanticTokenStyles({})

    for (const serverId of SEMANTIC_TOKEN_SERVER_IDS) {
      const { scopeAliases } = semanticTokenProfileFor(serverId)
      for (const [name, scope] of Object.entries(scopeAliases)) {
        // An alias pointing at a scope with no rule is worse than no alias: it
        // reads as covered and paints nothing.
        expect({ name, resolved: styles.resolve(scope) !== null, scope, serverId }).toMatchObject({
          resolved: true,
        })
      }
    }
  })
})

/**
 * shiki already paints a method `entity.name.function.member` — yellow in Dark+ — and the semantic
 * layer paints over it. An alias that resolved a method to the field colour turned every method in
 * every file blue, which is the one way this feature can make a theme look worse than no feature.
 */
describe('typescript member scope', () => {
  it('resolves a class member to the method scope, not the property scope', () => {
    const profile = semanticTokenProfileFor('typescript')

    expect(profile.scopeAliases.member).toBe('method')
  })
})
