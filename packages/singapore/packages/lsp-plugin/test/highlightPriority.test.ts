import { SEMANTIC_TOKEN_Z_INDEX } from '@singapore-editor/core/extensions'
import { FIND_HIGHLIGHT_Z_INDEX } from '@singapore-editor/find'
import { BRACKET_COLOR_Z_INDEX } from '@singapore-editor/scope-lines'
import { describe, expect, it } from 'vitest'

import { DIAGNOSTIC_STYLES } from '../src/plugin.styles'

/**
 * The one regression test for a cross-package agreement nothing else enforces.
 *
 * `Highlight.priority` is a single document-global namespace that five subsystems write into from
 * four packages, and priority only decides between highlights that declare the *same* property —
 * the CSS Custom Highlight API resolves per property. So the only real contest is for `color`, and
 * exactly five producers declare one:
 *
 * | producer                   | priority | why it sits there                                   |
 * | -------------------------- | -------- | --------------------------------------------------- |
 * | syntax token highlights    | 0        | the colour everything else refines                  |
 * | `BRACKET_COLOR_Z_INDEX`    | 1        | replaces the grammar's colour on a bracket glyph     |
 * | the semantic token layer   | 2        | refines both; must not hide an error                 |
 * | `DIAGNOSTIC_STYLES.error`  | 3        | a problem outranks a shade of meaning                |
 * | `FIND_CURRENT_STYLE`       | 6        | an answer to a question the user just asked          |
 *
 * Bracket depth colouring is the one this table used to omit, and it sat on the semantic layer's
 * number. Nothing painted wrong, because no semantic scope covers a bracket glyph today — which is
 * exactly what makes an omission like that survive: it is latent until a host writes one
 * `scopeAliases` entry mapping a server's `brace` onto a scope the theme colours. An enumeration
 * that is only accidentally complete is what this file exists to stop.
 *
 * Before this ordering was declared, the error style carried no `zIndex` at all and sat at 0
 * alongside every token highlight — so whether an error's red text survived over a syntax-coloured
 * identifier came down to which style key the document's shared registry had seen first, which is a
 * function of session history rather than of anything anyone chose.
 *
 * The assertions below read the real values from the three packages rather than restating them,
 * because a test that restated them would go on passing while the thing it guards drifted.
 */
describe('the highlight priority band', () => {
  const SYNTAX_TOKEN_Z_INDEX = 0

  it('orders all five producers that declare a colour', () => {
    expect(SYNTAX_TOKEN_Z_INDEX).toBeLessThan(BRACKET_COLOR_Z_INDEX)
    expect(BRACKET_COLOR_Z_INDEX).toBeLessThan(SEMANTIC_TOKEN_Z_INDEX)
    expect(SEMANTIC_TOKEN_Z_INDEX).toBeLessThan(DIAGNOSTIC_STYLES.error.zIndex ?? 0)
    expect(DIAGNOSTIC_STYLES.error.zIndex ?? 0).toBeLessThan(FIND_HIGHLIGHT_Z_INDEX.current)
  })

  /**
   * Every colour producer on its own number. A tie is resolved by registry insertion order — "which
   * style key this document's shared registry saw first" — which is the condition the whole band
   * exists to remove, so a tie anywhere in it is a defect wherever it happens to be latent.
   */
  it('leaves no two colour producers sharing a number', () => {
    const colors = [
      SYNTAX_TOKEN_Z_INDEX,
      BRACKET_COLOR_Z_INDEX,
      SEMANTIC_TOKEN_Z_INDEX,
      DIAGNOSTIC_STYLES.error.zIndex ?? 0,
      FIND_HIGHLIGHT_Z_INDEX.current,
    ]

    expect(new Set(colors).size).toBe(colors.length)
  })

  it('pins the numbers themselves, so a change has to be deliberate', () => {
    expect(BRACKET_COLOR_Z_INDEX).toBe(1)
    expect(SEMANTIC_TOKEN_Z_INDEX).toBe(2)
    expect(DIAGNOSTIC_STYLES.error.zIndex).toBe(3)
    expect(FIND_HIGHLIGHT_Z_INDEX.scope).toBe(4)
    expect(FIND_HIGHLIGHT_Z_INDEX.match).toBe(5)
    expect(FIND_HIGHLIGHT_Z_INDEX.current).toBe(6)
  })

  /**
   * `color` is not the only property two producers can both declare, and an earlier version of this
   * band forgot it: the error diagnostic carries a **background** and an underline as well as a
   * colour, and all three find styles carry a background. Giving the error the find match's number
   * would have left that contest to registration order — the exact condition the numbers exist to
   * remove, moved from one property to another.
   */
  it('leaves no two background producers sharing a number', () => {
    const backgrounds = [
      DIAGNOSTIC_STYLES.error.zIndex ?? 0,
      FIND_HIGHLIGHT_Z_INDEX.scope,
      FIND_HIGHLIGHT_Z_INDEX.match,
      FIND_HIGHLIGHT_Z_INDEX.current,
    ]

    expect(new Set(backgrounds).size).toBe(backgrounds.length)
  })

  /**
   * And the order among them is the one that shipped before the error was given a number at all,
   * when it sat at the implicit 0 and every find highlight outranked it. Renumbering find upwards
   * rather than moving the error down is what keeps that true.
   */
  it('keeps every find highlight above the error background', () => {
    const error = DIAGNOSTIC_STYLES.error.zIndex ?? 0
    expect(FIND_HIGHLIGHT_Z_INDEX.scope).toBeGreaterThan(error)
    expect(FIND_HIGHLIGHT_Z_INDEX.match).toBeGreaterThan(error)
    expect(FIND_HIGHLIGHT_Z_INDEX.current).toBeGreaterThan(error)
  })

  it('leaves the sub-error diagnostics at the default, since none declares a colour', () => {
    for (const severity of ['warning', 'information', 'hint'] as const) {
      expect(DIAGNOSTIC_STYLES[severity].color, severity).toBeUndefined()
      expect(DIAGNOSTIC_STYLES[severity].zIndex, severity).toBeUndefined()
    }
  })
})
