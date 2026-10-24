import type { FoldGutterIconContext } from '@singapore-editor/gutters'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
// Font Awesome Free v7.2.0 chevron-down path, https://fontawesome.com/license/free
const FOLD_CHEVRON_PATH =
  'M297.4 438.6C309.9 451.1 330.2 451.1 342.7 438.6L502.7 278.6C515.2 266.1 515.2 245.8 502.7 233.3C490.2 220.8 469.9 220.8 457.4 233.3L320 370.7L182.6 233.4C170.1 220.9 149.8 220.9 137.3 233.4C124.8 245.9 124.8 266.2 137.3 278.7L297.3 438.7z'

export function createFoldChevronIcon({ document }: FoldGutterIconContext): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
  svg.classList.add('app-fold-chevron')
  svg.setAttribute('viewBox', '0 0 640 640')

  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  path.setAttribute('d', FOLD_CHEVRON_PATH)
  svg.append(path)
  return svg
}
