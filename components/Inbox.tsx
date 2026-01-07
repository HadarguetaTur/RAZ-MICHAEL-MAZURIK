
import React, { useState, useEffect, useMemo } from 'react';
import { Lesson, LessonStatus, SystemError } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';

type QueueType = 'cancellations' | 'attendance' | 'billing' | 'errors';

const Inbox: React.FC = () => {
  const [activeQueue, setActiveQueue] = useState<QueueType>('cancellations');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [systemErrors, setSystemErrors] = useState<SystemError[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<Lesson | SystemError | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [lessonsData, errorsData] = await Promise.all([
        nexusApi.getLessons(new Date().toISOString(), new Date().toISOString()),
        nexusApi.getSystemErrors()
      ]);
      setLessons(lessonsData);
      setSystemErrors(errorsData);
    } catch (err) {
      console.error(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const queues = useMemo(() => ({
    cancellations: lessons.filter(l => l.status === LessonStatus.PENDING_CANCEL),
    attendance: lessons.filter(l => l.status === LessonStatus.COMPLETED && l.attendanceConfirmed === false),
    billing: lessons.filter(l => l.paymentStatus === 'unpaid' || !l.isChargeable && !l.chargeReason),
    errors: systemErrors
  }), [lessons, systemErrors]);

  const handleAction = async (id: string, updates: Partial<Lesson>) => {
    setProcessingId(id);
    try {
      const updated = await nexusApi.updateLesson(id, updates);
      setLessons(prev => prev.map(l => l.id === id ? updated : l));
      setSelectedItem(null);
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setProcessingId(null);
    }
  };

  const renderQueueContent = () => {
    const items = queues[activeQueue];

    if (loading) {
      return <div className="py-20 text-center text-slate-300 font-bold">טוען...</div>;
    }

    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-slate-200 border-dashed">
          <span className="text-4xl md:text-6xl mb-4">🎉</span>
          <h3 className="text-lg md:text-xl font-black text-slate-800 text-center px-4">אין משימות ממתינות כרגע!</h3>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {items.map((item: any) => (
          <div 
            key={item.id} 
            className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm active:bg-slate-50 transition-all cursor-pointer"
            onClick={() => setSelectedItem(item)}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="text-right">
                <div className="font-black text-slate-800 md:text-lg">{item.studentName || item.message}</div>
                <div className="text-[10px] font-bold text-slate-400 mt-0.5">{item.date || new Date(item.timestamp).toLocaleDateString('he-IL')} • {item.subject || item.code}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                 <span className="text-[9px] font-black uppercase text-blue-500 tracking-widest">{activeQueue === 'cancellations' ? 'בקשת ביטול' : activeQueue === 'attendance' ? 'וידוא נוכחות' : activeQueue === 'errors' ? 'שגיאת מערכת' : 'חיוב'}</span>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2 justify-end pt-3 border-t border-slate-50" onClick={e => e.stopPropagation()}>
               {activeQueue === 'cancellations' && (
                 <>
                   <button 
                     disabled={processingId === item.id}
                     onClick={() => handleAction(item.id, { status: LessonStatus.CANCELLED })}
                     className="flex-1 max-w-[120px] py-2.5 bg-emerald-50 text-emerald-600 text-[11px] font-black rounded-xl border border-emerald-100 shadow-sm"
                   >
                     {processingId === item.id ? 'מעבד...' : 'אשר ביטול'}
                   </button>
                   <button 
                     disabled={processingId === item.id}
                     onClick={() => handleAction(item.id, { status: LessonStatus.SCHEDULED })}
                     className="flex-1 max-w-[120px] py-2.5 bg-rose-50 text-rose-600 text-[11px] font-black rounded-xl border border-rose-100 shadow-sm"
                   >סרב</button>
                 </>
               )}
               {activeQueue === 'attendance' && (
                 <>
                   <button 
                     disabled={processingId === item.id}
                     onClick={() => handleAction(item.id, { attendanceConfirmed: true })}
                     className="flex-1 max-w-[120px] py-2.5 bg-blue-600 text-white text-[11px] font-black rounded-xl shadow-lg shadow-blue-100"
                   >
                     {processingId === item.id ? 'מעבד...' : 'נוכח ✅'}
                   </button>
                   <button 
                     disabled={processingId === item.id}
                     onClick={() => handleAction(item.id, { status: LessonStatus.NOSHOW, attendanceConfirmed: true })}
                     className="flex-1 max-w-[120px] py-2.5 bg-slate-900 text-white text-[11px] font-black rounded-xl shadow-lg"
                   >הברזה 🛑</button>
                 </>
               )}
               <button className="p-2.5 bg-slate-50 text-slate-400 rounded-xl hover:bg-slate-100 transition-all">👁️</button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full gap-6 md:gap-8 animate-in fade-in duration-500 pb-10">
      <div className="flex-1 flex flex-col min-h-0 space-y-6">
        {/* Fixed Segmented Control for Mobile */}
        <div className="shrink-0">
          <div className="grid grid-cols-4 p-1.5 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {(['cancellations', 'attendance', 'billing', 'errors'] as const).map(q => (
              <button
                key={q}
                onClick={() => setActiveQueue(q)}
                className={`min-h-[44px] px-1 md:px-6 py-3 rounded-xl transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${
                  activeQueue === q ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                <span className="text-[10px] md:text-sm font-black whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                  {q === 'cancellations' ? 'ביטולים' : q === 'attendance' ? 'נוכחות' : q === 'billing' ? 'חיובים' : 'שגיאות'}
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${activeQueue === q ? 'bg-white/20' : 'bg-slate-100'}`}>
                  {queues[q].length}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {renderQueueContent()}
        </div>
      </div>

      {/* Item Details Bottom Sheet / Side Panel */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelectedItem(null)}></div>
          <div className="relative w-full lg:w-[480px] bg-white lg:h-full h-[90vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom lg:slide-in-from-left duration-500 flex flex-col overflow-hidden">
            <div className="p-8 border-b border-slate-100 shrink-0">
               <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden"></div>
               <div className="flex items-center justify-between">
                 <h3 className="text-xl md:text-2xl font-black text-slate-800">פרטי משימה</h3>
                 <button onClick={() => setSelectedItem(null)} className="p-2.5 bg-slate-50 text-slate-400 rounded-xl">✕</button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar bg-[#fcfdfe]">
              <div className="p-6 bg-white border border-slate-100 rounded-[32px] shadow-sm">
                <div className="text-[10px] text-slate-400 font-black uppercase mb-1">נושא</div>
                <div className="text-xl font-black text-slate-800">{(selectedItem as any).studentName || (selectedItem as any).message}</div>
                <div className="text-xs font-bold text-slate-400 mt-2">ID: {selectedItem.id}</div>
              </div>

              <div className="p-6 bg-blue-50/30 rounded-[32px] border border-blue-50">
                <div className="text-[10px] text-blue-400 font-black uppercase mb-3">מידע נוסף</div>
                <p className="text-sm font-bold text-slate-600 leading-relaxed italic">
                  {(selectedItem as any).notes || (selectedItem as any).details || 'אין הערות נוספות למשימה זו.'}
                </p>
              </div>
            </div>

            <div className="p-8 border-t border-slate-100 bg-white flex gap-3 shrink-0 pb-10 md:pb-8">
               <button className="flex-1 py-5 bg-slate-900 text-white rounded-[24px] font-black shadow-lg">טפל עכשיו</button>
               <button onClick={() => setSelectedItem(null)} className="px-8 py-5 bg-white border border-slate-200 text-slate-400 rounded-[24px] font-bold">סגור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inbox;
