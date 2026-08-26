import { copyWithBadge } from '../copy'
import { Copy } from '../icons'
import { t } from '../i18n'

/** Icon button that copies the given text. */
export function CopyButton({ text }: { text: string }) {
  return (
    <button className="icon-btn" title={t('copyHint')} onClick={(e) => copyWithBadge(text, e)}>
      <Copy size={13} />
    </button>
  )
}

/** A value that copies on click; the "copied" badge floats up from the cursor. */
export function CopyValue({ value }: { value: string }) {
  return (
    <span className="mono clip copy-value" title={t('copyHint')} onClick={(e) => copyWithBadge(value, e)}>
      {value}
    </span>
  )
}
