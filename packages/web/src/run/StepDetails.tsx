import { Check, Cross } from '../icons'
import { t } from '../i18n'
import { JsonTree } from '../JsonTree'
import type { RunState, StepView } from '../runState'
import { CopyButton } from '../ui/CopyButton'
import { Seg, useViewMode } from '../ui/Seg'
import { checkLabel } from './labels'

function toCurl(r: NonNullable<StepView['result']>['request'] & object): string {
  const parts = [`curl -X ${r.method} '${r.url}'`]
  for (const [name, value] of Object.entries(r.headers)) parts.push(`-H '${name}: ${value}'`)
  if (r.body !== null) parts.push(`--data '${r.body.replaceAll("'", String.raw`'\''`)}'`)
  return parts.join(' \\\n  ')
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function isStructuredJson(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return false
  }
}

function RequestBodyRows({ body }: { body: string }) {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return <pre className="body-text">{body}</pre>
  }
  return (
    <>
      {Object.entries(parsed as Record<string, unknown>).map(([key, value]) => (
        <div key={key} className="kv-row">
          <span className="kv-origin">body</span>
          <span className="kv-key">{key}</span>
          <span className="mono clip">{typeof value === 'string' ? `"${value}"` : JSON.stringify(value)}</span>
        </div>
      ))}
    </>
  )
}

