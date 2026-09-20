export async function settleAnimations(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const animations = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime),
      )
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})))
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}
