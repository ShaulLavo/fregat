import { el } from './dom.ts'

type AppViewMode = 'edit' | 'diff'

type TopBarHandlers = {
  readonly onEditMode: () => void
  readonly onDiffMode: () => void
}

export type TopBar = {
  readonly element: HTMLDivElement
  setRepositoryName(name: string): void
  setMessage(message: string): void
  setBusyState(isBusy: boolean): void
  setHandlers(handlers: TopBarHandlers): void
  setViewMode(mode: AppViewMode): void
}

class TopBarController implements TopBar {
  readonly element = el('div', { id: 'toolbar' })
  private readonly repositoryName = el('span', { id: 'dir-name' })
  private readonly editButton = toolbarButton('Edit')
  private readonly diffButton = toolbarButton('Diff')

  constructor() {
    this.element.append(this.repositoryName, this.editButton, this.diffButton)
    this.setViewMode('edit')
  }

  setRepositoryName(name: string): void {
    this.repositoryName.textContent = name
  }

  setMessage(message: string): void {
    this.repositoryName.textContent = message
  }

  setBusyState(_isBusy: boolean): void {
    return
  }

  setHandlers(handlers: TopBarHandlers): void {
    this.editButton.onclick = handlers.onEditMode
    this.diffButton.onclick = handlers.onDiffMode
  }

  setViewMode(mode: AppViewMode): void {
    this.editButton.setAttribute('aria-pressed', String(mode === 'edit'))
    this.diffButton.setAttribute('aria-pressed', String(mode === 'diff'))
  }
}

export function createTopBar(): TopBar {
  return new TopBarController()
}

function toolbarButton(label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  return button
}
