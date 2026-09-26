export const railMutationKeys = {
  lifecycle: (environmentId: string) => ['agent-rail', environmentId, 'lifecycle'] as const,
}
