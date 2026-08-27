import { useState } from 'react'
import { Check, ChevronsDownUp, ChevronsUpDown, Cross } from '../icons'
import { t } from '../i18n'
import { JsonTree, treeSize } from '../JsonTree'
import type { PartSnapshot } from '@pulse/shared'
import type { RunState, StepView } from '../runState'
import { CopyButton, CopyValue } from '../ui/CopyButton'
import { ClipValue } from '../ui/ClipValue'
import { colWidth, cols } from '../ui/columns'
import { Seg, useViewMode } from '../ui/Seg'
import { checkLabel } from './labels'
import { cachedHint } from './StepRow'

const quote = (value: string): string => value.replaceAll("'", String.raw`'\''`)

/** A file part as curl writes it: the fixture path for a file, the value for a field. */
const curlPart = (p: PartSnapshot): string =>
  p.value !== undefined
    ? `-F '${quote(p.name)}=${quote(p.value)}'`
    : `-F '${quote(p.name)}=@${quote(p.source === 'inline' || p.source === 'base64' ? (p.filename ?? p.name) : (p.source ?? p.name))};type=${p.contentType ?? ''};filename=${quote(p.filename ?? p.name)}'`

function toCurl(r: NonNullable<StepView['result']>['request'] & object): string {
  const parts = [`curl -X ${r.method} '${r.url}'`]
  for (const [name, value] of Object.entries(r.headers)) parts.push(`-H '${name}: ${value}'`)
  for (const part of r.parts ?? []) parts.push(curlPart(part))
  if (r.body !== null) parts.push(`--data '${quote(r.body)}'`)
  return parts.join(' \\\n  ')
}

const bytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

/** One multipart part: a plain field shows its value, a file its name, type and size. */
const partValue = (p: PartSnapshot): string =>
  p.value !== undefined
    ? p.value
    : [p.filename, p.contentType, p.sizeBytes !== undefined && bytes(p.sizeBytes), p.source].filter(Boolean).join(' · ')

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

/** Above this many rows a body is worth a collapse switch of its own. */
const BIG_TREE = 20

/** Keys of a JSON object body, empty when the body is not one. */
function bodyKeys(body: string | null): string[] {
  if (body === null) return []
  try {
    const parsed: unknown = JSON.parse(body)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : []
  } catch {
    return []
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
          <ClipValue className="mono" text={typeof value === 'string' ? `"${value}"` : JSON.stringify(value)} />
        </div>
      ))}
    </>
  )
}

