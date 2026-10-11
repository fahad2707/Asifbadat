'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { customerAuthUi } from '@/lib/customer-auth-ui';

export default function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
  minLength,
  id: idProp,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  id?: string;
  error?: string;
}) {
  const genId = useId();
  const id = idProp || genId;
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className={customerAuthUi.label}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${customerAuthUi.field} pr-12 ${error ? customerAuthUi.fieldError : ''}`}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          minLength={minLength}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
        <button
          type="button"
          className={customerAuthUi.iconBtn}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={0}
        >
          {visible ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
        </button>
      </div>
      {error && (
        <p id={errorId} className={`${customerAuthUi.errorText} mt-1.5`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
