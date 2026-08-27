import { useState } from 'react'
import { login } from './api'
import { PulseIcon } from './icons'
import { t } from './i18n'

// Login screen, shown when the server runs with PULSE_PASSWORD set.
export function Login() {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    try {
      await login(user, password)
      location.reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="login-screen">
      <div className="modal about">
        <div className="modal-title">
          <span className="brand">
            <span className="brand-icon">
              <PulseIcon size={16} />
            </span>
            pulse
          </span>
        </div>
        <label className="var-row login-row">
          <span className="mono muted">{t('loginField')}</span>
          <input
            value={user}
            autoFocus
            name="pulse-login"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            onChange={(e) => setUser(e.target.value)}
          />
        </label>
        <label className="var-row login-row">
          <span className="mono muted">{t('passwordField')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </label>
        {error && <div className="bad login-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn primary" onClick={() => void submit()}>
            {t('signIn')}
          </button>
        </div>
      </div>
    </div>
  )
}
