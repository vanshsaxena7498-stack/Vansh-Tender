import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Clock,
  Cloud,
  CloudAlert,
  CloudCheck,
  FileSpreadsheet,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import type {
  FirmProfile,
  NotificationItem,
  SheetSyncStatus,
  TabKey,
  Tender,
  WhatsAppAlertLog,
  WhatsAppSettings,
} from '../types/crm';
import {
  buildTenderWhatsAppMessage,
  buildWhatsAppWebUrl,
  DEFAULT_WHATSAPP_SETTINGS,
} from '../utils/whatsappAlerts';

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
  onLogout: () => void;
  notifications: NotificationItem[];
  onNavigateFromNotification: (item: NotificationItem) => void;
  onOpenMobileMenu: () => void;
  cloudUser: CloudUserSummary | null;
  cloudSyncing: boolean;
  cloudError?: boolean;
  onConnectCloud: () => void;
  onOpenCloudSettings: () => void;
  sheetSyncStatus?: SheetSyncStatus;
  sheetSyncError?: string | null;
  onOpenSheetSettings?: () => void;
  tenders?: Tender[];
  whatsappSettings?: WhatsAppSettings;
  whatsappLogs?: WhatsAppAlertLog[];
}

const TAB_TITLES: Record<TabKey, string> = {
  dashboard: 'Monthly Executive Dashboard',
  bidsearch: 'Bid Search · GeM PDF Scanner',
  tenders: 'Daily Tender Operations',
  maf: 'MAF Status',
  emdbg: 'EMD & Bank Guarantee Tracker',
  settings: 'Admin Settings & Backups',
};

export function Header({
  activeTab,
  firmProfile,
  darkMode,
  onToggleDarkMode,
  onLogout,
  notifications,
  onNavigateFromNotification,
  onOpenMobileMenu,
  cloudUser,
  cloudSyncing,
  cloudError = false,
  onConnectCloud,
  onOpenCloudSettings,
  sheetSyncStatus = 'unconfigured',
  sheetSyncError = null,
  onOpenSheetSettings,
  tenders = [],
  whatsappSettings = DEFAULT_WHATSAPP_SETTINGS,
  whatsappLogs = [],
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
          aria-label={
            cloudError
              ? 'Cloud sync issue - open settings'
              : cloudUser
                ? 'Google Cloud backup connected'
                : 'Connect Google Cloud backup'
          }
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
            cloudError
              ? 'border-red-200 dark:border-red-800 bg-red-50/80 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100/70 dark:hover:bg-red-950/60'
              : cloudUser
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/50'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          {cloudSyncing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span className="hidden sm:inline">Syncing...</span>
            </>
          ) : cloudError ? (
            <>
              <CloudAlert className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              <span className="hidden sm:inline">Sync Issue</span>
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

        <button
          type="button"
          onClick={onOpenSheetSettings ?? onOpenCloudSettings}
          title={
            sheetSyncStatus === 'error'
              ? sheetSyncError || 'Google Sheet sync error - open settings'
              : sheetSyncStatus === 'synced'
                ? 'MIS Monthly Report Google Sheet synced'
                : sheetSyncStatus === 'idle'
                  ? 'Google Sheet webhook configured and ready'
                  : 'Configure Google Sheet MIS Monthly Report webhook'
          }
          aria-label={
            sheetSyncStatus === 'error'
              ? 'Google Sheet sync issue'
              : sheetSyncStatus === 'synced'
                ? 'Sheet Synced'
                : sheetSyncStatus === 'syncing'
                  ? 'Sheet Syncing'
                  : sheetSyncStatus === 'idle'
                    ? 'Google Sheet Ready'
                    : 'Configure Google Sheet Sync'
          }
          data-testid="sheet-sync-badge"
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
            sheetSyncStatus === 'error'
              ? 'border-red-200 dark:border-red-800 bg-red-50/80 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100/70 dark:hover:bg-red-950/60'
              : sheetSyncStatus === 'synced' || sheetSyncStatus === 'idle'
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/50'
                : sheetSyncStatus === 'syncing'
                  ? 'border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          {sheetSyncStatus === 'syncing' ? (
            <>
              <RefreshCw
                className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Sheet Syncing...</span>
            </>
          ) : sheetSyncStatus === 'error' ? (
            <>
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              <span className="hidden sm:inline">Sheet Error</span>
            </>
          ) : sheetSyncStatus === 'synced' ? (
            <>
              <FileSpreadsheet
                className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Sheet Synced</span>
            </>
          ) : sheetSyncStatus === 'idle' ? (
            <>
              <FileSpreadsheet
                className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Sheet Ready</span>
            </>
          ) : (
            <>
              <FileSpreadsheet
                className="h-4 w-4 text-slate-500 dark:text-slate-400"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Sheet Sync</span>
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
                  {notifications.map((item) => {
                    const linkedTender =
                      item.category === 'deadline_48h'
                        ? tenders.find((t) => t.id === item.targetId)
                        : undefined;
                    const tenderWaLogs = linkedTender
                      ? whatsappLogs.filter((l) => l.tenderRefId === linkedTender.id)
                      : [];
                    const has4h = tenderWaLogs.some((l) => l.milestone === 'urgent_4h');
                    const has48h = tenderWaLogs.some((l) => l.milestone === 'alert_48h');
                    const waUrl = linkedTender
                      ? buildWhatsAppWebUrl(
                          whatsappSettings.recipientPhone,
                          buildTenderWhatsAppMessage(
                            linkedTender,
                            has4h ? 'urgent_4h' : 'alert_48h',
                            whatsappSettings.recipientName,
                          ),
                        )
                      : null;

                    return (
                      <li key={item.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                        <button
                          type="button"
                          onClick={() => {
                            onNavigateFromNotification(item);
                            setNotifOpen(false);
                          }}
                          className="w-full text-left flex items-start justify-between gap-3"
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

                        {linkedTender && waUrl && (
                          <div className="mt-2 pl-6 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              {has4h
                                ? 'WhatsApp 2/2 (4h Urgent Triggered)'
                                : has48h
                                  ? 'WhatsApp 1/2 (48h Alert Triggered)'
                                  : 'WhatsApp Alert Ready'}
                            </span>
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                            >
                              <MessageCircle className="h-3 w-3" aria-hidden="true" />
                              <span>WhatsApp {whatsappSettings.recipientName}</span>
                            </a>
                          </div>
                        )}
                      </li>
                    );
                  })}
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
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Log Out</span>
        </button>
      </div>
    </header>
  );
}
