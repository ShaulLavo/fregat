export const pdfMutationKeys = {
  engine: ['pdf', 'load-engine'],
  presentation: ['pdf', 'load-presentation'],
  open: ['pdf', 'open'],
  render: (page: number) => ['pdf', 'render', page],
} as const
