import { useEffect, useRef, useState } from 'react'
import { saveVarDefaults, type ScenarioVar } from './api'
import { Check, Cross, Eye, EyeOff } from './icons'
import { t } from './i18n'

/** Built-in generators, offered as one-click inserts (SPEC.md). */
const GENERATORS = [
  '{{random.phone}}',
  '{{random.uuid}}',
  '{{random.digits(6)}}',
  '{{random.string(8)}}',
  '{{timestamp}}',
  '{{runStartedAt}}',
]

/**
 * Default values of scenario variables, editable in place. This is where a
 * stand keeps its secrets: CI runs read the same file, so updating a password
 * here is all it takes to keep the deploy suite green.
 */
export function ScenarioVars({ project, path, vars }: { project: string; path: string; vars: ScenarioVar[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v.name, v.default])),
  )
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const rootRef = useRef<HTMLElement>(null)

  // a click anywhere outside the section puts the generator hints away
  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setActive(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [active])

  const dirty = vars.some((v) => values[v.name] !== v.default)

  const save = async () => {
    const changed = Object.fromEntries(
      vars.filter((v) => values[v.name] !== v.default).map((v) => [v.name, values[v.name]]),
    )
    try {
      await saveVarDefaults(project, path, changed)
    } catch (e) {
      return alert((e as Error).message)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  /** Inserts a generator at the caret of the focused field. */
  const insert = (name: string, snippet: string) => {
    const input = inputs.current.get(name)
    const current = values[name] ?? ''
    const at = input?.selectionStart ?? current.length
    const next = current.slice(0, at) + snippet + current.slice(input?.selectionEnd ?? at)
    setValues({ ...values, [name]: next })
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(at + snippet.length, at + snippet.length)
    })
  }

  const toggleShown = (name: string) =>
    setShown((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <section className="scn-section" ref={rootRef}>
      <header>
        {t('variables')}
        <span className="muted vars-hint">{t('defaultsHint')}</span>
        {saved && (
          <span className="ok vars-saved">
            <Check size={12} /> {t('saved')}
          </span>
        )}
        <button className="btn primary vars-save" disabled={!dirty} onClick={() => void save()}>
          {t('save')}
        </button>
      </header>
      {vars.map((v) => (
        <div key={v.name} className="scn-var editable">
          <span className="kv-origin">var</span>
          <span className="kv-key">{v.name}</span>
          <input
            ref={(el) => {
              if (el) inputs.current.set(v.name, el)
            }}
            className="filter-input var-input"
            onFocus={() => setActive(v.name)}
            type={v.secret && !shown.has(v.name) ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            data-bwignore="true"
            data-1p-ignore="true"
            data-lpignore="true"
            value={values[v.name] ?? ''}
            onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
          />
          <span className="scn-var-source">
            {values[v.name] !== v.default && (
              <button
                className="icon-btn"
                title={t('resetValue')}
                onClick={() => setValues({ ...values, [v.name]: v.default })}
              >
                <Cross size={12} />
              </button>
            )}
            {v.secret && (
              <button
                className="icon-btn"
                title={shown.has(v.name) ? t('hideValue') : t('showValue')}
                onClick={() => toggleShown(v.name)}
              >
                {shown.has(v.name) ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            )}
          </span>
          <span className="muted scn-var-source">
            {v.secret ? <span className="warn">{t('secret')}</span> : t('defaultLabel')}
          </span>
          {active === v.name && (
            <div className="var-generators">
              <span className="muted">{t('generators')}</span>
              {GENERATORS.map((snippet) => (
                <button
                  key={snippet}
                  className="chip generator"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(v.name, snippet)}
                >
                  {snippet}
                </button>
              ))}
              <span className="muted var-generators-hint">{t('generatorsHint')}</span>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
