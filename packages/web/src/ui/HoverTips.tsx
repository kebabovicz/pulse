import { useEffect, useState } from 'react'

const DELAY_MS = 250

/**
 * One tooltip for the whole app: any element carrying a `title` shows it in the
 * app's own popup instead of the browser's, which matters where a value is cut
 * off by its column — the full text is then only available on hover.
 * The native `title` is removed while the popup is up so the two never stack.
 */
export function HoverTips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let armed: HTMLElement | undefined

    const restore = () => {
      if (!armed) return
      const text = armed.dataset.tipText
      if (text !== undefined) {
        armed.setAttribute('title', text)
        delete armed.dataset.tipText
      }
      armed = undefined
    }

    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[title]')
      if (!el || el === armed) return
      const text = el.getAttribute('title')
      if (text === null || text === '') return
      clearTimeout(timer)
      restore()
      armed = el
      el.dataset.tipText = text
      el.removeAttribute('title')
      const { clientX: x, clientY: y } = e
      timer = setTimeout(() => setTip({ text, x, y }), DELAY_MS)
    }

    const out = (e: MouseEvent) => {
      if (!armed || armed.contains(e.relatedTarget as Node | null)) return
      clearTimeout(timer)
      restore()
      setTip(null)
    }

    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    window.addEventListener('scroll', () => setTip(null), true)
    return () => {
      clearTimeout(timer)
      restore()
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
    }
  }, [])

  if (!tip) return null
  return (
    <span className="hover-tip wrapping" style={{ left: Math.min(tip.x, window.innerWidth - 340), top: tip.y + 14 }}>
      {tip.text}
    </span>
  )
}
