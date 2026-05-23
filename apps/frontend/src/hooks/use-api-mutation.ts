'use client';

import { useMutation, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';

import { ApiError } from '@/lib/api-client';

/**
 * Thin wrapper around `useMutation` that fixes the error type to
 * `ApiError`. Lets call sites consume `mutation.error.code` without
 * narrowing through `unknown` on every form submit.
 */
export function useApiMutation<TData, TVariables>(
  mutationFn: (vars: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'>,
): UseMutationResult<TData, ApiError, TVariables> {
  return useMutation<TData, ApiError, TVariables>({ mutationFn, ...options });
}
