import type { Renderable } from '@opentui/core'

export function onRenderableResize<T extends Renderable>(onResize: (renderable: T) => void) {
  return function (this: T) {
    onResize(this)
  }
}
