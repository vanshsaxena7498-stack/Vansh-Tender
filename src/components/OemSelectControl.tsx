import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ChevronDown, Search, X } from 'lucide-react';
import type { OemRecord } from '../types/crm';
import { filterOemRecords, findOemByName } from '../utils/oemDirectory';

interface OemSelectControlProps {
  id?: string;
  oemRecords: OemRecord[];
  value: string;
  required?: boolean;
  allowClear?: boolean;
  compact?: boolean;
  placeholder?: string;
  onSelectOem: (oem: OemRecord | null) => void;
  onGoToOemDetails?: () => void;
}

export function OemSelectControl({
  id,
  oemRecords,
  value,
  required = true,
  allowClear = false,
  compact = false,
  placeholder = '-- Select Registered OEM --',
  onSelectOem,
  onGoToOemDetails,
}: OemSelectControlProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const matchedOem = useMemo(() => findOemByName(oemRecords, value), [oemRecords, value]);
  const isUnlistedValue = Boolean(value.trim()) && !matchedOem;

  const filtered = useMemo(() => filterOemRecords(oemRecords, query), [oemRecords, query]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    } else {
      setQuery('');
    }
  }, [open]);

  const paddingClass = compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={id || 'oem-select-trigger'}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 ${paddingClass} ${
          isUnlistedValue
            ? 'border-amber-400 dark:border-amber-600 bg-amber-50/60 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100'
        }`}
      >
        <span className="truncate">
          {matchedOem ? (
            <span>
              <span className="font-medium">{matchedOem.oemName}</span>
              {matchedOem.companyName ? (
                <span className="text-slate-500 dark:text-slate-400">
                  {' '}
                  · {matchedOem.companyName}
                </span>
              ) : null}
            </span>
          ) : value.trim() ? (
            <span className="font-medium">{value.trim()} (Unlisted)</span>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">{placeholder}</span>
          )}
        </span>

        <span className="flex items-center gap-1 shrink-0">
          {allowClear && value.trim() && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear OEM selection"
              onClick={(e) => {
                e.stopPropagation();
                onSelectOem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectOem(null);
                }
              }}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        </span>
      </button>

      {/* Hidden input supports native form validation prompt when required and empty */}
      {required && (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={matchedOem ? matchedOem.oemName : ''}
          onChange={() => {}}
          className="sr-only"
        />
      )}

      {open && (
        <div
          role="listbox"
          aria-label="Registered OEM Options"
          className="absolute left-0 right-0 z-50 mt-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
            <div className="relative">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search registered OEMs..."
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-8 pr-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
            {oemRecords.length === 0 ? (
              <div className="p-3 text-center space-y-2">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  No OEMs registered in OEM Details yet.
                </p>
                {onGoToOemDetails && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onGoToOemDetails();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#1E3A8A] text-white text-[11px] font-medium"
                  >
                    <Building2 className="h-3 w-3" />
                    <span>Go to OEM Details</span>
                  </button>
                )}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500 dark:text-slate-400">
                No registered OEM matches &ldquo;{query}&rdquo;. Free-text OEM entry is disabled.
              </div>
            ) : (
              filtered.map((oem) => {
                const isSelected = matchedOem?.id === oem.id;
                return (
                  <button
                    key={oem.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelectOem(oem);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left transition-colors flex flex-col gap-0.5 ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-[#1E3A8A] dark:text-blue-300'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    <span className="text-xs font-semibold flex items-center justify-between gap-2">
                      <span className="truncate">{oem.oemName}</span>
                      {oem.companyName && (
                        <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 truncate">
                          {oem.companyName}
                        </span>
                      )}
                    </span>
                    {(oem.concernedPersonName || oem.email || oem.phone) && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {[oem.concernedPersonName, oem.phone, oem.email].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
