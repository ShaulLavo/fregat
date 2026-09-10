import { defineMetadata } from './metadata'

export const environmentCommandMetadata = {
  'environment.switch': defineMetadata({
    id: 'environment.switch',
    title: 'Switch machine',
    category: 'Machines',
    description: 'Switch to a connected machine and restore its workbench.',
    execution: 'sync',
    target: 'workspace',
    undoCategory: 'view-only',
    when: [],
  }),
  'environment.connect': defineMetadata({
    id: 'environment.connect',
    title: 'Connect machine',
    category: 'Machines',
    description: 'Add a new machine or connect a saved machine.',
    execution: 'sync',
    target: 'workspace',
    undoCategory: 'view-only',
    when: [],
  }),
  'environment.disconnect': defineMetadata({
    id: 'environment.disconnect',
    title: 'Disconnect machine',
    category: 'Machines',
    description: 'Disconnect a machine while keeping its cached workbench.',
    execution: 'sync',
    target: 'workspace',
    undoCategory: 'view-only',
    when: [],
  }),
  'environment.openMachines': defineMetadata({
    id: 'environment.openMachines',
    title: 'Open Machines settings',
    category: 'Machines',
    description: 'Add, edit, or connect machines.',
    execution: 'sync',
    target: 'workspace',
    undoCategory: 'view-only',
    when: [],
  }),
}
