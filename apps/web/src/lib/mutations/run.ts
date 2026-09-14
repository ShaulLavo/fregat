import {
  MutationObserver,
  type DefaultError,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query'

export async function runMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
>(
  queryClient: QueryClient,
  options: MutationOptions<TData, TError, TVariables, TContext>,
  variables: TVariables,
): Promise<TData> {
  const observer = new MutationObserver(queryClient, options)
  try {
    return await observer.mutate(variables)
  } finally {
    // An attached observer pins the mutation in the cache; nobody reads this one.
    observer.reset()
  }
}
