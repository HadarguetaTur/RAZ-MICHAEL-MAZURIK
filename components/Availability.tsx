
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { WeeklySlot, SlotInventory, Teacher, Student } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import { bookLessonFromSlot } from '../services/slotBookingService';
import LessonOverlapWarningModal from './ui/LessonOverlapWarningModal';
import { buildConflictSummary, type ConflictItem } from '../services/conflictsCheckService';
import { logConflictOverride } from '../services/eventLog';

const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Resolve slot type to display label (supports both Hebrew from Airtable and English). */
function slotTypeLabel(t: string | undefined): string {
  if (!t) return 'זוגי';
  const v = String(t).trim();
  if (v === 'private' || v === 'פרטי') return 'שיעור פרטי';
  if (v === 'group' || v === 'קבוצתי') return 'קבוצתי';
  return 'זוגי';
}

/** Format date as YYYY-MM-DD in local time (avoid UTC shift that hides Sunday/Friday). */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const Availability: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'weekly' | 'exceptions'>('weekly');
  const [weeklySlots, setWeeklySlots] = useState<WeeklySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<WeeklySlot | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [formData, setFormData] = useState({
    dayOfWeek: 0,
    startTime: '16:00',
    endTime: '17:00',
    type: 'private' as 'private' | 'group' | 'pair',
    teacherId: '',
    isFixed: false,
    reservedFor: undefined as string | undefined,
  });
  const [isSaving, setIsSaving] = useState(false);

  // חריגים וחד-פעמי: slot_inventory for one week
  const [inventorySlots, setInventorySlots] = useState<SlotInventory[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryWeekStart, setInventoryWeekStart] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const inventoryWeekDates = useMemo(() => {
    const start = new Date(inventoryWeekStart);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [inventoryWeekStart]);

  useEffect(() => {
    loadData();
    loadTeachersAndStudents();
  }, []);

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const start = toLocalDateStr(inventoryWeekDates[0]);
      const end = toLocalDateStr(inventoryWeekDates[6]);
      const raw = await nexusApi.getSlotInventory(start, end);
      const list: SlotInventory[] = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && (Array.isArray((raw as any).slots) || Array.isArray((raw as any).data) || Array.isArray((raw as any).records)))
          ? ((raw as any).slots ?? (raw as any).data ?? (raw as any).records)
          : [];
      setInventorySlots(list);
    } catch (err) {
      console.error('[Availability] Error loading slot_inventory:', err);
      alert(parseApiError(err));
      setInventorySlots([]);
    } finally {
      setInventoryLoading(false);
    }
  }, [inventoryWeekDates]);

  useEffect(() => {
    if (activeTab === 'exceptions') {
      loadInventory();
    }
  }, [activeTab, loadInventory]);

  const loadData = async () => {
    setLoading(true);
    try {
      const raw = await nexusApi.getWeeklySlots();
      // Normalize: API may return array or { slots/data/records }; ensure we always set an array
      const slots: WeeklySlot[] = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && (Array.isArray((raw as any).slots) || Array.isArray((raw as any).data) || Array.isArray((raw as any).records)))
          ? ((raw as any).slots ?? (raw as any).data ?? (raw as any).records)
          : [];
      setWeeklySlots(slots);
    } catch (err) {
      console.error('[Availability] Error loading slots:', err);
      alert(parseApiError(err));
      setWeeklySlots([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTeachersAndStudents = async () => {
    try {
      const [teachersData, studentsData] = await Promise.all([
        nexusApi.getTeachers(),
        nexusApi.getStudents()
      ]);
      setTeachers(teachersData);
      setStudents(studentsData);
    } catch (err) {
      console.error('Error loading teachers/students:', err);
    }
  };

  const handleToggleStatus = async (id: string) => {
    try {
      const slot = weeklySlots.find(s => s.id === id);
      if (!slot) return;
      
      const updated = await nexusApi.updateWeeklySlot(id, {
        status: slot.status === 'active' ? 'paused' : 'active'
      });
      
      setWeeklySlots(prev => prev.map(s => s.id === id ? updated : s));
    } catch (err) {
      alert(parseApiError(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('האם להסיר את חלון הזמינות הזה?')) return;
    
    try {
      await nexusApi.deleteWeeklySlot(id);
      setWeeklySlots(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      alert(parseApiError(err));
    }
  };

  const handleOpenModal = (slot: WeeklySlot | null, dayIdx?: number) => {
    if (slot) {
      setSelectedSlot(slot);
      setFormData({
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        type: slot.type,
        teacherId: slot.teacherId,
        isFixed: slot.isFixed || false,
        reservedFor: slot.reservedFor,
      });
    } else {
      setSelectedSlot(null);
      setFormData({
        dayOfWeek: dayIdx !== undefined ? dayIdx : 0,
        startTime: '16:00',
        endTime: '17:00',
        type: 'private',
        teacherId: teachers.length > 0 ? teachers[0].id : '',
        isFixed: false,
        reservedFor: undefined,
      });
    }
    setIsModalOpen(true);
  };

  const handleDeleteInventory = async (id: string) => {
    if (!confirm('האם להסיר את חלון החד-פעמי?')) return;
    try {
      await nexusApi.deleteSlotInventory(id);
      setInventorySlots(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      alert(parseApiError(err));
    }
  };

  const [editingInventorySlot, setEditingInventorySlot] = useState<SlotInventory | null>(null);
  const [inventoryEditForm, setInventoryEditForm] = useState({ date: '', startTime: '', endTime: '' });
  const [isSavingInventory, setIsSavingInventory] = useState(false);
  const [showSlotEditOverlapModal, setShowSlotEditOverlapModal] = useState(false);
  const [slotEditOverlapConflicts, setSlotEditOverlapConflicts] = useState<ConflictItem[]>([]);
  const [isCheckingSlotConflictsApi, setIsCheckingSlotConflictsApi] = useState(false);

  const handleOpenInventoryEdit = (slot: SlotInventory | null) => {
    if (slot) {
      setEditingInventorySlot(slot);
      setInventoryEditForm({
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
      });
    } else {
      setEditingInventorySlot(null);
      setInventoryEditForm({ date: '', startTime: '', endTime: '' });
    }
  };

  const handleCloseInventoryEdit = useCallback(() => {
    setEditingInventorySlot(null);
    setInventoryEditForm({ date: '', startTime: '', endTime: '' });
    setShowSlotEditOverlapModal(false);
    setSlotEditOverlapConflicts([]);
  }, []);

  const handleSlotEditOverlapContinue = useCallback(async () => {
    if (!editingInventorySlot || !editingInventorySlot.teacherId || !inventoryEditForm.date || !inventoryEditForm.startTime || !inventoryEditForm.endTime) return;
    const conflictSummary = buildConflictSummary(slotEditOverlapConflicts);
    logConflictOverride({
      recordId: editingInventorySlot.id,
      entity: 'slot_inventory',
      teacherId: editingInventorySlot.teacherId,
      date: inventoryEditForm.date,
      conflictSummary: conflictSummary || undefined,
    });
    setIsSavingInventory(true);
    try {
      const { slot: updatedSlot } = await bookLessonFromSlot(editingInventorySlot.id, {
        slotId: editingInventorySlot.id,
        date: inventoryEditForm.date,
        startTime: inventoryEditForm.startTime,
        endTime: inventoryEditForm.endTime,
      });
      setInventorySlots(prev => prev.map(s => s.id === editingInventorySlot.id ? updatedSlot : s));
      setShowSlotEditOverlapModal(false);
      setSlotEditOverlapConflicts([]);
      setEditingInventorySlot(null);
      setInventoryEditForm({ date: '', startTime: '', endTime: '' });
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setIsSavingInventory(false);
    }
  }, [editingInventorySlot, inventoryEditForm, slotEditOverlapConflicts]);

  const handleSaveInventoryEdit = async () => {
    if (!editingInventorySlot || !editingInventorySlot.teacherId || !inventoryEditForm.date || !inventoryEditForm.startTime || !inventoryEditForm.endTime) return;
    setIsCheckingSlotConflictsApi(true);
    let checkResult: { hasConflicts: boolean; conflicts: ConflictItem[] };
    try {
      checkResult = await nexusApi.checkConflicts({
        entity: 'slot_inventory',
        recordId: editingInventorySlot.id,
        teacherId: editingInventorySlot.teacherId ?? '',
        date: inventoryEditForm.date,
        start: inventoryEditForm.startTime,
        end: inventoryEditForm.endTime,
      });
    } catch (err) {
      setIsCheckingSlotConflictsApi(false);
      alert(parseApiError(err));
      return;
    }
    setIsCheckingSlotConflictsApi(false);
    if (checkResult.hasConflicts && checkResult.conflicts.length > 0) {
      setSlotEditOverlapConflicts(checkResult.conflicts);
      setShowSlotEditOverlapModal(true);
      return;
    }
    setIsSavingInventory(true);
    try {
      const { slot: updatedSlot } = await bookLessonFromSlot(editingInventorySlot.id, {
        slotId: editingInventorySlot.id,
        date: inventoryEditForm.date,
        startTime: inventoryEditForm.startTime,
        endTime: inventoryEditForm.endTime,
      });
      setInventorySlots(prev => prev.map(s => s.id === editingInventorySlot.id ? updatedSlot : s));
      setEditingInventorySlot(null);
      setInventoryEditForm({ date: '', startTime: '', endTime: '' });
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setIsSavingInventory(false);
    }
  };

  const handleSave = async () => {
    if (!formData.teacherId) {
      alert('אנא בחר מורה');
      return;
    }

    setIsSaving(true);
    try {
      if (selectedSlot) {
        // עדכון
        const updated = await nexusApi.updateWeeklySlot(selectedSlot.id, formData);
        setWeeklySlots(prev => prev.map(s => s.id === selectedSlot.id ? updated : s));
      } else {
        // יצירה
        const newSlot = await nexusApi.createWeeklySlot(formData);
        setWeeklySlots(prev => [...prev, newSlot]);
      }
      setIsModalOpen(false);
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

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
              {slotTypeLabel(slot.type)}
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
           <button 
            onClick={() => handleToggleStatus(slot.id)}
            className={`text-[10px] font-black underline ${isActive ? 'text-rose-500' : 'text-emerald-600'}`}
           >
             {isActive ? 'הקפא' : 'הפעל'}
           </button>
           <div className="flex gap-2">
             <button onClick={() => handleOpenModal(slot)} className="text-[10px] font-black text-blue-600 underline">ערוך</button>
             <button onClick={() => handleDelete(slot.id)} className="text-[10px] font-black text-slate-400 hover:text-rose-600">מחק</button>
           </div>
        </div>
      </div>
    );
  };

  /** כרטיס סלוט חד-פעמי (slot_inventory) — אותו מבנה ויזואלי כמו זמינות שבועי */
  /** רקע ייחודי לחד-פעמי — ענבר/כתום כדי להבדיל מקבוע (כחול) ומלבן */
  const renderInventorySlotCard = (slot: SlotInventory) => {
    const statusLabel = slot.status === 'open' ? 'פתוח' : slot.status === 'booked' ? 'תפוס' : 'חסום';
    const statusClass = slot.status === 'open'
      ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
      : slot.status === 'booked'
        ? 'bg-blue-50 text-blue-600 border-blue-100'
        : 'bg-slate-100 text-slate-500 border-slate-200';
    return (
      <div
        key={slot.id}
        className="group relative p-4 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/95 transition-all duration-200 hover:border-amber-400 hover:bg-amber-100"
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-slate-700">
              {slot.startTime} – {slot.endTime}
            </span>
            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${statusClass}`}>{statusLabel}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">חד-פעמי</span>
            {slot.teacherName && (
              <span className="text-[10px] font-medium text-slate-500">{slot.teacherName}</span>
            )}
            <span className="text-[10px] text-slate-400">{slot.date}</span>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex gap-2">
            <button onClick={() => handleOpenInventoryEdit(slot)} className="text-[10px] font-black text-blue-600 underline">ערוך</button>
            <button onClick={() => handleDeleteInventory(slot.id)} className="text-[10px] font-black text-slate-400 hover:text-rose-600">מחק</button>
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
                <span className="text-[10px] font-bold opacity-50">{(Array.isArray(weeklySlots) ? weeklySlots : []).filter(s => Number(s.dayOfWeek) === dayIdx).length} חלונות</span>
              </div>
              
              <div className="space-y-3">
                {(Array.isArray(weeklySlots) ? weeklySlots : [])
                  .filter(s => Number(s.dayOfWeek) === dayIdx)
                  .sort((a,b) => a.startTime.localeCompare(b.startTime))
                  .map(renderSlotCard)}
                
                <button 
                  onClick={() => handleOpenModal(null, dayIdx)}
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
        <>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
              <button
                type="button"
                onClick={() => {
                  const d = new Date(inventoryWeekStart);
                  d.setDate(d.getDate() - 7);
                  setInventoryWeekStart(d);
                }}
                className="px-3 py-2 hover:bg-white rounded-xl text-slate-500 font-bold text-sm"
              >
                ← שבוע קודם
              </button>
              <span className="px-4 py-2 text-slate-700 font-black text-sm min-w-[140px] text-center">
                {inventoryWeekDates[0].toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })} – {inventoryWeekDates[6].toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <button
                type="button"
                onClick={() => {
                  const d = new Date(inventoryWeekStart);
                  d.setDate(d.getDate() + 7);
                  setInventoryWeekStart(d);
                }}
                className="px-3 py-2 hover:bg-white rounded-xl text-slate-500 font-bold text-sm"
              >
                שבוע הבא →
              </button>
            </div>
            <button
              type="button"
              onClick={() => setInventoryWeekStart(() => {
                const d = new Date();
                d.setDate(d.getDate() - d.getDay());
                d.setHours(0, 0, 0, 0);
                return d;
              })}
              className="text-[10px] font-black text-slate-500 hover:text-blue-600 underline"
            >
              קפוץ להיום
            </button>
          </div>
          {inventoryLoading ? (
            <div className="py-20 text-center text-slate-300 font-bold">טוען חלונות חד-פעמיים...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
              {inventoryWeekDates.map((date, dayIdx) => {
                const dateStr = toLocalDateStr(date);
                const daySlots = (Array.isArray(inventorySlots) ? inventorySlots : [])
                  .filter(s => (s.date || '').split('T')[0] === dateStr)
                  .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
                return (
                  <div key={dayIdx} className="flex flex-col gap-4">
                    <div className="bg-slate-900 text-white py-3 px-4 rounded-2xl flex items-center justify-between shadow-sm">
                      <span className="text-sm font-black">{DAYS_HEBREW[date.getDay()]}</span>
                      <span className="text-[10px] font-bold opacity-50">{daySlots.length} חלונות</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium mb-1">
                      {date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                    </div>
                    <div className="space-y-3">
                      {daySlots.map(renderInventorySlotCard)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Editor Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}></div>
          <div className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-black text-slate-900">{selectedSlot ? 'עריכת חלון זמינות' : 'חלון זמינות חדש'}</h3>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase">יום בשבוע</label>
              <select 
                value={formData.dayOfWeek} 
                onChange={(e) => setFormData({...formData, dayOfWeek: parseInt(e.target.value)})}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold"
                disabled={!!selectedSlot}
              >
                {DAYS_HEBREW.map((day, idx) => (
                  <option key={idx} value={idx}>{day}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase">מורה *</label>
              <select 
                value={formData.teacherId} 
                onChange={(e) => setFormData({...formData, teacherId: e.target.value})}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold"
                required
              >
                <option value="">בחר מורה</option>
                {teachers.map(teacher => (
                  <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                ))}
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">שעת התחלה</label>
                <input 
                  type="time" 
                  value={formData.startTime}
                  onChange={(e) => setFormData({...formData, startTime: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">שעת סיום</label>
                <input 
                  type="time" 
                  value={formData.endTime}
                  onChange={(e) => setFormData({...formData, endTime: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold" 
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase">סוג ברירת מחדל</label>
              <select 
                value={formData.type}
                onChange={(e) => setFormData({...formData, type: e.target.value as 'private' | 'group' | 'pair'})}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold"
              >
                <option value="private">פרטני</option>
                <option value="pair">זוגי</option>
                <option value="group">קבוצתי</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={formData.isFixed}
                  onChange={(e) => setFormData({...formData, isFixed: e.target.checked, reservedFor: e.target.checked ? formData.reservedFor : undefined})}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span className="text-sm font-bold text-slate-700">סלוט קבוע (יוצר שיעור אוטומטית)</span>
              </label>
            </div>

            {formData.isFixed && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">תלמיד (חובה לסלוט קבוע)</label>
                <select 
                  value={formData.reservedFor || ''} 
                  onChange={(e) => setFormData({...formData, reservedFor: e.target.value || undefined})}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold"
                >
                  <option value="">בחר תלמיד</option>
                  {students.map(student => (
                    <option key={student.id} value={student.id}>{student.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="pt-4 flex gap-3">
              <button 
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed" 
                onClick={handleSave}
                disabled={isSaving || !formData.teacherId}
              >
                {isSaving ? 'שומר...' : 'שמור'}
              </button>
              <button 
                className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold" 
                onClick={() => setIsModalOpen(false)}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal עריכת חלון חד-פעמי (slot_inventory) */}
      {editingInventorySlot && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleCloseInventoryEdit} />
          <div className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900">עריכת חלון חד-פעמי</h3>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase">תאריך</label>
              <input
                type="date"
                value={inventoryEditForm.date}
                onChange={e => setInventoryEditForm(f => ({ ...f, date: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">שעת התחלה</label>
                <input
                  type="time"
                  value={inventoryEditForm.startTime}
                  onChange={e => setInventoryEditForm(f => ({ ...f, startTime: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">שעת סיום</label>
                <input
                  type="time"
                  value={inventoryEditForm.endTime}
                  onChange={e => setInventoryEditForm(f => ({ ...f, endTime: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold"
                />
              </div>
            </div>
            <div className="pt-4 flex gap-3">
              <button
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSaveInventoryEdit}
                disabled={isCheckingSlotConflictsApi || isSavingInventory || !inventoryEditForm.date || !inventoryEditForm.startTime || !inventoryEditForm.endTime || !editingInventorySlot?.teacherId}
              >
                {isCheckingSlotConflictsApi ? 'בודק...' : isSavingInventory ? 'שומר...' : 'שמור'}
              </button>
              <button
                className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold"
                onClick={handleCloseInventoryEdit}
                disabled={isSavingInventory || isCheckingSlotConflictsApi}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      <LessonOverlapWarningModal
        isOpen={showSlotEditOverlapModal}
        conflicts={slotEditOverlapConflicts}
        onContinue={handleSlotEditOverlapContinue}
        onBack={() => {
          setShowSlotEditOverlapModal(false);
          setSlotEditOverlapConflicts([]);
        }}
        isLoading={isSavingInventory}
      />

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
