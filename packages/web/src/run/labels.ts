import type { CheckResult } from '@pulse/shared'
import { t } from '../i18n'
import type { StepView } from '../runState'

/** Short human label of a check, used in rows and in the failure banner. */
export function checkLabel(check: CheckResult): string {
  switch (check.kind) {
    case 'status':
      return 'status'
    case 'header':
      return `headers.${check.name}`
    case 'body-path':
      return check.path
    case 'body-text':
      return t('bodyText')
  }
}

/** A step has details to expand only after it actually ran. */
export const hasDetails = (step: StepView): boolean =>
  Boolean(step.result) && step.status !== 'skipped' && step.status !== 'pending'
