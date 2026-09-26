import { expect, test } from 'vitest'
import {
  personalities,
  springCurve,
  springPosition,
  updateSpringTokens,
} from './generate-spring-easings'

test('the committed spring tokens match the generator', async () => {
  expect(await updateSpringTokens(true)).toBe(true)
})

test.each(Object.entries(personalities))(
  '%s springs settle and overshoot according to damping',
  (_name, roles) => {
    for (const spring of Object.values(roles)) {
      const { samples, duration } = springCurve(spring)
      expect(samples[0]).toBe(0)
      expect(samples.at(-1)).toBe(1)
      const [stiffness, damping, mass] = spring
      expect(Math.max(...samples) > 1).toBe(damping < 2 * Math.sqrt(stiffness * mass))
      for (let ms = duration; ms < duration + 2000; ms += 10) {
        expect(Math.abs(1 - springPosition(spring, ms / 1000))).toBeLessThanOrEqual(0.001)
      }
    }
  },
)
