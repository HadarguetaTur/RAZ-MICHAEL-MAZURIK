import React, { useState, useEffect, useRef } from 'react';
import { OpenSlot, SlotInventory, OpenSlotRecord } from '../../types';

export interface SlotOverlapModalProps {
  isOpen: boolean;
  overlappingSlots: (OpenSlot | SlotInventory | OpenSlotRecord)[];
  onAction: (action: 'save_anyway' | 'save_and_close' | 'reserve_slot' | 'cancel', selectedSlotId: string) => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

const SlotOverlapModal: React.FC<SlotOverlapModalProps> = ({
  isOpen,
  overlappingSlots,
  onAction,
  onCancel,
  isLoading = false,
}) => {
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  // Set default selected slot when modal opens
  useEffect(() => {
    if (isOpen && overlappingSlots.length > 0) {
      setSelectedSlotId(overlappingSlots[0].id);
      // Focus first button after a short delay
      setTimeout(() => {
        if (firstButtonRef.current) {
          firstButtonRef.current.focus();
        }
      }, 100);
    }
  }, [isOpen, overlappingSlots]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onCancel]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isLoading) {
      onCancel();
    }
  };

  const handleAction = async (action: 'save_anyway' | 'save_and_close' | 'reserve_slot' | 'cancel') => {
    if (isLoading) return;
    if (action === 'cancel') {
      onCancel();
      return;
    }
    
    // For actions that need a selected slot, ensure one is selected
    if ((action === 'save_and_close' || action === 'reserve_slot') && !selectedSlotId) {
      if (overlappingSlots.length > 0) {
        setSelectedSlotId(overlappingSlots[0].id);
      } else {
        return;
      }
    }
    
    await onAction(action, selectedSlotId || overlappingSlots[0]?.id || '');
  };

  // Format slot time range (OpenSlot / OpenSlotRecord have startDateTime/endDateTime; SlotInventory has startTime/endTime)
  const formatSlotTime = (slot: OpenSlot | SlotInventory | OpenSlotRecord): string => {
    if ('startDateTime' in slot && slot.startDateTime && 'endDateTime' in slot && slot.endDateTime) {
      const start = new Date(slot.startDateTime);
      const end = new Date(slot.endDateTime);
      const startTime = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
      const endTime = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
      return `${startTime} - ${endTime}`;
    }
    if ('startTime' in slot && 'endTime' in slot) {
      return `${slot.startTime} - ${slot.endTime}`;
    }
    return '';
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"></div>
      <div
        ref={dialogRef}
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border-2 border-amber-200 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 md:p-8 border-b-2 border-amber-200">
          <h3 className="text-xl md:text-2xl font-black text-amber-800 mb-4">
            יש חלון פתוח בבוט בזמן הזה
          </h3>
          <div className="text-sm md:text-base text-slate-700 font-medium leading-relaxed mb-4">
            השיעור המבוקש חופף עם {overlappingSlots.length} חלון{overlappingSlots.length > 1 ? 'ות' : ''} פתוח{overlappingSlots.length > 1 ? 'ים' : ''}:
          </div>
          
          {/* Slot list with radio selection if multiple */}
          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
            {overlappingSlots.map((slot) => (
              <label
                key={slot.id}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  selectedSlotId === slot.id
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                }`}
              >
                {overlappingSlots.length > 1 && (
                  <input
                    type="radio"
                    name="selectedSlot"
                    value={slot.id}
                    checked={selectedSlotId === slot.id}
                    onChange={(e) => setSelectedSlotId(e.target.value)}
                    disabled={isLoading}
                    className="w-5 h-5 text-amber-600 focus:ring-2 focus:ring-amber-200 disabled:opacity-50"
                  />
                )}
                <div className="flex-1">
                  <div className="font-bold text-slate-900">
                    {formatSlotTime(slot)}
                  </div>
                  {slot.teacherName && (
                    <div className="text-xs text-slate-500">
                      מורה: {slot.teacherName}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="p-6 md:p-8 space-y-3">
          {/* Action buttons */}
          <button
            ref={firstButtonRef}
            onClick={() => handleAction('save_anyway')}
            disabled={isLoading}
            className="w-full py-3 md:py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-sm md:text-base shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'שומר...' : 'קבע שיעור בכל זאת'}
          </button>
          
          <button
            onClick={() => handleAction('save_and_close')}
            disabled={isLoading || overlappingSlots.length === 0}
            className="w-full py-3 md:py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-sm md:text-base shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'שומר...' : 'קבע שיעור + סגור חלון'}
          </button>
          
          <button
            onClick={() => handleAction('reserve_slot')}
            disabled={isLoading || overlappingSlots.length === 0}
            className="w-full py-3 md:py-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-sm md:text-base shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'שומר...' : 'שריין חלון'}
          </button>
          
          <button
            onClick={() => handleAction('cancel')}
            disabled={isLoading}
            className="w-full py-3 md:py-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm md:text-base hover:bg-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
};

export default SlotOverlapModal;
