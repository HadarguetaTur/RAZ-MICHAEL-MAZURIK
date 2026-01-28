import React, { useState, useEffect } from 'react';
import { SystemError } from '../types';
import { parseApiError } from '../services/nexusApi';
import { getSystemErrors } from '../data/resources/system';
import { getConflictOverrideEvents, EVENT_CODE_CONFLICT_OVERRIDE, type ConflictOverrideEvent } from '../services/eventLog';
import { reportInboxEvent } from '../data/resources/inbox';

const parseDetails = (details?: string) => {
  if (!details) return {};
  try {
    return JSON.parse(details);
  } catch {
    return { raw: details };
  }
};

const ErrorCenter: React.FC = () => {
  const [errors, setErrors] = useState<SystemError[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedError, setSelectedError] = useState<SystemError | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [conflictOverrideEvents, setConflictOverrideEvents] = useState<ConflictOverrideEvent[]>([]);
  const [sendingToInbox, setSendingToInbox] = useState<string | null>(null);

  const sendErrorToInbox = async (err: SystemError) => {
    setSendingToInbox(err.id);
    try {
      await reportInboxEvent({
        event: 'system_error',
        signature: err.signature || err.id,
        message: err.message,
        source: err.code,
        code: err.code,
      });
      alert('נשלח לתיבת הודעות.');
    } catch (e) {
      alert(parseApiError(e));
    } finally {
      setSendingToInbox(null);
    }
  };

  useEffect(() => {
    loadErrors();
  }, []);

  const loadErrors = async () => {
    setLoading(true);
    try {
      const data = await getSystemErrors();
      // Supplementing with mock data for demonstration if empty
      if (data.length === 0) {
         setErrors([
           { id: 'err-1', timestamp: new Date().toISOString(), message: 'כשל בשליחת ווטסאפ לתלמיד', code: 'WHATSAPP_API_FAIL', signature: 'wa_401_auth', details: '{"studentId": "1", "phone": "0501234567", "template": "lesson_reminder"}' },
           { id: 'err-2', timestamp: new Date(Date.now() - 3600000).toISOString(), message: 'שגיאת סנכרון Airtable', code: 'AIRTABLE_RATE_LIMIT', signature: 'at_429_limit', details: '{"base": "Lessons", "table": "Inventory", "operation": "patch"}' },
           { id: 'err-3', timestamp: new Date(Date.now() - 7200000).toISOString(), message: 'חיוב חודשי נכשל', code: 'STRIPE_CARD_DECLINED', signature: 'st_declined_insufficient', details: '{"studentId": "2", "amount": 450, "last4": "4242"}' }
         ]);
      } else {
         setErrors(data);
      }
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setLoading(false);
    }
    setConflictOverrideEvents(getConflictOverrideEvents());
  };

  useEffect(() => {
    setConflictOverrideEvents(getConflictOverrideEvents());
  }, []);

  const filteredErrors = errors.filter(e => 
    e.message.includes(searchTerm) || e.code.includes(searchTerm) || e.signature.includes(searchTerm)
  );

  const getSeverity = (code: string) => {
    if (code.includes('RATE_LIMIT') || code.includes('FAIL')) return 'high';
    if (code.includes('DECLINED')) return 'medium';
    return 'low';
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('הפרטים הועתקו ללוח');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Search & Stats */}
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="חפש לפי הודעה, קוד שגיאה או חתימה..."
            className="w-full pr-12 pl-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-4 focus:ring-blue-50 transition-all shadow-sm bg-white font-bold"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 text-xl">🔍</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-rose-50 border border-rose-100 px-5 py-2 rounded-2xl">
            <span className="text-rose-600 font-black text-sm">{errors.length} שגיאות ממתינות</span>
          </div>
          <button onClick={loadErrors} className="p-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">🔄</button>
        </div>
      </div>

      {/* CONFLICT_OVERRIDE event log */}
      {conflictOverrideEvents.length > 0 && (
        <div className="p-6 bg-amber-50/50 rounded-2xl border border-amber-100 space-y-3">
          <h3 className="text-sm font-black text-amber-800 uppercase tracking-wider">
            אירועי המשך למרות חפיפה ({EVENT_CODE_CONFLICT_OVERRIDE})
          </h3>
          <ul className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
            {conflictOverrideEvents.map((ev, i) => (
              <li key={`${ev.timestamp}-${i}`} className="text-xs font-mono bg-white/80 rounded-xl px-3 py-2 border border-amber-100">
                <span className="font-black text-amber-700">{ev.date}</span>
                {' · '}
                <span>{ev.entity}</span>
                {ev.recordId && <><span> · </span><span className="text-slate-600">{ev.recordId.slice(0, 12)}…</span></>}
                {' · '}
                <span className="text-slate-500">מורה {ev.teacherId.slice(0, 8)}…</span>
                {ev.conflictSummary && (
                  <div className="mt-1 text-[10px] text-slate-500 truncate" title={ev.conflictSummary}>{ev.conflictSummary}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Error List */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
             <div className="py-20 text-center text-slate-400 font-bold">טוען יומן שגיאות...</div>
          ) : filteredErrors.length > 0 ? (
            filteredErrors.map(error => (
              <div 
                key={error.id} 
                onClick={() => setSelectedError(error)}
                className={`p-6 bg-white rounded-3xl border transition-all cursor-pointer group ${
                  selectedError?.id === error.id ? 'border-blue-500 ring-4 ring-blue-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl ${
                      getSeverity(error.code) === 'high' ? 'bg-rose-50 text-rose-500' : 
                      getSeverity(error.code) === 'medium' ? 'bg-amber-50 text-amber-500' : 'bg-slate-50 text-slate-400'
                    }`}>
                      {getSeverity(error.code) === 'high' ? '🚨' : '⚠️'}
                    </div>
                    <div>
                      <h3 className="font-black text-slate-800 mb-1">{error.message}</h3>
                      <div className="flex items-center gap-2">
                         <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{error.code}</span>
                         <span className="text-slate-200">•</span>
                         <span className="text-[10px] font-bold text-slate-400">{new Date(error.timestamp).toLocaleString('he-IL')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-blue-500 text-xs font-black">בדוק שגיאה ←</span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-100">
               <span className="text-5xl mb-4 block">🛡️</span>
               <h3 className="text-xl font-black text-slate-800">המערכת יציבה</h3>
               <p className="text-slate-400 text-sm mt-2">לא נמצאו שגיאות העונות לקריטריוני החיפוש.</p>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-1">
          {selectedError ? (
            <div className="bg-slate-900 rounded-[40px] p-10 text-white shadow-2xl animate-in slide-in-from-left duration-300 sticky top-10">
              <div className="flex items-center justify-between mb-10">
                <h3 className="text-2xl font-black italic tracking-tighter">ניתוח שגיאה</h3>
                <button onClick={() => setSelectedError(null)} className="text-white/20 hover:text-white">✕</button>
              </div>

              <div className="space-y-8">
                <div>
                  <div className="text-[10px] font-black uppercase text-white/40 tracking-widest mb-2">תיאור</div>
                  <p className="text-lg font-bold leading-relaxed">{selectedError.message}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div className="text-[10px] font-black uppercase text-white/40 mb-1">קוד</div>
                    <div className="text-xs font-mono font-bold truncate">{selectedError.code}</div>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div className="text-[10px] font-black uppercase text-white/40 mb-1">חתימה</div>
                    <div className="text-xs font-mono font-bold truncate">{selectedError.signature}</div>
                  </div>
                </div>

                <div className="space-y-4">
                   <div className="text-[10px] font-black uppercase text-white/40 tracking-widest">מידע גולמי (Payload)</div>
                   <div className="relative group">
                     <pre className="w-full bg-black/40 rounded-2xl p-6 text-[11px] font-mono text-emerald-400 overflow-x-auto custom-scrollbar leading-relaxed border border-white/5">
                        {JSON.stringify(parseDetails(selectedError.details), null, 2)}
                     </pre>
                     <button 
                      onClick={() => copyToClipboard(selectedError.details || '')}
                       className="absolute top-4 left-4 p-2 bg-white/10 rounded-lg hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-all text-xs"
                     >
                       📋 העתק
                     </button>
                   </div>
                </div>

                <div className="pt-6 border-t border-white/10 space-y-4">
                   <h4 className="text-sm font-black text-white/60">פעולות מומלצות:</h4>
                   <ul className="text-xs space-y-3 text-white/40">
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                        בדוק חיבור לאינטרנט ותקינות API
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                        ודא שפרטי התלמיד (טלפון/אימייל) תקינים
                      </li>
                   </ul>
                </div>

                <button
                  onClick={() => sendErrorToInbox(selectedError)}
                  disabled={!!sendingToInbox}
                  className="w-full py-4 bg-slate-700 text-white rounded-2xl font-black shadow-xl hover:bg-slate-600 active:scale-95 transition-all disabled:opacity-60"
                >
                  {sendingToInbox ? '… שולח' : '📥 שלח לתיבת הודעות'}
                </button>
                <button className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl hover:bg-blue-700 active:scale-95 transition-all">
                  🔄 נסה להפעיל מחדש (Retry)
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-[40px] border border-slate-200 border-dashed p-12 text-center flex flex-col items-center justify-center gap-4 text-slate-300 h-[600px]">
               <div className="text-6xl grayscale opacity-50">🛡️</div>
               <p className="font-bold">בחר שגיאה מהרשימה כדי לצפות בניתוח מלא ופתרונות מוצעים</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ErrorCenter;