/** Expanded step: checks, request, response and captured variables. */
export function StepDetails({
  step,
  state,
  projectId,
  expandAll = false,
}: {
  step: StepView
  state: RunState
  projectId: string
  /** follows the run-wide "expand all steps" switch */
  expandAll?: boolean
}) {
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
  const statusOk = !checks.some((c) => c.kind === 'status' && !c.passed)
  // a body with many branches opens collapsed: the reader unfolds what they need
  const [treeOpen, setTreeOpen] = useState(expandAll)
  const [lastSwitch, setLastSwitch] = useState(expandAll)
  if (lastSwitch !== expandAll) {
    setLastSwitch(expandAll)
    setTreeOpen(expandAll)
  }
  const bigBody = effRespMode === 'tree' && treeSize(r.response?.body ?? '') > BIG_TREE

  return (
    <div className="step-details">
      {checks.length > 0 && (
        <section
          className="det-checks"
          style={cols({
            'key-col': colWidth(
              checks.map((c) => checkLabel(c) + '  '),
              40,
              12,
            ),
            'exp-col': colWidth(
              checks.map((c) => c.expected + '  '),
              44,
              10,
            ),
          })}
        >
          {sorted.map((c, i) => (
            <div key={i} className={`check-row ${c.passed ? 'passed' : 'failed'}`}>
              <span className={c.passed ? 'ok' : 'bad'}>{c.passed ? <Check size={12} /> : <Cross size={12} />}</span>
              <span className="mono check-name">{checkLabel(c)}</span>
              <span className="muted check-label">{t('expected')}</span>
              <ClipValue className="mono check-value" text={c.expected} />
              <span className="muted check-label">{t('actual')}</span>
              <ClipValue className={`mono check-value${c.passed ? '' : ' bad'}`} text={c.actual ?? '—'} />
            </div>
          ))}
        </section>
      )}
      {r.cached && (
        <section>
          <header>{t('cachedTitle')}</header>
          <div className="kv-row">
            <span className="kv-origin">cache</span>
            <span className="mono">{cachedHint(r)}</span>
          </div>
          {/* a cached step neither sends nor checks: say so where it is read */}
          <div className="kv-row muted">{t('cachedNoChecks')}</div>
        </section>
      )}
      {r.request && (
        <section
          className="det-request"
          style={cols({
            'key-col': colWidth(
              [
                ...Object.keys(r.request.headers),
                ...bodyKeys(r.request.body),
                ...(r.request.parts ?? []).map((p) => p.name),
              ].map((k) => k + '  '),
              40,
              12,
            ),
          })}
        >
          <header>
            <span className="detail-head-line">
              <span className="mono detail-head-method">{r.request.method}</span>
              <span className="mono detail-head-url" title={r.request.url}>
                {r.request.url}
              </span>
            </span>
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
                ...(r.request.parts
                  ? [
                      `content-type: ${r.request.contentType ?? ''}`,
                      '',
                      ...r.request.parts.map((p) => `${p.name}: ${partValue(p)}`),
                    ]
                  : []),
                ...(r.request.body !== null ? ['', r.request.body] : []),
              ].join('\n')}
            </pre>
          ) : (
            <>
              {Object.entries(r.request.headers).map(([name, value]) => {
                const sub = r.request!.substitutions.find((s) => s.location === `headers.${name}`)
                return (
                  <div key={name} className="kv-row">
                    <span className="kv-origin">header</span>
                    <span className="kv-key">{name}</span>
                    <ClipValue className="mono" text={value} />
                    {sub && (
                      <span className="sub-badge">
                        ← {sub.var}
                        {sub.fromStep && ` · ${sub.fromStep}`}
                      </span>
                    )}
                  </div>
                )
              })}
              {(r.request.parts ?? []).map((p, i) => {
                const sub = r.request!.substitutions.find((s) => s.location === `multipart.${p.name}`)
                return (
                  <div key={`${p.name}-${i}`} className="kv-row">
                    <span className="kv-origin">{p.value === undefined ? 'file' : 'part'}</span>
                    <span className="kv-key">{p.name}</span>
                    <ClipValue className="mono" text={partValue(p)} />
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
        <section className="det-response" style={cols({ 'key-col': colWidth(['set-cookie  '], 40, 12) })}>
          <header>
            <span className="detail-head-line">
              <span className={`mono ${statusOk ? 'ok' : 'bad'}`}>{r.response.status}</span>
              <span className="mono">{r.response.contentType?.split(';')[0] ?? '—'}</span>
              <span className="mono">{r.response.sizeBytes} B</span>
              {r.response.bodyTruncated && <span className="muted">{t('truncated')}</span>}
            </span>
            {bigBody && (
              <button
                className="icon-btn"
                title={treeOpen ? t('collapseAll') : t('expandAll')}
                onClick={() => setTreeOpen(!treeOpen)}
              >
                {treeOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
              </button>
            )}
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
              <ClipValue className="mono" text={r.response.headers['set-cookie']} />
              {r.captures?.find((c) => c.from === 'cookie') && (
                <span className="sub-badge">{r.captures.find((c) => c.from === 'cookie')!.name}</span>
              )}
            </div>
          ) : null}
          {r.response.body === '' ? null : effRespMode === 'tree' ? (
            <JsonTree text={r.response.body} expandAll={treeOpen} />
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
        <section
          className="det-captures"
          style={cols({
            'key-col': colWidth(
              r.captures!.map((c) => c.name + '  '),
              32,
              12,
            ),
            'detail-col': colWidth(
              r.captures!.map((c) => c.detail + '  '),
              32,
              12,
            ),
          })}
        >
          <header>{t('variables')}</header>
          {r.captures!.map((c) => {
            const usedBy = state.varUsage[c.name]?.usedBy ?? []
            return (
              <div key={c.name} className="capture-row">
                <span className="kv-origin">{c.from}</span>
                <span className="kv-key accent">{c.name}</span>
                <CopyValue value={c.value} />
                <ClipValue className="muted capture-detail" text={c.detail} />
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
        <section className="det-error">
          <header className="bad">{t('error')}</header>
          <div className="kv-row mono">{r.error.message}</div>
        </section>
      )}
    </div>
  )
}
