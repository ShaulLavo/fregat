import { expect, test } from 'vitest'
import { bundleImports } from './bundle-imports'

test('a merged conditional import charges either branch all of the helper preloads', () => {
  const graph = bundleImports(
    'assets/initial.js',
    `
    const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/workbench.js","assets/workbench.css"])))=>i.map(i=>d[i]);
    const load = kind => preload(kind === 'phone' ? () => import('./phone.js') : () => import('./workbench.js'), __vite__mapDeps([0,1]));
  `,
  )
  expect([...graph.dynamic.get('assets/phone.js')!]).toEqual([
    'assets/workbench.js',
    'assets/workbench.css',
  ])
})

test('separate loaders keep desktop preloads out of the phone branch', () => {
  const graph = bundleImports(
    'assets/initial.js',
    `
    import './shared.js';
    const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/workbench.js","assets/phone-shared.js"])))=>i.map(i=>d[i]);
    function phone() { return preload(() => import(\`./phone.js\`), __vite__mapDeps([1])) }
    function desktop() { return preload(() => import('./workbench.js'), __vite__mapDeps([0])) }
  `,
  )
  expect([...graph.imports]).toEqual(['assets/shared.js'])
  expect([...graph.dynamic.get('assets/phone.js')!]).toEqual(['assets/phone-shared.js'])
})
