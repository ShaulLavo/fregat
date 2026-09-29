import { defineMetadata } from './metadata'

export const environmentCommandMetadata = {
  'environment.switch': defineMetadata({
    id: 'environment.switch',
    title: 'Switch machine',
    category: 'Machines',
    description: 'Switch to a connected machine and bring back its open tabs and panels.',
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
    description: 'Disconnect a machine. Its open tabs and panels come back when you reconnect.',
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
