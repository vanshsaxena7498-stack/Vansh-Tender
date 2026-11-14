import { useState, type FormEvent } from 'react';
import { Delete, Lock, ShieldCheck } from 'lucide-react';
import type { FirmProfile } from '../types/crm';

interface LockScreenProps {
  expectedPin: string;
  firmProfile: FirmProfile;
  onUnlock: () => void;
}

export function LockScreen({ expectedPin, firmProfile, onUnlock }: LockScreenProps) {
  const [pinInput, setPinInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleDigit = (digit: string) => {
    if (pinInput.length >= 4) return;
    const next = pinInput + digit;
    setPinInput(next);
    setErrorMsg('');
    if (next.length === 4) {
      if (next === expectedPin) {
        onUnlock();
      } else {
        setErrorMsg('Incorrect 4-digit Admin PIN. Try again.');
        setTimeout(() => setPinInput(''), 250);
      }
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pinInput === expectedPin) {
      onUnlock();
    } else {
      setErrorMsg('Incorrect 4-digit Admin PIN.');
      setPinInput('');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="CRM Security Lock Screen"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1120] px-4"
    >
      <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 p-6 sm:p-8 text-slate-100">
        <div className="flex flex-col items-center text-center mb-6">
          {firmProfile.adminPhotoUrl ? (
            <img
              src={firmProfile.adminPhotoUrl}
              alt="Admin user photo"
              referrerPolicy="no-referrer"
              className="h-14 w-14 rounded-xl object-cover border border-slate-700 mb-4"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1E3A8A] text-white mb-4">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          <h2 className="font-display text-lg font-semibold text-white">
            Desk Locked
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {firmProfile.firmName}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Enter 4-digit Admin PIN to resume tender operations
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="lock-pin-input" className="sr-only">
              4-Digit Admin PIN
            </label>
            <input
              id="lock-pin-input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              value={pinInput}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                setPinInput(digits);
                setErrorMsg('');
                if (digits.length === 4 && digits === expectedPin) {
                  onUnlock();
                } else if (digits.length === 4) {
                  setErrorMsg('Incorrect 4-digit Admin PIN.');
                }
              }}
              placeholder="••••"
              className="font-mono-num w-full text-center text-2xl tracking-[0.75em] py-3 px-4 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {errorMsg && (
            <p role="alert" className="text-xs text-center text-red-400 font-medium">
              {errorMsg}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2.5">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleDigit(d)}
                className="font-mono-num py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-base font-medium transition-colors"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPinInput('');
                setErrorMsg('');
              }}
              className="py-3 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => handleDigit('0')}
              className="font-mono-num py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-base font-medium transition-colors"
            >
              0
            </button>
            <button
              type="button"
              aria-label="Backspace PIN digit"
              onClick={() => setPinInput((p) => p.slice(0, -1))}
              className="flex items-center justify-center py-3 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-300 transition-colors"
            >
              <Delete className="h-4 w-4" />
            </button>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Unlock CRM
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Default Admin PIN: 1234 (customizable in Admin Settings)</span>
        </div>
      </div>
    </div>
  );
}
