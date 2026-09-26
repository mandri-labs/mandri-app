import { useCallback, useSyncExternalStore } from "react";
import type { StoreApi } from "zustand";

export function useStore<TState, TSelected>(
  store: StoreApi<TState>,
  selector: (state: TState) => TSelected,
): TSelected {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );
  const getSnapshot = useCallback(() => selector(store.getState()), [store, selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function createCachedSelector<TState, TSource, TResult>(
  source: (state: TState) => TSource,
  compute: (source: TSource) => TResult,
): (state: TState) => TResult {
  let cache: { source: TSource; result: TResult } | undefined;
  return (state: TState) => {
    const nextSource = source(state);
    if (cache === undefined || cache.source !== nextSource) {
      cache = { source: nextSource, result: compute(nextSource) };
    }
    return cache.result;
  };
}
