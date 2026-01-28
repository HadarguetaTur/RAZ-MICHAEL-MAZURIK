import React, { useState } from 'react';
import { OpenSlotRecord } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import { bookLessonFromSlot } from '../services/slotBookingService';
import Toast from './Toast';

interface SlotInventoryModalProps {
  slot: OpenSlotRecord;
  onClose: () => void;
  onSuccess: () => void;
}

const SlotInventoryModal: React.FC<SlotInventoryModalProps> = ({ slot, onClose, onSuccess }) => {
  const [isReserving, setIsReserving] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const startDate = new Date(slot.startDateTime);
  const endDate = new Date(slot.endDateTime);
  const dateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
  const startTime = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`;
  const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;

  const handleReserveSlot = async () => {
    setIsReserving(true);
    try {
      // Update slot status to 'booked' (which translates to 'סגור' in Airtable)
      await nexusApi.updateSlotInventory(slot.id, { status: 'booked' });
      setToast({ message: 'החלון נשמר בהצלחה', type: 'success' });
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

  const handleBookLesson = async () => {
    setIsBooking(true);
    try {
      // Use bookLessonFromSlot which creates a lesson and closes the slot
      await bookLessonFromSlot(slot.id, {
        slotId: slot.id,
        date: dateStr,
        startTime: startTime,
        endTime: endTime,
      });
      setToast({ message: 'השיעור נקבע בהצלחה', type: 'success' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setIsBooking(false);
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

            <div className="flex flex-col gap-3 pt-2">
              <button
                type="button"
                onClick={handleReserveSlot}
                disabled={isReserving || isBooking}
                className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                  isReserving || isBooking
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isReserving ? 'שומר...' : 'שריין חלון'}
              </button>
              
              <button
                type="button"
                onClick={handleBookLesson}
                disabled={isReserving || isBooking}
                className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                  isReserving || isBooking
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {isBooking ? 'מעבד...' : 'קבע שיעור בחלון'}
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
