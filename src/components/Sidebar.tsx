import { useState } from 'react';
import {
  BarChart3,
  Building2,
  FileSpreadsheet,
  Gavel,
  Landmark,
  LogOut,
  ScanSearch,
  Settings,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import type { CrmUserSession, FirmProfile, TabKey } from '../types/crm';

interface SidebarProps {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
  firmProfile: FirmProfile;
  currentUser?: CrmUserSession | null;
  tenderCount: number;
  oemCount?: number;
  mafCount?: number;
  emdCount: number;
  bidRaCount?: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout?: () => void;
}

const NAV_ITEMS: { key: TabKey; label: string; icon: typeof BarChart3 }[] = [
  { key: 'dashboard', label: 'Executive Dashboard', icon: BarChart3 },
  { key: 'bidsearch', label: 'Bid Search', icon: ScanSearch },
  { key: 'tenders', label: 'Daily Tender Data', icon: FileSpreadsheet },
  { key: 'oems', label: 'OEM Details', icon: Building2 },
  { key: 'maf', label: 'MAF Status', icon: ShieldCheck },
  { key: 'emdbg', label: 'EMD & BG Tracker', icon: Landmark },
  { key: 'bidra', label: 'BID/RA Status', icon: Gavel },
  { key: 'settings', label: 'Admin Settings', icon: Settings },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  firmProfile,
  currentUser,
  tenderCount,
  oemCount = 0,
  mafCount = 0,
  emdCount,
  bidRaCount = 0,
  mobileOpen,
  onCloseMobile,
  onLogout,
}: SidebarProps) {
  const [imgError, setImgError] = useState(false);
  const hasPhoto = Boolean(firmProfile.adminPhotoUrl) && !imgError;

  const navContent = (
    <div className="flex h-full flex-col bg-[#0F172A] text-slate-100 border-r border-slate-800">
      <div className="flex items-center justify-between px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          {hasPhoto ? (
            <img
              src={firmProfile.adminPhotoUrl}
              alt="Admin user photo"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-700 bg-slate-800"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white">
              <User className="h-4 w-4" aria-hidden="true" />
            </div>
          )}
          <span className="font-display text-base font-bold tracking-tight text-white truncate">
            {firmProfile.adminName || currentUser?.username || 'Tender Desk'}
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav aria-label="Primary Navigation" className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          const countLabel =
            item.key === 'tenders'
              ? tenderCount
              : item.key === 'oems'
                ? oemCount
                : item.key === 'maf'
                  ? mafCount
                  : item.key === 'emdbg'
                    ? emdCount
                    : item.key === 'bidra'
                      ? bidRaCount
                      : null;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                onSelectTab(item.key);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap ${
                isActive
                  ? 'bg-[#1E3A8A] text-white'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {item.key === 'settings' && currentUser?.role === 'secondary'
                    ? 'Workspace Settings'
                    : item.label}
                </span>
              </span>
              {countLabel !== null && (
                <span
                  className={`font-mono-num text-xs ${
                    isActive ? 'text-blue-200' : 'text-slate-400'
                  }`}
                >
                  {countLabel}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800 text-xs text-slate-400 space-y-2.5">
        <div className="space-y-1">
          <p className="font-medium text-slate-200 truncate" title={firmProfile.firmName}>
            {firmProfile.firmName}
          </p>
          <p className="font-mono-num text-slate-400 truncate">
            GSTIN: {firmProfile.gstin || 'Not Set'}
          </p>
          <p className="text-slate-500 truncate">
            {currentUser?.role === 'secondary' ? 'Secondary User' : 'Primary Admin'}:{' '}
            {firmProfile.adminName || currentUser?.username || 'Tender Desk'}
          </p>
        </div>
        {onLogout && (
          <button
            type="button"
            onClick={() => {
              onCloseMobile();
              onLogout();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 text-slate-200 text-xs font-medium transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Logout</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0">{navContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <button
            type="button"
            aria-label="Close menu backdrop"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-slate-950/60"
          />
          <aside className="relative z-50 w-64 max-w-[80vw] h-full">{navContent}</aside>
        </div>
      )}
    </>
  );
}
