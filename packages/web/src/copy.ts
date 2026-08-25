import { t } from './i18n'

/**
 * Копирует текст и показывает плашку «copied», всплывающую от курсора.
 * Императивно через DOM: анимация чисто презентационная, состояние не нужно.
 */
export function copyWithBadge(text: string, e: { clientX: number; clientY: number }): void {
  void navigator.clipboard.writeText(text)
  const badge = document.createElement('span')
  badge.className = 'copy-float'
  badge.textContent = t('copied')
  badge.style.left = `${e.clientX}px`
  badge.style.top = `${e.clientY - 30}px`
  document.body.appendChild(badge)
  badge.addEventListener('animationend', () => badge.remove())
  setTimeout(() => badge.remove(), 1500) // страховка при reduced-motion
}
