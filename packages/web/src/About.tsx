import { Cross, PulseIcon } from './icons'
import { t } from './i18n'

export const APP_VERSION = '0.1.0'

// The about dialog: the single place with product and author information.
export function About({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal about" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <span className="brand">
            <span className="brand-icon">
              <PulseIcon size={16} />
            </span>
            pulse <span className="muted">v{APP_VERSION}</span>
          </span>
          <button className="icon-btn modal-close" onClick={onClose}>
            <Cross size={16} />
          </button>
        </div>
        <div className="about-line">{t('aboutTagline')}</div>
        <div className="about-grid">
          <span className="muted">{t('aboutAuthor')}</span>
          <span className="mono">kebabovicz</span>
          <span className="muted">github</span>
          <a className="mono accent" href="https://github.com/kebabovicz" target="_blank" rel="noreferrer">
            github.com/kebabovicz
          </a>
          <span className="muted">email</span>
          <a className="mono accent" href="mailto:kebabovicz@gmail.com">
            kebabovicz@gmail.com
          </a>
        </div>
      </div>
    </div>
  )
}
