import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

export function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    render: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}
