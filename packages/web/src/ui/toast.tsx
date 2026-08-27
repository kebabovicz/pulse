import { useEffect, useState } from 'react'
import { Cross } from '../icons'

interface Toast {
  id: number
  text: string
}

const TOAST_MS = 6000

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<(items: Toast[]) => void>()

const publish = () => {
  for (const listener of listeners) listener(toasts)
}

const dismiss = (id: number) => {
  toasts = toasts.filter((toast) => toast.id !== id)
  publish()
}

/** Reports a failure in the corner of the app — the browser alert stops the whole page. */
export function notify(text: string): void {
  const toast = { id: nextId++, text }
  toasts = [...toasts, toast]
  publish()
  setTimeout(() => dismiss(toast.id), TOAST_MS)
}

/** Mounted once by the shell; every notify() lands here. */
export function Toasts() {
  const [items, setItems] = useState(toasts)
  useEffect(() => {
    listeners.add(setItems)
    return () => {
      listeners.delete(setItems)
    }
  }, [])
  if (items.length === 0) return null
  return (
    <div className="toasts">
      {items.map((toast) => (
        <button key={toast.id} className="toast" onClick={() => dismiss(toast.id)}>
          <span className="toast-text">{toast.text}</span>
          <Cross size={11} />
        </button>
      ))}
    </div>
  )
}
