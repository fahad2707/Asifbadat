'use client';

import { useEffect, useState, type InputHTMLAttributes } from 'react';

export type NumberInputValue = number | string | '' | null | undefined;

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: NumberInputValue;
  onValueChange: (next: number | '') => void;
  /** Keep a visible 0. Default: show a blank field instead of 0. */
  showZero?: boolean;
};

const DRAFT_RE = /^-?\d*\.?\d*$/;

function isBlank(value: NumberInputValue, showZero: boolean): boolean {
  if (value === '' || value == null) return true;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return true;
  return !showZero && n === 0;
}

export default function NumberInput({
  value,
  onValueChange,
  showZero = false,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const blank = isBlank(value, showZero);
  const numeric = typeof value === 'number' ? value : value === '' || value == null ? null : Number(value);
  const idleDisplay = blank ? '' : String(numeric);

  useEffect(() => {
    if (!focused) setDraft(idleDisplay);
  }, [idleDisplay, focused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...rest}
      value={focused ? draft : idleDisplay}
      onFocus={(e) => {
        setFocused(true);
        setDraft(idleDisplay);
        onFocus?.(e);
        window.requestAnimationFrame(() => e.currentTarget.select());
      }}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (!DRAFT_RE.test(raw)) return;
        setDraft(raw);
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
          onValueChange('');
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onValueChange(n);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
    />
  );
}
