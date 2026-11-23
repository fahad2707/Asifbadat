'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, X } from 'lucide-react';
import adminApi from '@/lib/admin-api';
import { adminUi } from '@/lib/admin-ui';
import { playAdminNoticeChime } from '@/lib/adminNoticeSound';

export type DeskInbox = { rfq: number; website_signups: number; online_orders: number };

export type AdminNotice = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  created_at: string;
};

const SEEN_KEY = 'adminNoticeSeenAt';
const TOAST_MS = 25000;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function useDeskInbox(enabled = true): DeskInbox {
  const [inbox, setInbox] = useState<DeskInbox>({ rfq: 0, website_signups: 0, online_orders: 0 });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await adminApi.get<DeskInbox>('/desk/inbox');
        if (!cancelled) setInbox(data);
      } catch {
        /* keep last counts */
      }
    };
    void load();
    const t = window.setInterval(load, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [enabled]);
  return inbox;
}

export function AdminNoticeCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<AdminNotice[]>([]);
  const [toasts, setToasts] = useState<AdminNotice[]>([]);
  const [unread, setUnread] = useState(0);
  const seenAt = useRef<string>(typeof window !== 'undefined' ? localStorage.getItem(SEEN_KEY) || new Date().toISOString() : new Date().toISOString());
  const toastCursor = useRef<string>(new Date().toISOString());
  const knownIds = useRef<Set<string>>(new Set());

  const markSeen = () => {
    const now = new Date().toISOString();
    seenAt.current = now;
    localStorage.setItem(SEEN_KEY, now);
    setUnread(0);
  };

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await adminApi.get<{ notices: AdminNotice[] }>('/desk/notices');
      const list = data.notices || [];
      setNotices(list);
      const seen = new Date(seenAt.current).getTime();
      setUnread(list.filter((row) => new Date(row.created_at).getTime() > seen).length);
      const cursor = new Date(toastCursor.current).getTime();
      const fresh = list.filter((row) => {
        if (knownIds.current.has(row.id)) return false;
        return new Date(row.created_at).getTime() > cursor;
      });
      if (fresh.length) {
        fresh.forEach((row) => knownIds.current.add(row.id));
        playAdminNoticeChime();
        setToasts((prev) => [...fresh, ...prev].slice(0, 4));
      }
      list.forEach((row) => knownIds.current.add(row.id));
    } catch {
      /* polling continues */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((row) => window.setTimeout(() => dismissToast(row.id), TOAST_MS));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, dismissToast]);

  const openNotice = (notice: AdminNotice) => {
    dismissToast(notice.id);
    setOpen(false);
    markSeen();
    router.push(notice.href);
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            if (!open) markSeen();
          }}
          className={adminUi.btnIcon}
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 ? (
            <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#C81916] text-white text-[10px] font-semibold leading-4 text-center">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className={`absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] p-2 z-50 ${adminUi.overlay}`}>
              <p className={`${adminUi.navSection} px-2 py-1`}>Notifications</p>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {notices.length === 0 ? (
                  <p className={`${adminUi.helper} px-2 py-4`}>No notifications yet.</p>
                ) : (
                  notices.map((notice) => (
                    <button
                      key={notice.id}
                      type="button"
                      onClick={() => openNotice(notice)}
                      className="w-full text-left rounded-md px-2 py-2 hover:bg-[#F4F5F8]"
                    >
                      <p className="text-sm font-medium text-[#1A1A1A]">{notice.title}</p>
                      {notice.body ? <p className={adminUi.helper}>{notice.body}</p> : null}
                      <p className="text-[11px] text-[#8D9096] mt-0.5">{formatWhen(notice.created_at)}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="fixed top-4 right-4 z-[70] flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))] pointer-events-none">
        {toasts.map((notice) => (
          <div
            key={notice.id}
            className="pointer-events-auto rounded-2xl border border-[#E3E5E8] bg-white/95 shadow-lg backdrop-blur-sm px-4 py-3"
            role="status"
          >
            <div className="flex items-start gap-3">
              <button type="button" className="flex-1 text-left min-w-0" onClick={() => openNotice(notice)}>
                <p className="text-sm font-medium text-[#1A1A1A]">{notice.title}</p>
                {notice.body ? <p className="text-xs text-[#6B6C72] mt-0.5">{notice.body}</p> : null}
                <p className="text-[11px] text-[#8D9096] mt-1">{formatWhen(notice.created_at)}</p>
              </button>
              <button
                type="button"
                className="p-1 rounded-full text-[#8D9096] hover:text-[#1A1A1A] hover:bg-[#F4F5F8]"
                aria-label="Clear notification"
                onClick={() => dismissToast(notice.id)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function InboxBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-[#C81916] text-white text-[10px] font-semibold leading-[18px] text-center">
      {count > 9 ? '9+' : count}
    </span>
  );
}
