/**
 * Admin Inbox — actionable task list. Data from server /api/inbox (Airtable admin_inbox).
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useInbox } from '../data/hooks/useInbox';
import { getLessons } from '../data/resources/lessons';
import { reportInboxEvent } from '../data/resources/inbox';
import type { AdminInboxItem } from '../data/resources/inbox';
import { LessonStatus } from '../types';

const TAB_CATEGORIES: { id: string; label: string }[] = [
  { id: 'ביטולים', label: 'ביטולים' },
  { id: 'חיובים', label: 'חיובים' },
  { id: 'נוכחות', label: 'נוכחות' },
  { id: 'שגיאות', label: 'שגיאות' },
  { id: 'שיבוצים/וויטליסט', label: 'וויטליסט' },
  { id: 'כללי', label: 'כללי' },
];

const SNOOZE_PRESETS: { label: string; hours?: number; days?: number; hour?: number }[] = [
  { label: '1 שפה', hours: 1 },
  { label: 'עד מחר 09:00', days: 1, hour: 9 },
  { label: '3 ימים', days: 3 },
  { label: 'שבוע', days: 7 },
];

function getSnoozeUntil(p: { hours?: number; days?: number; hour?: number }): string {
  const d = new Date();
  if (p.hours != null) d.setHours(d.getHours() + p.hours);
  else if (p.days != null) {
    d.setDate(d.getDate() + p.days);
    if (p.hour != null) d.setHours(p.hour, 0, 0, 0);
  }
  return d.toISOString();
}

const Inbox: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<string>('ביטולים');
  const [includeSnoozed, setIncludeSnoozed] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<AdminInboxItem | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const {
    items,
    countsByCategory,
    isLoading,
    error,
    refresh,
    close,
    snooze,
    update,
  } = useInbox({
    status: 'openOnly',
    includeSnoozed,
    search: search.trim() || undefined,
    pageSize: 200,
  });

  // Event ingestion: sync PENDING_CANCEL lessons to inbox when Inbox mounts (late_cancel hook).
  const lateCancelSynced = useRef(false);
  useEffect(() => {
    if (lateCancelSynced.current) return;
    lateCancelSynced.current = true;
    const today = new Date().toISOString().split('T')[0];
    getLessons({ start: today, end: today })
      .then(async (lessons) => {
        const pending = lessons.filter((l) => l.status === LessonStatus.PENDING_CANCEL);
        const now = Date.now();
        for (const l of pending) {
          const lessonStart = new Date(`${l.date}T${l.startTime}:00`).getTime();
          const hoursUntil = Math.max(0, Math.round((lessonStart - now) / 3600000));
          await reportInboxEvent({
            event: 'late_cancel',
            lessonId: l.id,
            studentId: l.studentId,
            lessonDateTime: `${l.date}T${l.startTime}`,
            hoursUntil,
            studentName: l.studentName,
          }).catch(() => {});
        }
        if (pending.length > 0) refresh();
      })
      .catch(() => {});
  }, [refresh]);

  const filteredItems = useMemo(() => {
    if (!activeCategory) return items;
    return items.filter((i) => (i.category || 'כללי') === activeCategory);
  }, [items, activeCategory]);

  const handleClose = async (item: AdminInboxItem) => {
    setProcessingId(item.id);
    try {
      await close(item.id);
      setSelectedItem(null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleSnooze = async (item: AdminInboxItem, until: string) => {
    setProcessingId(item.id);
    try {
      await snooze(item.id, until);
      setSelectedItem(null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleStatusInProgress = async (item: AdminInboxItem) => {
    setProcessingId(item.id);
    try {
      await update(item.id, { status: 'בטיפול' });
      setSelectedItem((prev) => (prev?.id === item.id ? { ...prev, status: 'בטיפול' } : prev));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setProcessingId(null);
    }
  };

  if (error) {
    const isServerDown =
      /ECONNREFUSED|Failed to fetch|NetworkError|load failed|Inbox API 500|500/i.test(error.message);
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 max-w-md mx-auto">
        <span className="text-4xl mb-4">⚠️</span>
        <h3 className="text-lg font-black text-slate-800 text-center mb-2">אין חיבור לשרת תיבת הודעות</h3>
        <p className="text-sm text-slate-500 text-center mb-2">{error.message}</p>
        {isServerDown && (
          <p className="text-xs text-slate-400 text-center mb-4 font-mono bg-slate-100 px-3 py-2 rounded-lg">
            הרץ בטרמינל: <code>npm run api:server</code>
            <br />
            או את האפליקציה והשרת יחד: <code>npm run dev:full</code>
          </p>
        )}
        <button
          onClick={() => refresh()}
          className="py-3 px-6 bg-blue-600 text-white rounded-xl font-bold shadow-lg"
        >
          נסה שוב
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-6 md:gap-8 animate-in fade-in duration-500 pb-10">
      <div className="flex-1 flex flex-col min-h-0 space-y-6">
        {/* Tabs with badge counts */}
        <div className="shrink-0">
          <div className="flex flex-wrap gap-1.5 p-1.5 bg-white rounded-2xl border border-slate-200 shadow-sm">
            {TAB_CATEGORIES.map((tab) => {
              const count = countsByCategory[tab.id] ?? 0;
              const active = activeCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveCategory(tab.id)}
                  className={`min-h-[44px] px-3 md:px-4 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
                    active ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[10px] md:text-sm font-black whitespace-nowrap">
                    {tab.label}
                  </span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                      active ? 'bg-white/20' : 'bg-slate-100'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search + include snoozed */}
        <div className="shrink-0 flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="חיפוש..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[140px] py-2.5 px-4 rounded-xl border border-slate-200 bg-white font-bold text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSnoozed}
              onChange={(e) => setIncludeSnoozed(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-sm font-bold text-slate-600">הצג מושתקים</span>
          </label>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="py-20 text-center text-slate-300 font-bold">טוען...</div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-slate-200 border-dashed">
              <span className="text-4xl md:text-6xl mb-4">🎉</span>
              <h3 className="text-lg md:text-xl font-black text-slate-800 text-center px-4">
                אין משימות ממתינות כרגע!
              </h3>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm active:bg-slate-50 transition-all cursor-pointer"
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-right flex-1 min-w-0">
                      <div className="font-black text-slate-800 md:text-lg truncate">
                        {item.title || item.inbox_key}
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                        {item.category || 'כללי'} • {item.priority || '—'}
                      </div>
                    </div>
                    <span className="text-[9px] font-black uppercase text-blue-500 tracking-widest shrink-0">
                      {item.type || '—'}
                    </span>
                  </div>
                  {item.details && (
                    <p className="text-xs text-slate-500 line-clamp-2 mt-1">{item.details}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drawer: item details + actions */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setSelectedItem(null)}
          />
          <div className="relative w-full lg:w-[480px] bg-white lg:h-full h-[90vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl flex flex-col overflow-hidden">
            <div className="p-8 border-b border-slate-100 shrink-0">
              <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden" />
              <div className="flex items-center justify-between">
                <h3 className="text-xl md:text-2xl font-black text-slate-800">פרטי משימה</h3>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-2.5 bg-slate-50 text-slate-400 rounded-xl hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-[#fcfdfe]">
              <div className="p-6 bg-white border border-slate-100 rounded-[32px] shadow-sm">
                <div className="text-[10px] text-slate-400 font-black uppercase mb-1">נושא</div>
                <div className="text-xl font-black text-slate-800">{selectedItem.title || selectedItem.inbox_key}</div>
                <div className="text-xs font-bold text-slate-400 mt-2">
                  {selectedItem.category} • {selectedItem.type}
                </div>
              </div>

              {selectedItem.details && (
                <div className="p-6 bg-blue-50/30 rounded-[32px] border border-blue-50">
                  <div className="text-[10px] text-blue-400 font-black uppercase mb-3">מידע נוסף</div>
                  <p className="text-sm font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {selectedItem.details}
                  </p>
                </div>
              )}

              {/* Snooze presets */}
              <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                <div className="text-[10px] text-slate-400 font-black uppercase mb-3">השהה לזמן</div>
                <div className="flex flex-wrap gap-2">
                  {SNOOZE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      disabled={processingId === selectedItem.id}
                      onClick={() =>
                        handleSnooze(
                          selectedItem,
                          getSnoozeUntil(
                            preset.hours != null
                              ? { hours: preset.hours }
                              : { days: preset.days ?? 1, hour: preset.hour }
                          )
                        )
                      }
                      className="py-2 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-8 border-t border-slate-100 bg-white flex flex-wrap gap-3 shrink-0 pb-10 md:pb-8">
              <button
                disabled={processingId === selectedItem.id}
                onClick={() => handleStatusInProgress(selectedItem)}
                className="flex-1 min-w-[120px] py-5 bg-blue-600 text-white rounded-[24px] font-black shadow-lg disabled:opacity-60"
              >
                {processingId === selectedItem.id ? 'מעבד...' : 'בטיפול'}
              </button>
              <button
                disabled={processingId === selectedItem.id}
                onClick={() => handleClose(selectedItem)}
                className="flex-1 min-w-[120px] py-5 bg-emerald-600 text-white rounded-[24px] font-black shadow-lg disabled:opacity-60"
              >
                סגור
              </button>
              <button
                onClick={() => setSelectedItem(null)}
                className="px-8 py-5 bg-white border border-slate-200 text-slate-400 rounded-[24px] font-bold"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inbox;
