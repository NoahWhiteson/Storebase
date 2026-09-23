export type ThemePreference = 'light' | 'dark' | 'system'

export function applyTheme(preference: ThemePreference): () => void {
  const media = window.matchMedia('(prefers-color-scheme: light)')
  const update = () => {
    const light = preference === 'light' || (preference === 'system' && media.matches)
    document.documentElement.classList.toggle('theme-light', light)
    document.documentElement.style.colorScheme = light ? 'light' : 'dark'
  }
  update()
  if (preference === 'system') media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}
