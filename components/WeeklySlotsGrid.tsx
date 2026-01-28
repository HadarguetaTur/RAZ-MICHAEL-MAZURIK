import React from 'react';
import { WeeklySlot } from '../types';

const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

type WeeklySlotsGridProps = {
  slots: WeeklySlot[];
  mode?: 'weekly' | 'inventory';
  students?: Array<{ id: string; name: string }>; // For reserved student lookup
  onSlotEdit?: (slot: WeeklySlot) => void;
  onSlotDelete?: (slotId: string) => void;
  onSlotToggleStatus?: (slotId: string) => void;
  onAddSlot?: (dayIdx: number) => void;
};

const WeeklySlotsGrid: React.FC<WeeklySlotsGridProps> = ({
  slots,
  mode = 'weekly',
  students = [],
  onSlotEdit,
  onSlotDelete,
  onSlotToggleStatus,
  onAddSlot,
}) => {
  const renderSlotCard = (slot: WeeklySlot) => {
    const isActive = slot.status === 'active';
    const isFixed = slot.isFixed || false;
    const reservedStudent = isFixed && slot.reservedFor 
      ? students.find(s => s.id === slot.reservedFor)
      : null;
    
    return (
      <div 
        key={slot.id} 
        className={`group relative p-4 rounded-2xl border transition-all duration-200 ${
          isActive 
          ? isFixed
            ? 'bg-blue-50 border-blue-200 shadow-sm hover:border-blue-400' 
            : 'bg-white border-slate-200 shadow-sm hover:border-blue-300'
          : 'bg-slate-50 border-slate-100 opacity-70'
        }`}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className={`text-sm font-black ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>
              {slot.startTime} – {slot.endTime}
            </span>
            <div className="flex items-center gap-1">
              {isFixed && (
                <span className="text-[8px] font-black text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">קבוע</span>
              )}
              <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
              {slot.type === 'private' ? 'שיעור פרטי' : slot.type === 'group' ? 'קבוצתי' : 'זוגי'}
            </span>
            {slot.teacherName && (
              <span className="text-[10px] font-medium text-slate-500">{slot.teacherName}</span>
            )}
            {reservedStudent && (
              <span className="text-[10px] font-medium text-blue-600">תלמיד: {reservedStudent.name}</span>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-3 opacity-0 group-hover:opacity-100 transition-opacity">
           {onSlotToggleStatus && (
             <button 
              onClick={() => onSlotToggleStatus(slot.id)}
              className={`text-[10px] font-black underline ${isActive ? 'text-rose-500' : 'text-emerald-600'}`}
             >
               {isActive ? 'הקפא' : 'הפעל'}
             </button>
           )}
           <div className="flex gap-2">
             {onSlotEdit && (
               <button onClick={() => onSlotEdit(slot)} className="text-[10px] font-black text-blue-600 underline">ערוך</button>
             )}
             {onSlotDelete && (
               <button onClick={() => onSlotDelete(slot.id)} className="text-[10px] font-black text-slate-400 hover:text-rose-600">מחק</button>
             )}
           </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
      {DAYS_HEBREW.map((dayName, dayIdx) => {
        const daySlots = slots
          .filter(s => s.dayOfWeek === dayIdx)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        
        return (
          <div key={dayIdx} className="flex flex-col gap-4">
            <div className="bg-slate-900 text-white py-3 px-4 rounded-2xl flex items-center justify-between shadow-sm">
              <span className="text-sm font-black">{dayName}</span>
              <span className="text-[10px] font-bold opacity-50">{daySlots.length} חלונות</span>
            </div>
            
            <div className="space-y-3">
              {daySlots.map(renderSlotCard)}
              
              {onAddSlot && (
                <button 
                  onClick={() => onAddSlot(dayIdx)}
                  className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-1 group hover:border-blue-300 hover:bg-blue-50/30 transition-all"
                >
                  <span className="text-lg text-slate-300 group-hover:text-blue-500 group-hover:scale-110 transition-transform">+</span>
                  <span className="text-[10px] font-black text-slate-400 group-hover:text-blue-600">הוסף חלון</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WeeklySlotsGrid;
