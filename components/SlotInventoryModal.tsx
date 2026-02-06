import React, { useState } from 'react';
import { nexusApi, parseApiError } from '../services/nexusApi';
import { reserveSlotAndCreateLessons } from '../services/slotBookingService';
import StudentsPicker from './StudentsPicker';
import Toast from './Toast';

interface SlotInventoryModalProps {
  slot: {
    id: string;
    startDateTime: string;
    endDateTime: string;
    teacherId?: string;
    status?: string;
  };
  onClose: () => void;
  onSuccess: () => void;
  requireStudentForReserve?: boolean; // New prop: require student selection for reservation
}

const SlotInventoryModal: React.FC<SlotInventoryModalProps> = ({ slot, onClose, onSuccess, requireStudentForReserve = false }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const startDate = new Date(slot.startDateTime);
  const endDate = new Date(slot.endDateTime);
  const startValid = !isNaN(startDate.getTime());
  const endValid = !isNaN(endDate.getTime());
  const dateStr = startValid
    ? `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
    : (slot as any).date ?? '—';
  const startTime = startValid
    ? `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`
    : (slot as any).startTime ?? '—';
  const endTime = endValid
    ? `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`
    : (slot as any).endTime ?? '—';

  // "שריין חלון" - Reserve/Book the slot
  const handleReserveSlot = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SlotInventoryModal.tsx:handleReserveSlot:entry',message:'handleReserveSlot called',data:{requireStudentForReserve,slotId:slot.id,selectedStudentIds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    // If requireStudentForReserve is true, validate student selection
    if (requireStudentForReserve) {
      if (!selectedStudentIds || selectedStudentIds.length === 0) {
        setToast({ message: 'יש לבחור לפחות תלמיד אחד', type: 'error' });
        return;
      }
      
      setIsProcessing(true);
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SlotInventoryModal.tsx:handleReserveSlot:beforeCreate',message:'About to call reserveSlotAndCreateLessons',data:{slotId:slot.id,studentCount:selectedStudentIds.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        // Reserve slot and create lessons for selected students
        await reserveSlotAndCreateLessons(slot.id, selectedStudentIds);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SlotInventoryModal.tsx:handleReserveSlot:success',message:'reserveSlotAndCreateLessons completed',data:{slotId:slot.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        setToast({ message: 'החלון נשמר והשיעור נוצר בהצלחה', type: 'success' });
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1000);
      } catch (err: any) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SlotInventoryModal.tsx:handleReserveSlot:error',message:'reserveSlotAndCreateLessons failed',data:{slotId:slot.id,error:err?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        setToast({ message: parseApiError(err), type: 'error' });
      } finally {
        setIsProcessing(false);
      }
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SlotInventoryModal.tsx:handleReserveSlot:noStudentRequired',message:'requireStudentForReserve is FALSE - only updating status',data:{slotId:slot.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
      // Original behavior: just update status to 'closed'
      setIsProcessing(true);
      try {
        await nexusApi.updateSlotInventory(slot.id, { status: 'closed' as any });
        setToast({ message: 'החלון נשמר בהצלחה', type: 'success' });
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1000);
      } catch (err: any) {
        setToast({ message: parseApiError(err), type: 'error' });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // "סגור חלון" - Just close/cancel the slot
  const handleCloseSlot = async () => {
    setIsProcessing(true);
    try {
      await nexusApi.updateSlotInventory(slot.id, { status: 'canceled' as any });
      setToast({ message: 'החלון נסגר', type: 'success' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setIsProcessing(false);
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

            {/* Show StudentsPicker only if requireStudentForReserve is true */}
            {requireStudentForReserve && (
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  תלמידים (חובה)
                </label>
                <StudentsPicker
                  values={selectedStudentIds}
                  onChange={(ids) => {
                    setSelectedStudentIds(ids);
                    // Clear error toast when user selects a student
                    if (ids.length > 0 && toast?.type === 'error' && toast.message === 'יש לבחור לפחות תלמיד אחד') {
                      setToast(null);
                    }
                  }}
                  placeholder="חפש תלמידים..."
                  disabled={isProcessing}
                  filterActiveOnly={true}
                />
                {selectedStudentIds.length === 0 && (
                  <div className="text-xs text-amber-600 font-medium">
                    יש לבחור לפחות תלמיד אחד כדי לשריין את החלון
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <button
                type="button"
                onClick={handleReserveSlot}
                disabled={isProcessing || (requireStudentForReserve && selectedStudentIds.length === 0)}
                className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                  isProcessing || (requireStudentForReserve && selectedStudentIds.length === 0)
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isProcessing ? 'מעבד...' : 'שריין חלון'}
              </button>
              
              <button
                type="button"
                onClick={handleCloseSlot}
                disabled={isProcessing}
                className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                  isProcessing
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                סגור חלון
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
