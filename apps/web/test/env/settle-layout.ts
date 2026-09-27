import { act } from 'react'

/** Waits for browser layout delivery and the React work it schedules. */
export async function settleLayout(element: Element): Promise<void> {
  const previousEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await act(() => observeLayout(element))
  } finally {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousEnvironment)
  }
}

function observeLayout(element: Element): Promise<void> {
  return new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      observer.disconnect()
      resolve()
    })
    observer.observe(element)
  })
}
