import { parentPort, workerData } from 'node:worker_threads'
import { unzipSync } from 'fflate'

// All inflation, including small/incompressible entries, stays off the HTTP thread.
const names = new Set(workerData.names)
const files = unzipSync(workerData.bytes, { filter: entry => names.has(entry.name) })
const buffers = [...new Set(Object.values(files).map(bytes => bytes.buffer))]
parentPort.postMessage(files, buffers)
