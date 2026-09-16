export async function copyText(
  text: string,
  from?: HTMLInputElement | HTMLTextAreaElement | null,
): Promise<boolean> {
  if (from) {
    from.focus()
    from.select()
    try {
      from.setSelectionRange(0, from.value.length)
    } catch {
      // some inputs reject setSelectionRange
    }
    try {
      if (document.execCommand('copy')) return true
    } catch {
      // fall through
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // HTTP and some embeds block clipboard.writeText. Fall through.
    }
  }
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.top = '0'
  el.style.left = '0'
  el.style.width = '1px'
  el.style.height = '1px'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  el.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(el)
  return ok
}
