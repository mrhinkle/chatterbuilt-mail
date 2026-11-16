/**
 * One shared start. A rejected start is forgotten, so the next call tries again.
 * A successful start is reused.
 */
export function rememberStart<T>(start: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (pending) return pending;
    const settle = start().then(
      (value) => value,
      (error: unknown) => {
        if (pending === settle) pending = undefined;
        throw error;
      },
    );
    pending = settle;
    return settle;
  };
}
