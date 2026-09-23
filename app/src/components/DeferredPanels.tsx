import { lazy, Suspense, type ComponentProps } from 'react'
export type { SettingsSection } from './Settings'

const SettingsPanel = lazy(() => import('./Settings').then(module => ({ default: module.Settings })))
const TerminalPanel = lazy(() => import('./Terminals').then(module => ({ default: module.Terminals })))
const FilePreviewPanel = lazy(() => import('./FilePreview').then(module => ({ default: module.FilePreview })))

export function Settings(props: ComponentProps<typeof SettingsPanel>) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-white/60">Loading settings…</p>}><SettingsPanel {...props} /></Suspense>
}
export function Terminals(props: ComponentProps<typeof TerminalPanel>) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-white/60">Loading terminals…</p>}><TerminalPanel {...props} /></Suspense>
}
export function FilePreview(props: ComponentProps<typeof FilePreviewPanel>) {
  return <Suspense fallback={<div role="status" className="flex h-full min-h-64 items-center justify-center bg-[#141414] text-sm text-white/60">Opening preview…</div>}><FilePreviewPanel {...props} /></Suspense>
}
