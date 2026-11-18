'use client';

import NumberInput from './NumberInput';
import {
  CIGARETTE_PACK_SIZES,
  STOCK_UNIT_LABELS,
  STOCK_UNITS,
  TOBACCO_CLASS_LABELS,
  TOBACCO_CLASSES,
  tobaccoComplianceFormStatus,
  type TobaccoComplianceFormValue,
} from '@/lib/tobacco-compliance';

export default function TobaccoComplianceProfileFields({
  value,
  onChange,
}: {
  value: TobaccoComplianceFormValue;
  onChange: (next: TobaccoComplianceFormValue) => void;
}) {
  const status = tobaccoComplianceFormStatus(value);
  const showCigaretteFields = value.tobacco_class === 'cigarette';

  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#0F172A]">Tobacco Compliance Profile</h3>
          <p className="text-xs text-[#64748B] mt-0.5">
            Classification and pack conversion for Pennsylvania cigarette reporting. This is not a full regulatory-clearance check.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-[11px] font-semibold px-2 py-1 rounded-md ${
              status.profileComplete ? 'bg-slate-100 text-slate-800' : 'bg-amber-50 text-amber-800'
            }`}
          >
            Profile {status.profileComplete ? 'classified' : 'incomplete'}
          </span>
          <span
            className={`text-[11px] font-semibold px-2 py-1 rounded-md ${
              status.cigaretteReportingReady
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {status.cigaretteReportingApplicable
              ? status.cigaretteReportingReady
                ? 'Cigarette reporting ready'
                : 'Cigarette reporting not ready'
              : 'Cigarette reporting N/A'}
          </span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Regulatory classification</label>
        <select
          value={value.tobacco_class}
          onChange={(e) => onChange({ ...value, tobacco_class: e.target.value as TobaccoComplianceFormValue['tobacco_class'] })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
        >
          {TOBACCO_CLASSES.map((cls) => (
            <option key={cls} value={cls}>
              {TOBACCO_CLASS_LABELS[cls]}
            </option>
          ))}
        </select>
      </div>

      {showCigaretteFields && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cigarette pack size</label>
            <select
              value={value.cigarette_pack_size}
              onChange={(e) =>
                onChange({
                  ...value,
                  cigarette_pack_size: e.target.value === '' ? '' : (Number(e.target.value) as 20 | 25),
                })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Not set</option>
              {CIGARETTE_PACK_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} sticks
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stock unit</label>
            <select
              value={value.stock_unit}
              onChange={(e) => {
                const stock_unit = e.target.value as TobaccoComplianceFormValue['stock_unit'];
                onChange({
                  ...value,
                  stock_unit,
                  packs_per_stock_unit: stock_unit === 'pack' ? 1 : value.packs_per_stock_unit,
                });
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Not set</option>
              {STOCK_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {STOCK_UNIT_LABELS[unit]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Packs per stock unit</label>
            <NumberInput
              min={1}
              value={value.stock_unit === 'pack' ? 1 : value.packs_per_stock_unit}
              onValueChange={(n) =>
                onChange({
                  ...value,
                  packs_per_stock_unit: n === '' ? '' : Math.trunc(n),
                })
              }
              disabled={value.stock_unit === 'pack'}
              placeholder={value.stock_unit === 'pack' ? '1' : 'Required if unit is set'}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500 disabled:bg-slate-100"
            />
            <p className="text-[11px] text-[#64748B] mt-1">
              Pack units are always 1. Carton, case, and other require an explicit integer. Leave blank only when the unit is not set.
            </p>
          </div>
        </div>
      )}

      {status.issues.length > 0 && (
        <ul className="text-xs text-amber-800 space-y-0.5 list-disc pl-4">
          {status.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {value.tobacco_class !== 'unknown' && value.tobacco_class !== 'cigarette' && (
        <p className="text-xs text-[#64748B]">
          Classification is recorded. This does not mean the product is fully compliant with all tobacco regulations.
        </p>
      )}
    </div>
  );
}