/** Expanded step: checks, request, response and captured variables. */
export function StepDetails({ step, state, projectId }: { step: StepView; state: RunState; projectId: string }) {
  const r = step.result!
  const checks = r.checks ?? []
  const sorted = [...checks].sort((a, b) => Number(a.passed) - Number(b.passed))
  const [reqMode, setReqMode] = useViewMode(projectId, 'req', 'tree')
  const [respMode, setRespMode] = useViewMode(projectId, 'resp', 'tree')
  // Tree and JSON only make sense for a structured body: an object or an array
  const structured = Boolean(r.response?.contentType?.includes('json')) && isStructuredJson(r.response?.body ?? '')
  const respModes = [
    { id: 'tree', label: t('tree'), enabled: structured },
    { id: 'json', label: 'JSON', enabled: structured },
    { id: 'text', label: t('text'), enabled: !structured },
    { id: 'raw', label: t('raw'), enabled: true },
  ]
  const effRespMode = respModes.find((m) => m.id === respMode)?.enabled ? respMode : structured ? 'tree' : 'text'
  const rawResponse = r.response
    ? [
        `HTTP ${r.response.status}`,
        ...Object.entries(r.response.headers).map(([n, v]) => `${n}: ${v}`),
        '',
        r.response.body,
      ].join('\n')
    : ''
  const failed = checks.filter((c) => !c.passed).length

  return (
    <div className="step-details">
      {checks.length > 0 && (
        <section>
          <header>
            {t('checks')}
            {failed > 0 && ` · ${t('checksFailed', failed, checks.length)}`}
            <CopyButton text={checks.map((c) => `${checkLabel(c)}\t${c.expected}\t${c.actual ?? ''}`).join('\n')} />
          </header>
          {sorted.map((c, i) => (
            <div key={i} className={`check-row ${c.passed ? 'passed' : 'failed'}`}>
              <span className={c.passed ? 'ok' : 'bad'}>{c.passed ? <Check size={12} /> : <Cross size={12} />}</span>
              <span className="mono check-name" title={checkLabel(c)}>
                {checkLabel(c)}
              </span>
              <span className="muted check-label">{t('expected')}</span>
              <span className="mono check-value" title={c.expected}>
                {c.expected}
              </span>
              <span className="muted check-label">{t('actual')}</span>
              <span className={`mono check-value${c.passed ? '' : ' bad'}`} title={c.actual ?? '—'}>
                {c.actual ?? '—'}
              </span>
            </div>
          ))}
        </section>
      )}
      {r.request && (
        <section>
          <header>
            {t('request')}
            <Seg
              modes={[
                { id: 'tree', label: t('fields'), enabled: true },
                { id: 'curl', label: 'cURL', enabled: true },
                { id: 'raw', label: t('raw'), enabled: true },
              ]}
              mode={reqMode}
              onPick={setReqMode}
            />
            <CopyButton text={toCurl(r.request)} />
          </header>
          {reqMode === 'curl' ? (
            <pre className="body-text">{toCurl(r.request)}</pre>
          ) : reqMode === 'raw' ? (
            <pre className="body-text">
              {[
                `${r.request.method} ${r.request.url}`,
                ...Object.entries(r.request.headers).map(([n, v]) => `${n}: ${v}`),
                ...(r.request.body !== null ? ['', r.request.body] : []),
              ].join('\n')}
            </pre>
          ) : (
            <>
              <div className="kv-row">
                <span className="kv-origin">url</span>
                <span className="kv-key">{r.request.method}</span>
                <span className="mono clip" title={r.request.url}>
                  {r.request.url}
                </span>
              </div>
              {Object.entries(r.request.headers).map(([name, value]) => {
                const sub = r.request!.substitutions.find((s) => s.location === `headers.${name}`)
                return (
                  <div key={name} className="kv-row">
                    <span className="kv-origin">header</span>
                    <span className="kv-key">{name}</span>
                    <span className="mono clip" title={value}>
                      {value}
                    </span>
                    {sub && (
                      <span className="sub-badge">
                        ← {sub.var}
                        {sub.fromStep && ` · ${sub.fromStep}`}
                      </span>
                    )}
                  </div>
                )
              })}
              {r.request.body && <RequestBodyRows body={r.request.body} />}
            </>
          )}
        </section>
      )}
      {r.response && (
        <section>
          <header>
            {t('response')} · {r.response.status} · {r.response.contentType?.split(';')[0] ?? '—'} ·{' '}
            {r.response.sizeBytes} B{r.response.bodyTruncated && ` · ${t('truncated')}`}
            {r.response.body !== '' && <Seg modes={respModes} mode={effRespMode} onPick={setRespMode} />}
            <CopyButton
              text={
                effRespMode === 'json'
                  ? prettyJson(r.response.body)
                  : effRespMode === 'raw'
                    ? rawResponse
                    : r.response.body
              }
            />
          </header>
          {r.response.body === '' ? null : effRespMode !== 'raw' && r.response.headers['set-cookie'] ? (
            <div className="kv-row">
              <span className="kv-origin">header</span>
              <span className="kv-key">set-cookie</span>
              <span className="mono clip" title={r.response.headers['set-cookie']}>
                {r.response.headers['set-cookie']}
              </span>
              {r.captures?.find((c) => c.from === 'cookie') && (
                <span className="sub-badge">{r.captures.find((c) => c.from === 'cookie')!.name}</span>
              )}
            </div>
          ) : null}
          {r.response.body === '' ? null : effRespMode === 'tree' ? (
            <JsonTree text={r.response.body} />
          ) : effRespMode === 'json' ? (
            <pre className="body-text">{prettyJson(r.response.body)}</pre>
          ) : effRespMode === 'raw' ? (
            <pre className="body-text">{rawResponse}</pre>
          ) : (
            <pre className="body-text">{r.response.body}</pre>
          )}
        </section>
      )}
      {(r.captures?.length ?? 0) > 0 && (
        <section>
          <header>
            {t('variables')}
            <CopyButton text={r.captures!.map((c) => `${c.name}=${c.value}`).join('\n')} />
          </header>
          {r.captures!.map((c) => {
            const usedBy = state.varUsage[c.name]?.usedBy ?? []
            return (
              <div key={c.name} className="capture-row">
                <span className="kv-origin">{c.from}</span>
                <span className="kv-key accent">{c.name}</span>
                <span className="mono clip capture-value" title={c.value}>
                  {c.value}
                </span>
                <span className="muted clip capture-detail" title={c.detail}>
                  {c.detail}
                </span>
                {usedBy.length > 0 && (
                  <span className="sub-badge" title={usedBy.join(', ')}>
                    {t('usedIn', usedBy.length)}
                  </span>
                )}
              </div>
            )
          })}
        </section>
      )}
      {r.error && (
        <section>
          <header className="bad">{t('error')}</header>
          <div className="kv-row mono">{r.error.message}</div>
        </section>
      )}
    </div>
  )
}
