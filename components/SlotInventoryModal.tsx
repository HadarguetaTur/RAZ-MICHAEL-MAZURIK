import React, { useState, useEffect } from 'react';
import { SlotInventory, Student } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import { reserveSlotAndCreateLessons } from '../services/slotBookingService';
import StudentPicker from './StudentPicker';
import Toast from './Toast';

interface SlotInventoryModalProps {
  slot?: {
    id: string;
    startDateTime: string;
    endDateTime: string;
    teacherId: string;
    status: string;
  };
  slotId?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const SlotInventoryModal: React.FC<SlotInventoryModalProps> = ({ slot: slotProp, slotId, onClose, onSuccess }) => {
  const [isReserving, setIsReserving] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [slot, setSlot] = useState<SlotInventory | null>(null);
  const [isLoadingSlot, setIsLoadingSlot] = useState(false);

  // Fetch slot data if slotId is provided (and slotProp is not provided)
  useEffect(() => {
    // Reset state when slotId or slotProp changes
    if (!slotId && !slotProp) {
      setSlot(null);
      setIsLoadingSlot(false);
      return;
    }

    if (slotProp) {
      // Convert slotProp to SlotInventory format
      const startDate = new Date(slotProp.startDateTime);
      const endDate = new Date(slotProp.endDateTime);
      const dateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
      const startTime = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`;
      const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
      
      setSlot({
        id: slotProp.id,
        teacherId: slotProp.teacherId,
        teacherName: '', // Will be filled if needed
        date: dateStr,
        startTime,
        endTime,
        status: slotProp.status as 'open' | 'closed' | 'canceled',
      });
      setIsLoadingSlot(false);
    } else if (slotId) {
      // Fetch slot data from API
      setIsLoadingSlot(true);
      const fetchSlot = async () => {
        try {
          const dayStartISO = new Date().toISOString().split('T')[0];
          const dayEndISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 30 days ahead
          const slots = await nexusApi.getSlotInventory(dayStartISO, dayEndISO);
          const foundSlot = slots.find(s => s.id === slotId);
          if (foundSlot) {
            setSlot(foundSlot);
          } else {
            if (import.meta.env?.DEV) {
              console.warn('[SlotInventoryModal] Slot not found:', slotId);
            }
            setToast({ message: 'חלון לא נמצא', type: 'error' });
            setTimeout(() => onClose(), 2000);
          }
        } catch (err) {
          console.error('[SlotInventoryModal] Failed to fetch slot:', err);
          setToast({ message: 'שגיאה בטעינת החלון', type: 'error' });
          setTimeout(() => onClose(), 2000);
        } finally {
          setIsLoadingSlot(false);
        }
      };
      fetchSlot();
    }
  }, [slotId, slotProp, onClose]);

  // Use slot from state or prop
  const currentSlot = slot || (slotProp ? {
    id: slotProp.id,
    teacherId: slotProp.teacherId,
    teacherName: '',
    date: new Date(slotProp.startDateTime).toISOString().split('T')[0],
    startTime: `${new Date(slotProp.startDateTime).getHours().toString().padStart(2, '0')}:${new Date(slotProp.startDateTime).getMinutes().toString().padStart(2, '0')}`,
    endTime: `${new Date(slotProp.endDateTime).getHours().toString().padStart(2, '0')}:${new Date(slotProp.endDateTime).getMinutes().toString().padStart(2, '0')}`,
    status: slotProp.status as 'open' | 'closed' | 'canceled',
  } : null);

  if (!currentSlot) {
    if (isLoadingSlot) {
      return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 md:p-8">
            <div className="text-center text-slate-500">טוען...</div>
          </div>
        </div>
      );
    }
    return null;
  }

  const startDate = new Date(`${currentSlot.date}T${currentSlot.startTime}:00`);
  const endDate = new Date(`${currentSlot.date}T${currentSlot.endTime}:00`);
  const dateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
  const startTime = currentSlot.startTime;
  const endTime = currentSlot.endTime;

  const handleConfirmReservation = async () => {
    if (!selectedStudent || !currentSlot) return;
    setIsReserving(true);
    try {
      const result = await reserveSlotAndCreateLessons(currentSlot.id, [selectedStudent.id]);
      
      if (import.meta.env.DEV) {
        console.log(`[SlotInventoryModal] Reservation successful:`, {
          slotId: result.slot.id,
          slotStatus: result.slot.status,
          lessonsCreated: result.lessons.length,
          lessonIds: result.lessons.map(l => l.id),
        });
      }
      
      setToast({ message: 'השיעור נקבע והחלון עודכן', type: 'success' });
      // Call onSuccess immediately to trigger refresh (cache invalidation already happened in reserveSlotAndCreateLessons)
      onSuccess();
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setIsReserving(false);
    }
  };

  const handleCloseSlotOnly = async () => {
    if (!currentSlot) return;
    setIsReserving(true);
    try {
      await nexusApi.updateSlotInventory(currentSlot.id, { status: 'closed' as any });
      setToast({ message: 'החלון נסגר בהצלחה', type: 'success' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setIsReserving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
        <div 
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
          onClick={onClose}
        />
        <div 
          className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 animate-in zoom-in-95 duration-200" 
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-black text-slate-900">חלון פתוח</h3>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">תאריך ושעה</div>
              <div className="text-base font-black text-slate-900">
                {dateStr} • {startTime}–{endTime}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שריין לתלמיד</label>
              <StudentPicker
                value={selectedStudent}
                onChange={setSelectedStudent}
                placeholder="חפש תלמיד לשיבוץ..."
                disabled={isReserving}
              />
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <button
                type="button"
                onClick={handleConfirmReservation}
                disabled={isReserving || !selectedStudent}
                className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                  isReserving || !selectedStudent
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-cyan-600 text-white hover:bg-cyan-700 shadow-cyan-100'
                }`}
              >
                {isReserving && selectedStudent ? 'מעבד...' : 'שריין לתלמיד וצור שיעור'}
              </button>
              
              <button
                type="button"
                onClick={handleCloseSlotOnly}
                disabled={isReserving}
                className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                  isReserving
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {isReserving && !selectedStudent ? 'מעבד...' : 'סגור חלון (ללא שיעור)'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
};

export default SlotInventoryModal;
