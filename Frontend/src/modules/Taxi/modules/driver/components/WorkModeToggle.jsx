import { useState } from 'react';
import { motion } from 'framer-motion';
import { Car, Package, Layers } from 'lucide-react';
import api from '../../../shared/api/axiosInstance';

const MODES = [
  { key: 'all', label: 'All', Icon: Layers },
  { key: 'taxi', label: 'Rides', Icon: Car },
  { key: 'delivery', label: 'Food', Icon: Package },
];

/**
 * Work-mode toggle: lets a driver choose which job streams they receive —
 * All / Rides only / Food deliveries only.
 *
 * Only rendered for drivers who actually hold both capabilities; a taxi-only or
 * delivery-only driver has nothing to choose, so the control stays hidden.
 */
export default function WorkModeToggle({
  workMode = 'all',
  serviceCapabilities = [],
  onChange,
  disabled = false,
}) {
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState(workMode);

  const caps = Array.isArray(serviceCapabilities) ? serviceCapabilities : [];
  // Nothing to pick unless the driver can do both.
  if (!(caps.includes('taxi') && caps.includes('delivery'))) return null;

  const select = async (next) => {
    if (next === mode || saving || disabled) return;
    const previous = mode;
    setMode(next); // optimistic
    setSaving(true);
    try {
      const res = await api.patch('/drivers/work-mode', { workMode: next });
      const applied = res?.data?.data?.workMode || next;
      setMode(applied);
      onChange?.(applied);
    } catch (err) {
      setMode(previous); // roll back on failure
      console.warn('[work-mode] update failed', err?.response?.data?.message || err?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`relative flex items-center gap-0.5 rounded-full bg-slate-100 p-1 shadow-inner ${
        saving || disabled ? 'opacity-60' : ''
      }`}
      role="group"
      aria-label="Job types you want to receive"
    >
      {MODES.map(({ key, label, Icon }) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            disabled={saving || disabled}
            onClick={() => select(key)}
            aria-pressed={active}
            className="relative flex items-center gap-1 rounded-full px-2.5 py-1"
          >
            {active && (
              <motion.div
                layoutId="workModePill"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="absolute inset-0 rounded-full bg-black shadow-sm"
              />
            )}
            <Icon
              size={11}
              strokeWidth={3}
              className={`relative z-10 ${active ? 'text-emerald-400' : 'text-slate-400'}`}
            />
            <span
              className={`relative z-10 text-[9px] font-black uppercase tracking-widest ${
                active ? 'text-white' : 'text-slate-400'
              }`}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
