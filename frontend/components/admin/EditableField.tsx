'use client';

import { useEffect, useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';

export function displayValue(value?: string | number | null): string {
  if (value === undefined || value === null || String(value).trim() === '') return '—';
  return String(value);
}

const fieldInputClass = 'w-full bg-white border border-[#C7C7C7] rounded-md px-2 py-1 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#0077C5]';

export function EditableField({
  label,
  value,
  display,
  type = 'text',
  options,
  multiline,
  heading,
  onSave,
}: {
  label: string;
  value: string;
  display?: string;
  type?: 'text' | 'email' | 'tel' | 'number';
  options?: { value: string; label: string }[];
  multiline?: boolean;
  heading?: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const penButton = !editing ? (
    <button
      type="button"
      aria-label={`Edit ${label || 'field'}`}
      onClick={() => setEditing(true)}
      className="p-0.5 rounded text-[#8D9096] hover:text-[#1A1A1A] hover:bg-[#F4F5F8] shrink-0"
    >
      <Pencil className="w-3.5 h-3.5" />
    </button>
  ) : null;

  const editor = (
    <div className="mt-1 flex items-start gap-1">
      {options ? (
        <select value={draft} onChange={(e) => setDraft(e.target.value)} className={fieldInputClass}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className={fieldInputClass}
          autoFocus
        />
      ) : (
        <input
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
            if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
          }}
          className={fieldInputClass}
          autoFocus
        />
      )}
      <button type="button" onClick={() => void save()} disabled={saving} className="p-1 text-[#0B6B0B] hover:bg-[#E5F6E3] rounded" aria-label="Save">
        <Check className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(false);
        }}
        className="p-1 text-[#6B6C72] hover:bg-[#F4F5F8] rounded"
        aria-label="Cancel"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  if (heading) {
    return (
      <div>
        {editing ? editor : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-[#0F172A] tracking-tight">{display ?? displayValue(value)}</h1>
            {penButton}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        {label ? <span className="text-slate-500 text-[11px]">{label}</span> : null}
        {penButton}
      </div>
      {editing ? editor : (
        <span className="font-semibold text-[#1A1A1A] block">{display ?? displayValue(value)}</span>
      )}
    </div>
  );
}

export function EditableAddress({
  label = 'Address',
  address,
  city,
  state,
  zip,
  display,
  onSave,
}: {
  label?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  display: string;
  onSave: (next: { address: string; city: string; state: string; zip: string }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ address, city, state, zip });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft({ address, city, state, zip });
  }, [address, city, state, zip, editing]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pt-2">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500 text-[11px]">{label}</span>
        {!editing && (
          <button
            type="button"
            aria-label={`Edit ${label.toLowerCase()}`}
            onClick={() => setEditing(true)}
            className="p-0.5 rounded text-[#8D9096] hover:text-[#1A1A1A] hover:bg-[#F4F5F8]"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-2">
          <input
            type="text"
            placeholder="Street address"
            value={draft.address}
            onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
            className={fieldInputClass}
            autoFocus
          />
          <div className="grid grid-cols-3 gap-2">
            <input type="text" placeholder="City" value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} className={fieldInputClass} />
            <input type="text" placeholder="State" value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))} className={fieldInputClass} />
            <input type="text" placeholder="ZIP" value={draft.zip} onChange={(e) => setDraft((d) => ({ ...d, zip: e.target.value }))} className={fieldInputClass} />
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void save()} disabled={saving} className="p-1 text-[#0B6B0B] hover:bg-[#E5F6E3] rounded" aria-label="Save">
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ address, city, state, zip });
                setEditing(false);
              }}
              className="p-1 text-[#6B6C72] hover:bg-[#F4F5F8] rounded"
              aria-label="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <span className="text-[#1A1A1A] font-semibold">{displayValue(display)}</span>
      )}
    </div>
  );
}
