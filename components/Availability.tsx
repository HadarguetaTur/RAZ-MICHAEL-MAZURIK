
import React, { useState, useEffect } from 'react';
import { WeeklySlot, Teacher } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';

const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const Availability: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'weekly' | 'exceptions'>('weekly');
  const [weeklySlots, setWeeklySlots] = useState<WeeklySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<WeeklySlot | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const slots = await nexusApi.getWeeklySlots();
      setWeeklySlots(slots);
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = (id: string) => {
    setWeeklySlots(prev => prev.map(slot => 
      slot.id === id ? { ...slot, status: slot.status === 'active' ? 'paused' : 'active' } : slot
    ));
  };

  const handleDelete = (id: string) => {
    if (confirm('האם להסיר את חלון הזמינות הזה?')) {
      setWeeklySlots(prev => prev.filter(s => s.id !== id));
    }
  };

  const renderSlotCard = (slot: WeeklySlot) => {
    const isActive = slot.status === 'active';
    return (
      <div 
        key={slot.id} 
        className={`group relative p-4 rounded-2xl border transition-all duration-200 ${
          isActive 
          ? 'bg-white border-slate-200 shadow-sm hover:border-blue-300' 
          : 'bg-slate-50 border-slate-100 opacity-70'
        }`}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className={`text-sm font-black ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>
              {slot.startTime} – {slot.endTime}
            </span>
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
          </div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
            {slot.type === 'private' ? 'שיעור פרטי' : slot.type === 'group' ? 'קבוצתי' : 'זוגי'}
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-3 opacity-0 group-hover:opacity-100 transition-opacity">
           <button 
            onClick={() => handleToggleStatus(slot.id)}
            className={`text-[10px] font-black underline ${isActive ? 'text-rose-500' : 'text-emerald-600'}`}
           >
             {isActive ? 'הקפא' : 'הפעל'}
           </button>
           <div className="flex gap-2">
             <button onClick={() => { setSelectedSlot(slot); setIsModalOpen(true); }} className="text-[10px] font-black text-blue-600 underline">ערוך</button>
             <button onClick={() => handleDelete(slot.id)} className="text-[10px] font-black text-slate-400 hover:text-rose-600">מחק</button>
           </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Simplified Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-6">
        <div className="space-y-1">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">ניהול זמינות</h2>
          <p className="text-slate-500 font-medium">הגדרת שעות פעילות קבועות במרכז הלמידה</p>
        </div>

        <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm w-fit self-start">
          <button 
            onClick={() => setActiveTab('weekly')}
            className={`px-8 py-2.5 rounded-xl text-sm font-black transition-all ${activeTab === 'weekly' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            זמינות שבועי
          </button>
          <button 
            onClick={() => setActiveTab('exceptions')}
            className={`px-8 py-2.5 rounded-xl text-sm font-black transition-all ${activeTab === 'exceptions' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            חריגים וחד-פעמי
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-300 font-bold">טוען הגדרות...</div>
      ) : activeTab === 'weekly' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
          {DAYS_HEBREW.map((dayName, dayIdx) => (
            <div key={dayIdx} className="flex flex-col gap-4">
              <div className="bg-slate-900 text-white py-3 px-4 rounded-2xl flex items-center justify-between shadow-sm">
                <span className="text-sm font-black">{dayName}</span>
                <span className="text-[10px] font-bold opacity-50">{weeklySlots.filter(s => s.dayOfWeek === dayIdx).length} חלונות</span>
              </div>
              
              <div className="space-y-3">
                {weeklySlots
                  .filter(s => s.dayOfWeek === dayIdx)
                  .sort((a,b) => a.startTime.localeCompare(b.startTime))
                  .map(renderSlotCard)}
                
                <button 
                  onClick={() => { setSelectedSlot(null); setIsModalOpen(true); }}
                  className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-1 group hover:border-blue-300 hover:bg-blue-50/30 transition-all"
                >
                  <span className="text-lg text-slate-300 group-hover:text-blue-500 group-hover:scale-110 transition-transform">+</span>
                  <span className="text-[10px] font-black text-slate-400 group-hover:text-blue-600">הוסף חלון</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white p-20 rounded-[40px] border-2 border-dashed border-slate-100 flex flex-col items-center justify-center text-center gap-4">
           <span className="text-5xl">📅</span>
           <h3 className="text-xl font-black text-slate-800">ניהול חריגים ושינויים חד פעמיים</h3>
           <p className="text-slate-400 max-w-sm font-medium">כאן תוכל להגדיר ימי חופשה, מחלה או שינויים בשעות הפעילות עבור תאריכים ספציפיים.</p>
           <button className="mt-4 px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-sm opacity-50 cursor-not-allowed">בקרוב</button>
        </div>
      )}

      {/* Basic Editor Modal Placeholder */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}></div>
          <div className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900">{selectedSlot ? 'עריכת חלון זמינות' : 'חלון זמינות חדש'}</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">שעת התחלה</label>
                <input type="time" className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold" defaultValue={selectedSlot?.startTime || '16:00'} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">שעת סיום</label>
                <input type="time" className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold" defaultValue={selectedSlot?.endTime || '17:00'} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase">סוג ברירת מחדל</label>
              <select className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold">
                <option value="private">פרטני</option>
                <option value="pair">זוגי</option>
                <option value="group">קבוצתי</option>
              </select>
            </div>

            <div className="pt-4 flex gap-3">
              <button className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg shadow-blue-100" onClick={() => setIsModalOpen(false)}>שמור</button>
              <button className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold" onClick={() => setIsModalOpen(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* Guidance Note */}
      <div className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-start gap-4">
         <span className="text-xl shrink-0">💡</span>
         <div className="text-sm text-blue-800 leading-relaxed font-bold">
           שימו לב: הגדרות הזמינות השבועית משמשות כבסיס לשיבוץ שיעורים ביומן. שינוי כאן לא ימחק שיעורים שכבר קיימים, אך ימנע שיבוצים עתידיים בשעות אלו.
         </div>
      </div>
    </div>
  );
};

export default Availability;
