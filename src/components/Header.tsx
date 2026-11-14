import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Clock,
  Cloud,
  CloudCheck,
  Lock,
  Menu,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import type { FirmProfile, NotificationItem, TabKey } from '../types/crm';

export interface CloudUserSummary {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface HeaderProps {
  activeTab: TabKey;
  firmProfile: FirmProfile;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLockScreen: () => void;
  notifications: NotificationItem[];
  onNavigateFromNotification: (item: NotificationItem) => void;
  onOpenMobileMenu: () => void;
  cloudUser: CloudUserSummary | null;
  cloudSyncing: boolean;
  onConnectCloud: () => void;
  onOpenCloudSettings: () => void;
}

const TAB_TITLES: Record<TabKey, string> = {
  dashboard: 'Monthly Executive Dashboard',
  tenders: 'Daily Tender Operations',
  emdbg: 'EMD & Bank Guarantee Tracker',
  settings: 'Admin Settings & Backups',
};

export function Header({
  activeTab,
  firmProfile,
  darkMode,
  onToggleDarkMode,
  onLockScreen,
  notifications,
  onNavigateFromNotification,
  onOpenMobileMenu,
  cloudUser,
  cloudSyncing,
  onConnectCloud,
  onOpenCloudSettings,
}: HeaderProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [notifOpen]);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 sm:px-6 h-16 bg-white dark:bg-[#0B1120] border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-white truncate">
            {TAB_TITLES[activeTab]}
          </h1>
          <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 truncate">
            {firmProfile.firmName} · {firmProfile.adminName}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          type="button"
          onClick={cloudUser ? onOpenCloudSettings : onConnectCloud}
          disabled={cloudSyncing}
          aria-label={cloudUser ? 'Google Cloud backup connected' : 'Connect Google Cloud backup'}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
            cloudUser
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/50'
              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          {cloudSyncing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span className="hidden sm:inline">Syncing...</span>
            </>
          ) : cloudUser ? (
            <>
              <CloudCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="hidden sm:inline">Cloud Synced</span>
            </>
          ) : (
            <>
              <Cloud className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
              <span className="hidden sm:inline">Cloud Backup</span>
            </>
          )}
        </button>

        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((prev) => !prev)}
            aria-label={`Notifications (${notifications.length} alerts)`}
            aria-expanded={notifOpen}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Alerts</span>
            {notifications.length > 0 && (
              <span className="font-mono-num inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-red-600 text-white text-[11px] font-semibold">
                {notifications.length}
              </span>
            )}
          </button>

          {notifOpen && (
            <div
              role="region"
              aria-label="Tender and Financial Alerts"
              className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Compliance & Deadline Alerts ({notifications.length})
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  48h Due · 30d BG · 60d EMD
                </span>
              </div>

              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No urgent deadlines, expiring BGs, or overdue EMD refunds.
                </div>
              ) : (
                <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {notifications.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onNavigateFromNotification(item);
                          setNotifOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors flex items-start justify-between gap-3"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          {item.category === 'deadline_48h' ? (
                            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {item.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {item.subtitle}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`font-mono-num text-[11px] font-medium whitespace-nowrap shrink-0 ${
                            item.category === 'deadline_48h'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {item.daysOrHoursLabel}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleDarkMode}
          aria-label={darkMode ? 'Switch to Day Mode' : 'Switch to Dark Mode'}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium whitespace-nowrap shrink-0"
        >
          {darkMode ? (
            <>
              <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <span className="hidden sm:inline">Day Mode</span>
            </>
          ) : (
            <>
              <Moon className="h-4 w-4 text-slate-700" aria-hidden="true" />
              <span className="hidden sm:inline">Dark Mode</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onLockScreen}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
        >
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Lock Screen</span>
        </button>
      </div>
    </header>
  );
}
