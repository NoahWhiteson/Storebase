/** Bounded I/O concurrency. Wait for started work before propagating failures. */
export async function mapConcurrent<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  let failed = false
  let failure: unknown
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++
      try { results[index] = await work(items[index], index) }
      catch (error) { failed = true; failure = error }
    }
  }))
  if (failed) throw failure
  return results
}

const locks = new Map<string, Promise<void>>()
export async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  locks.set(key, current)
  await previous
  try { return await work() }
  finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}
