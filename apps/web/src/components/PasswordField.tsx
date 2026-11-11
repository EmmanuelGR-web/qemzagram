'use client';

import { getPasswordIssues, PASSWORD_ISSUE_MESSAGES, passwordStrength, type PasswordIssue } from '@qemzagram/shared';
import { useId, useState } from 'react';

const LABELS = ['', 'Débil', 'Regular', 'Buena', 'Excelente'];
const ALL_RULES: PasswordIssue[] = ['length', 'lower', 'upper', 'digit', 'symbol'];

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'new-password' | 'current-password';
  showRules?: boolean;
  context?: { tag?: string; email?: string };
}

export function PasswordField({ label, value, onChange, autoComplete, showRules = false, context }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const issues = getPasswordIssues(value, context);
  const strength = passwordStrength(value);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input id={id} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} required maxLength={128} />
        <button type="button" className="input-action" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
          {visible ? 'Ocultar' : 'Ver'}
        </button>
      </div>
      {showRules && (
        <>
          <div className="strength" data-level={strength} aria-live="polite">
            <span /> <span /> <span /> <span />
            <em>{LABELS[strength]}</em>
          </div>
          <ul className="rules">
            {ALL_RULES.map((rule) => (
              <li key={rule} data-ok={!issues.includes(rule)}>
                {PASSWORD_ISSUE_MESSAGES[rule]}
              </li>
            ))}
            {value.length > 0 && issues.includes('common') && <li data-ok={false}>{PASSWORD_ISSUE_MESSAGES.common}</li>}
            {value.length > 0 && issues.includes('personal') && <li data-ok={false}>{PASSWORD_ISSUE_MESSAGES.personal}</li>}
            {value.length > 0 && issues.includes('repeat') && <li data-ok={false}>{PASSWORD_ISSUE_MESSAGES.repeat}</li>}
          </ul>
        </>
      )}
    </div>
  );
}
