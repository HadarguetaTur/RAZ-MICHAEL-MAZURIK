import React, { useState } from 'react';
import { WeeklySlot, SlotInventory, Student } from '../types';
import ConfirmDialog from './ui/ConfirmDialog';

const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

type WeeklyModeProps = {
  mode?: 'weekly';
  slots: WeeklySlot[];
  weekStart?: never;
  students?: Student[]; // For reserved student lookup
  onSlotEdit?: (slot: WeeklySlot) => void;
  onSlotDelete?: (slot: WeeklySlot) => void;
  onSlotToggleStatus?: (slot: WeeklySlot) => void;
  onAddSlot?: (dayIdx: number) => void;
};

type OneTimeModeProps = {
  mode: 'onetime';
  slots: SlotInventory[];
  weekStart: string;
  students?: Student[]; // For reservation modal
  onSlotEdit?: (slot: SlotInventory) => void;
  onSlotDelete?: (slot: SlotInventory) => void;
  onSlotToggleStatus?: (slot: SlotInventory) => void;
  onReserveSlot?: (slotId: string) => void; // Changed: now just opens modal, doesn't reserve directly
  onAddSlot?: never;
};

type WeeklySlotsGridProps = WeeklyModeProps | OneTimeModeProps;

const WeeklySlotsGrid: React.FC<WeeklySlotsGridProps> = (props) => {
  const {
    slots,
    mode = 'weekly',
    students,
    onSlotEdit,
    onSlotDelete,
    onSlotBlock,
    onSlotToggleStatus,
    onAddSlot,
    onReserveSlot,
  } = props as WeeklyModeProps & OneTimeModeProps;

  const isWeeklyMode = mode === 'weekly';

  const renderSlotCard = (slot: WeeklySlot | SlotInventory) => {
    const isWeeklySlot = 'dayOfWeek' in slot;

    if (isWeeklySlot) {
      const weeklySlot = slot as WeeklySlot;
      const isActive = weeklySlot.status === 'active';
      const isFixed = weeklySlot.isFixed || false;
      
      // Get reserved students - prefer reservedForNames, fallback to reservedForIds lookup
      let reservedStudentNames: string[] = [];
      if (weeklySlot.reservedForNames && weeklySlot.reservedForNames.length > 0) {
        reservedStudentNames = weeklySlot.reservedForNames;
      } else if (weeklySlot.reservedForIds && weeklySlot.reservedForIds.length > 0 && students) {
        // Fallback: lookup names from IDs
        reservedStudentNames = weeklySlot.reservedForIds
          .map(id => {
            const student = (students as Student[]).find(s => s.id === id);
            return student?.name;
          })
          .filter((name): name is string => !!name);
      } else if (weeklySlot.reservedFor && students) {
        // Backward compatibility: single reservedFor
        const reservedStudent = (students as Student[]).find((s) => s.id === weeklySlot.reservedFor);
        if (reservedStudent) {
          reservedStudentNames = [reservedStudent.name];
        }
      }
      
      // Count if we have IDs but no names
      const reservedCount = weeklySlot.reservedForIds?.length || (weeklySlot.reservedFor ? 1 : 0);

      return (
        <div
          key={weeklySlot.id}
          className={`group relative p-4 rounded-2xl border transition-all duration-200 ${
            isActive
              ? 'bg-slate-50 border-slate-200 shadow-sm hover:border-slate-400'
              : 'bg-slate-100 border-slate-200 opacity-80'
          }`}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-black ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                {weeklySlot.startTime} – {weeklySlot.endTime}
              </span>
              <div className="flex items-center gap-1">
                {weeklySlot.hasOverlap && (
                  <span className="text-[8px] font-black text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded">
                    חפיפה
                  </span>
                )}
                {isFixed && (
                  <span className="text-[8px] font-black text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                    קבוע
                  </span>
                )}
                <div
                  className={`w-2 h-2 rounded-full ${
                    isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                  }`}
                ></div>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {weeklySlot.type && (
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                  {weeklySlot.type === 'private'
                    ? 'שיעור פרטי'
                    : weeklySlot.type === 'group'
                    ? 'קבוצתי'
                    : weeklySlot.type === 'pair'
                    ? 'זוגי'
                    : weeklySlot.type}
                </span>
              )}
              {weeklySlot.teacherName && (
                <span className="text-[10px] font-medium text-slate-500">{weeklySlot.teacherName}</span>
              )}
              {reservedStudentNames.length > 0 && (
                <span className="text-[10px] font-medium text-blue-600">
                  תלמידים: {reservedStudentNames.length > 3 
                    ? `${reservedStudentNames.slice(0, 3).join(', ')} (+${reservedStudentNames.length - 3})`
                    : reservedStudentNames.join(', ')}
                </span>
              )}
              {reservedStudentNames.length === 0 && reservedCount > 0 && (
                <span className="text-[10px] font-medium text-blue-600">תלמידים: {reservedCount}</span>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            {onSlotToggleStatus && (
              <button
                onClick={() => onSlotToggleStatus(weeklySlot)}
                className={`text-[10px] font-black underline ${
                  isActive ? 'text-rose-500' : 'text-emerald-600'
                }`}
              >
                {isActive ? 'הקפא' : 'הפעל'}
              </button>
            )}
            <div className="flex gap-2">
              {onSlotEdit && (
                <button
                  onClick={() => {
                    // STEP 1: Trace click event
                    if (import.meta.env.DEV) {
                      console.log('[EDIT_CLICK]', {
                        slotId: weeklySlot.id,
                        dayOfWeek: weeklySlot.dayOfWeek,
                        teacherId: weeklySlot.teacherId,
                        teacherName: weeklySlot.teacherName,
                        startTime: weeklySlot.startTime,
                        endTime: weeklySlot.endTime,
                        type: weeklySlot.type,
                        reservedForIds: weeklySlot.reservedForIds?.length || 0,
                        reservedFor: weeklySlot.reservedFor ? 1 : 0,
                        isFixed: weeklySlot.isFixed,
                        fullSlot: weeklySlot,
                      });
                    }
                    onSlotEdit(weeklySlot);
                  }}
                  className="text-[10px] font-black text-blue-600 underline"
                >
                  ערוך
                </button>
              )}
              {onSlotDelete && (
                <button
                  onClick={() => onSlotDelete(weeklySlot)}
                  className="text-[10px] font-black text-slate-400 hover:text-rose-600"
                >
                  מחק
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    const inventorySlot = slot as SlotInventory;
    const isOpen = inventorySlot.status === 'open';
    const isBlocked = inventorySlot.status === 'blocked';

    const slotStudents =
      inventorySlot.students && students
        ? inventorySlot.students
            .map((sid) => (students as Student[]).find((st) => st.id === sid))
            .filter(Boolean) as Student[]
        : [];

    return (
      <SlotInventoryCard
        key={inventorySlot.id}
        slot={inventorySlot}
        isOpen={isOpen}
        isBlocked={isBlocked}
        slotStudents={slotStudents}
        onReserveSlot={onReserveSlot}
        onSlotEdit={onSlotEdit}
        onSlotDelete={onSlotDelete}
        onSlotBlock={onSlotBlock}
      />
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
      {DAYS_HEBREW.map((dayName, dayIdx) => {
        let daySlots: (WeeklySlot | SlotInventory)[];

        if (isWeeklyMode) {
          daySlots = (slots as WeeklySlot[])
            .filter((s) => s.dayOfWeek === dayIdx)
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
        } else {
          const { weekStart } = props as OneTimeModeProps;
          const startDate = new Date(weekStart);
          const dayDate = new Date(startDate);
          dayDate.setDate(startDate.getDate() + dayIdx);
          const dateStr = dayDate.toISOString().split('T')[0];

          daySlots = (slots as SlotInventory[])
            .filter((s) => s.date === dateStr)
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
        }

        return (
          <div key={dayIdx} className="flex flex-col gap-4">
            <div className="bg-slate-900 text-white py-3 px-4 rounded-2xl flex items-center justify-between shadow-sm">
              <span className="text-sm font-black">{dayName}</span>
              <span className="text-[10px] font-bold opacity-50">
                {daySlots.length} חלונות
              </span>
            </div>

            <div className="space-y-3">
              {daySlots.map(renderSlotCard)}

              {isWeeklyMode && onAddSlot && (
                <button
                  onClick={() => onAddSlot(dayIdx)}
                  className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-1 group hover:border-blue-300 hover:bg-blue-50/30 transition-all"
                >
                  <span className="text-lg text-slate-300 group-hover:text-blue-500 group-hover:scale-110 transition-transform">
                    +
                  </span>
                  <span className="text-[10px] font-black text-slate-400 group-hover:text-blue-600">
                    הוסף חלון
                  </span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Slot Inventory Card Component (with action buttons) - defined outside WeeklySlotsGrid
const SlotInventoryCard: React.FC<{
    slot: SlotInventory;
    isOpen: boolean;
    isBlocked: boolean;
    slotStudents: Student[];
    onReserveSlot?: (slotId: string) => void;
    onSlotEdit?: (slot: SlotInventory) => void;
    onSlotDelete?: (slotId: string) => void;
    onSlotBlock?: (slotId: string) => void;
  }> = ({ slot, isOpen, isBlocked, slotStudents, onReserveSlot, onSlotEdit, onSlotDelete, onSlotBlock }) => {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showBlockConfirm, setShowBlockConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isBlocking, setIsBlocking] = useState(false);

    const handleDelete = async () => {
      if (!onSlotDelete) return;
      setIsDeleting(true);
      try {
        await onSlotDelete(slot.id);
        setShowDeleteConfirm(false);
      } catch (err) {
        console.error('[SlotInventoryCard] Delete failed:', err);
        // Error handling is done in parent component
      } finally {
        setIsDeleting(false);
      }
    };

    const handleBlock = async () => {
      if (!onSlotBlock) return;
      setIsBlocking(true);
      try {
        await onSlotBlock(slot.id);
        setShowBlockConfirm(false);
      } catch (err) {
        console.error('[SlotInventoryCard] Block failed:', err);
        // Error handling is done in parent component
      } finally {
        setIsBlocking(false);
      }
    };

    return (
      <>
        <div
          className={`group relative p-4 rounded-2xl border transition-all duration-200 ${
            isOpen ? 'bg-cyan-50 border-cyan-200 shadow-sm hover:border-cyan-400' 
            : isBlocked ? 'bg-amber-50 border-amber-300 shadow-sm hover:border-amber-400'
            : 'bg-slate-100 border-slate-200'
          }`}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-black ${isOpen ? 'text-slate-900' : isBlocked ? 'text-amber-900' : 'text-slate-400'}`}>
                {slot.startTime} – {slot.endTime}
              </span>
              <div className="flex items-center gap-1">
                <span
                  className={`text-[8px] font-black px-1.5 py-0.5 rounded ${
                    slot.status === 'open'
                      ? 'text-cyan-700 bg-cyan-100'
                      : slot.status === 'closed'
                      ? 'text-blue-600 bg-blue-50'
                      : slot.status === 'blocked'
                      ? 'text-amber-700 bg-amber-100'
                      : 'text-rose-600 bg-rose-50'
                  }`}
                >
                  {slot.status === 'open'
                    ? 'חלון פתוח'
                    : slot.status === 'closed'
                    ? 'סגור'
                    : slot.status === 'blocked'
                    ? 'חסום'
                    : 'מבוטל'}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {slot.teacherName && (
                <span className="text-[10px] font-medium text-slate-500">{slot.teacherName}</span>
              )}
              {slot.occupied !== undefined && slot.capacityOptional !== undefined && (
                <span className="text-[10px] font-bold text-cyan-700">תפוסה: {slot.occupied}/{slot.capacityOptional}</span>
              )}
              {slotStudents.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {slotStudents.map((s, i) => (
                    <span key={i} className="text-[9px] bg-cyan-100 text-cyan-800 px-1.5 py-0.5 rounded-md font-bold">
                      {s.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {isOpen && onReserveSlot && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (import.meta.env?.DEV) {
                        console.log('[SlotInventoryCard] Reserve button clicked:', slot.id);
                      }
                      onReserveSlot(slot.id);
                    }}
                    className="text-[10px] font-black text-cyan-600 hover:text-cyan-700 underline transition-colors"
                  >
                    שריין חלון
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {onSlotEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSlotEdit(slot);
                    }}
                    className="text-[10px] font-black text-blue-600 hover:text-blue-700 underline transition-colors"
                    title="ערוך"
                  >
                    ערוך
                  </button>
                )}
                {onSlotDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(true);
                    }}
                    className="text-[10px] font-black text-rose-600 hover:text-rose-700 underline transition-colors"
                    title="מחק"
                  >
                    מחק
                  </button>
                )}
                {onSlotBlock && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowBlockConfirm(true);
                    }}
                    className="text-[10px] font-black text-amber-600 hover:text-amber-700 underline transition-colors"
                    title={isBlocked ? 'ביטול חסימה' : 'חסום'}
                  >
                    {isBlocked ? 'ביטול חסימה' : 'חסום'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <ConfirmDialog
            isOpen={showDeleteConfirm}
            title="מחיקת חלון"
            message="למחוק את החלון? פעולה זו לא ניתנת לשחזור."
            confirmLabel="מחק"
            cancelLabel="ביטול"
            variant="danger"
            onConfirm={handleDelete}
            onCancel={() => setShowDeleteConfirm(false)}
            isLoading={isDeleting}
          />
        )}

        {/* Block Confirmation Dialog */}
        {showBlockConfirm && (
          <ConfirmDialog
            isOpen={showBlockConfirm}
            title={isBlocked ? 'ביטול חסימה' : 'חסימת חלון'}
            message={isBlocked 
              ? 'לבטל את החסימה על החלון? תלמידים יוכלו לקבוע בו שוב.'
              : 'לחסום את החלון? תלמידים לא יוכלו לקבוע בו.'}
            confirmLabel={isBlocked ? 'בטל חסימה' : 'חסום'}
            cancelLabel="ביטול"
            variant="warning"
            onConfirm={handleBlock}
            onCancel={() => setShowBlockConfirm(false)}
            isLoading={isBlocking}
          />
        )}
      </>
    );
  };

export default WeeklySlotsGrid;
