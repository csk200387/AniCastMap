interface Pending<T> { promise: Promise<T>; controller: AbortController; users: number }
const abortError = () => new DOMException('Aborted', 'AbortError');
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw abortError(); };
// Each subscriber cancels independently. Transport is cancelled only when nobody remains.
export function memo<T>(namespace?: string) {
  const cache = new Map<string, T>();
  const pending = new Map<string, Pending<T>>();
  return (key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(abortError());
    const storageKey = namespace ? `anicast:v1:${namespace}:${key}` : null;
    if (storageKey && !cache.has(key)) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
        if (saved && saved.expires > Date.now()) cache.set(key, saved.value as T);
        else sessionStorage.removeItem(storageKey);
      } catch { /* unavailable storage is optional */ }
    }
    if (cache.has(key)) return Promise.resolve(cache.get(key)!);
    let task = pending.get(key);
    if (!task || task.controller.signal.aborted) {
      const controller = new AbortController();
      const created: Pending<T> = { controller, users: 0, promise: Promise.resolve().then(() => load(controller.signal)) };
      created.promise = created.promise.then(value => { checkAbort(controller.signal); cache.set(key, value);
        if (storageKey) try { sessionStorage.setItem(storageKey, JSON.stringify({ expires: Date.now() + 86400000, value })); } catch { /* quota / private mode */ }
        return value; }).finally(() => {
        if (pending.get(key) === created) pending.delete(key);
      });
      pending.set(key, created); task = created;
    }
    const shared = task;
    shared.users++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true; signal?.removeEventListener('abort', onAbort);
        if (--shared.users === 0) shared.controller.abort();
        return true;
      };
      const onAbort = () => { if (finish()) reject(abortError()); };
      signal?.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
    });
  };
}
