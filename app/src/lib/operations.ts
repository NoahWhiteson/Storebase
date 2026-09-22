import { useSyncExternalStore } from 'react'

export type Operation = { id: number; label: string; detail: string; progress?: number; state: 'running' | 'done' | 'error' | 'leaving' }
let operations: Operation[] = []
let sequence = 0
const listeners = new Set<() => void>()
function emit() { for (const listener of listeners) listener() }
export function beginOperation(label: string, detail = '') {
  const id = ++sequence
  operations = [...operations, { id, label, detail, state: 'running' }]
  emit()
  return {
    progress(detail: string, progress?: number) {
      operations = operations.map(op => op.id === id ? { ...op, detail, progress } : op)
      emit()
    },
    finish(error?: unknown) {
      operations = operations.map(op => op.id === id ? { ...op, state: error ? 'error' : 'done', progress: error ? op.progress : 100, detail: error instanceof Error ? error.message : error ? String(error) : op.detail } : op)
      emit()
      if (!error) window.setTimeout(() => dismissOperation(id), 8000)
    },
  }
}
export function dismissOperation(id: number) {
  const target = operations.find(op => op.id === id)
  if (!target || target.state === 'running' || target.state === 'leaving') return
  operations = operations.map(op => op.id === id ? { ...op, state: 'leaving' } : op)
  emit()
  window.setTimeout(() => {
    operations = operations.filter(op => op.id !== id)
    emit()
  }, 280)
}
export function useOperations() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => operations)
}

/** Keep the browser responsive and wait for every started request on failure. */
export async function runBatch<T>(items: T[], work: (item: T) => Promise<unknown>, concurrency = 3): Promise<void> {
  let cursor = 0
  const errors: unknown[] = []
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      try { await work(item) } catch (error) { errors.push(error) }
    }
  }))
  if (errors.length) throw errors[0]
}
