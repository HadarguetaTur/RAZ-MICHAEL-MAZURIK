
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Lesson, LessonStatus, Teacher, Student, LessonType, OpenSlotRecord, SlotInventory } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import { findOverlappingOpenSlots } from '../services/overlapDetection';
import LessonDetailsModal from './LessonDetailsModal';
import StudentPicker from './StudentPicker';
import StudentsPicker from './StudentsPicker';
import SlotOverlapModal from './ui/SlotOverlapModal';
import LessonOverlapWarningModal from './ui/LessonOverlapWarningModal';
import SlotInventoryModal from './SlotInventoryModal';
import Toast from './Toast';
import { buildConflictSummary, type ConflictItem } from '../services/conflictsCheckService';
import { logConflictOverride } from '../services/eventLog';
import { isOverlapping } from '../utils/overlaps';

/** Unified calendar row: lesson or open_slot. start/end are ISO strings; layout uses date + time. */
type CalendarItem =
  | { kind: 'lesson'; id: string; start: string; end: string; teacherId?: string; title: string; meta: { lesson: Lesson } }
  | { kind: 'open_slot'; id: string; start: string; end: string; teacherId?: string; title: string; meta: { openSlot: OpenSlotRecord } };

/** Distinct styling for open slots: subtle border/background + "חלון פתוח" tag. Reused in agenda and week/day grid. */
const OPEN_SLOT_CARD_CLASS =
  'border-2 border-dashed border-slate-300 bg-slate-50/80';
const OPEN_SLOT_TAG_CLASS =
  'text-[10px] font-bold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded-full border border-slate-300';
/** Subtle overlap badges – not too prominent */
const BADGE_OVERLAP_SLOT = 'text-[9px] font-bold text-amber-600/90 bg-amber-50/90 px-1.5 py-0.5 rounded-md border border-amber-200/80';
const BADGE_OVERLAP_LESSON = 'text-[9px] font-bold text-amber-600/90 bg-amber-50/90 px-1.5 py-0.5 rounded-md border border-amber-200/80';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 08:00 to 21:00
const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Compute end time "HH:mm" from start "HH:mm" and duration in minutes. */
function endTimeFromDuration(startTime: string, durationMin: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = (h * 60 + (m || 0) + durationMin) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const Calendar: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'day' | 'agenda' | 'recurring'>(window.innerWidth < 768 ? 'agenda' : 'week');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [openSlots, setOpenSlots] = useState<OpenSlotRecord[]>([]);
  const [rawRecords, setRawRecords] = useState<Map<string, any>>(new Map()); // Store raw Airtable records
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<any>(null); // Raw Airtable record for modal
  const [isCreating, setIsCreating] = useState(false);
  const [editState, setEditState] = useState<Partial<Lesson & { endDate?: string }>>({ studentIds: [], lessonType: 'private' });
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [conflicts, setConflicts] = useState<Lesson[]>([]);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const conflictCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [showSlotOverlapModal, setShowSlotOverlapModal] = useState(false);
  const [overlappingSlotsForModal, setOverlappingSlotsForModal] = useState<OpenSlotRecord[]>([]);
  const [isOverlapActionLoading, setIsOverlapActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [editingSlot, setEditingSlot] = useState<OpenSlotRecord | null>(null);
  const [slotEditForm, setSlotEditForm] = useState<{ date: string; startTime: string; endTime: string }>({ date: '', startTime: '', endTime: '' });
  const [isSavingSlotEdit, setIsSavingSlotEdit] = useState(false);
  const [showSlotEditOverlapModal, setShowSlotEditOverlapModal] = useState(false);
  const [slotEditOverlapConflicts, setSlotEditOverlapConflicts] = useState<ConflictItem[]>([]);
  const [isCheckingSlotConflictsApi, setIsCheckingSlotConflictsApi] = useState(false);
  const [showLessonOverlapModal, setShowLessonOverlapModal] = useState(false);
  const [lessonOverlapConflicts, setLessonOverlapConflicts] = useState<ConflictItem[]>([]);
  const [isCheckingConflictsApi, setIsCheckingConflictsApi] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlotRecord | null>(null);

  const weekDates = useMemo(() => {
    const dates = [];
    const firstDay = new Date(currentDate);
    firstDay.setDate(currentDate.getDate() - currentDate.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(firstDay);
      d.setDate(firstDay.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [currentDate]);

  const currentMonthDisplay = useMemo(() => {
    return currentDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }, [currentDate]);

  const startDate = weekDates[0].toISOString().split('T')[0];
  const endDateStr = weekDates[6].toISOString().split('T')[0];

  /** Convert slot_inventory (by date range) to open-slots format. Uses StartDT/EndDT when present, else date+startTime/endTime. */
  const inventoryToOpenSlots = useCallback((inventory: SlotInventory[]): OpenSlotRecord[] => {
    return inventory
      .filter((s) => s.status === 'open')
      .map((s) => {
        const slot = s as SlotInventory & { startDT?: string; endDT?: string };
        const startPart = (slot.startTime || '').length >= 5 ? (slot.startTime || '').slice(0, 5) : (slot.startTime || '00:00');
        const endPart = (slot.endTime || '').length >= 5 ? (slot.endTime || '').slice(0, 5) : (slot.endTime || '01:00');
        const startDateTime = slot.startDT ?? new Date(`${slot.date}T${startPart}:00`).toISOString();
        const endDateTime = slot.endDT ?? new Date(`${slot.date}T${endPart}:00`).toISOString();
        return {
          id: slot.id,
          teacherId: slot.teacherId ?? '',
          startDateTime,
          endDateTime,
          status: 'open' as const,
        };
      });
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [lessonsData, slotInventoryData, teachersData, studentsData] = await Promise.all([
          nexusApi.getLessons(startDate, endDateStr),
          nexusApi.getSlotInventory(startDate, endDateStr),
          nexusApi.getTeachers(),
          nexusApi.getStudents()
        ]);
        setLessons(lessonsData);
        setOpenSlots(inventoryToOpenSlots(slotInventoryData));
        // Store raw records if available
        if ((lessonsData as any).rawRecords) {
          setRawRecords((lessonsData as any).rawRecords);
        }
        setTeachers(teachersData);
        setStudents(studentsData);
      } catch (err: any) {
        if (import.meta.env?.DEV) console.error('[Calendar] Load error:', parseApiError(err));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [startDate, endDateStr, inventoryToOpenSlots]);

  const refreshCalendarData = useCallback(async () => {
    const [lessonsData, slotInventoryData] = await Promise.all([
      nexusApi.getLessons(startDate, endDateStr),
      nexusApi.getSlotInventory(startDate, endDateStr),
    ]);
    setLessons(lessonsData);
    setOpenSlots(inventoryToOpenSlots(slotInventoryData));
    if ((lessonsData as any).rawRecords) {
      setRawRecords((lessonsData as any).rawRecords);
    }
  }, [startDate, endDateStr, inventoryToOpenSlots]);

  const filteredLessons = useMemo(() => {
    return lessons.filter(l => {
      const matchesSearch = searchTerm === '' || 
        l.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.notes && l.notes.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesRecurring = viewMode !== 'recurring' || l.lessonType === 'recurring' || l.isPrivate === false; 
      // Show lessons with status: SCHEDULED, COMPLETED (מתוכנן, אישר הגעה, בוצע)
      const matchesStatus = l.status === LessonStatus.SCHEDULED || l.status === LessonStatus.COMPLETED;
      return matchesSearch && matchesRecurring && matchesStatus;
    });
  }, [lessons, searchTerm, viewMode]);

  const calendarItems = useMemo((): CalendarItem[] => {
    const lessonItems: CalendarItem[] = filteredLessons.map(l => {
      const start = `${l.date}T${l.startTime}:00`;
      const endDt = new Date(start);
      endDt.setMinutes(endDt.getMinutes() + (l.duration ?? 60));
      return {
        kind: 'lesson',
        id: l.id,
        start,
        end: endDt.toISOString(),
        teacherId: l.teacherId,
        title: l.studentName,
        meta: { lesson: l },
      };
    });
    const slotItems: CalendarItem[] = openSlots.map(s => ({
      kind: 'open_slot' as const,
      id: s.id,
      start: s.startDateTime,
      end: s.endDateTime,
      teacherId: s.teacherId,
      title: 'חלון פתוח',
      meta: { openSlot: s },
    }));
    return [...lessonItems, ...slotItems];
  }, [filteredLessons, openSlots]);

  /** Memoized overlap badges by day+teacher: which lessons overlap a slot, which slots overlap a lesson. No extra server calls. */
  const overlapBadges = useMemo(() => {
    const lessonIdsOverlappingSlot = new Set<string>();
    const slotIdsOverlappingLesson = new Set<string>();
    const slotDateStr = (s: OpenSlotRecord) => {
      const d = new Date(s.startDateTime);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const lessonsByKey = new Map<string, Lesson[]>();
    for (const l of filteredLessons) {
      const k = `${l.date}|${l.teacherId ?? ''}`;
      if (!lessonsByKey.has(k)) lessonsByKey.set(k, []);
      lessonsByKey.get(k)!.push(l);
    }
    const slotsByKey = new Map<string, OpenSlotRecord[]>();
    for (const s of openSlots) {
      const k = `${slotDateStr(s)}|${s.teacherId ?? ''}`;
      if (!slotsByKey.has(k)) slotsByKey.set(k, []);
      slotsByKey.get(k)!.push(s);
    }
    for (const [key, lessonList] of lessonsByKey) {
      const slotList = slotsByKey.get(key);
      if (!slotList?.length) continue;
      for (const l of lessonList) {
        const lStart = `${l.date}T${l.startTime.length >= 5 ? l.startTime.slice(0, 5) : l.startTime}:00`;
        const lEndMs = new Date(lStart).getTime() + (l.duration ?? 60) * 60 * 1000;
        const lEnd = new Date(lEndMs);
        for (const s of slotList) {
          if (isOverlapping(lStart, lEnd, s.startDateTime, s.endDateTime)) {
            lessonIdsOverlappingSlot.add(l.id);
            slotIdsOverlappingLesson.add(s.id);
          }
        }
      }
    }
    return { lessonIdsOverlappingSlot, slotIdsOverlappingLesson };
  }, [filteredLessons, openSlots]);

  /** Date string (YYYY-MM-DD) for grouping by day column. Uses local date for open_slot. */
  const itemDate = (item: CalendarItem): string =>
    item.kind === 'lesson'
      ? item.meta.lesson.date
      : (() => { const d = new Date(item.meta.openSlot.startDateTime); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

  // Check for conflicts using Airtable API
  const checkConflicts = useCallback(async (
    date: string,
    startTime: string,
    duration: number,
    studentId?: string,
    teacherId?: string,
    excludeLessonId?: string
  ) => {
    if (!date || !startTime || !duration) {
      setConflicts([]);
      return;
    }

    // Calculate start_datetime and end_datetime
    // FIX: Convert local time to UTC for conflict check (Airtable stores times in UTC)
    const localStartDatetime = `${date}T${startTime}:00`;
    const startDate = new Date(localStartDatetime);
    const endDate = new Date(startDate.getTime() + (duration * 60 * 1000));
    
    // Convert both to UTC ISO strings for Airtable comparison
    const startDatetime = startDate.toISOString();
    const endDatetime = endDate.toISOString();

    setIsCheckingConflicts(true);
    try {
      const conflictLessons = await nexusApi.checkLessonConflicts(
        startDatetime,
        endDatetime,
        studentId,
        teacherId,
        excludeLessonId
      );
      setConflicts(conflictLessons);
    } catch (err: any) {
      if (import.meta.env?.DEV) console.error('[Calendar] Conflict check error:', err);
      setConflicts([]);
    } finally {
      setIsCheckingConflicts(false);
    }
  }, []);

  // Debounced conflict check
  useEffect(() => {
    if (conflictCheckTimeoutRef.current) {
      clearTimeout(conflictCheckTimeoutRef.current);
    }

    if (isCreating && editState.date && editState.startTime && editState.duration) {
      conflictCheckTimeoutRef.current = setTimeout(() => {
        checkConflicts(
          editState.date!,
          editState.startTime!,
          editState.duration || 60,
          selectedStudent?.id || editState.studentId,
          editState.teacherId,
          selectedLesson?.id
        );
      }, 500); // 500ms debounce
    } else {
      setConflicts([]);
    }

    return () => {
      if (conflictCheckTimeoutRef.current) {
        clearTimeout(conflictCheckTimeoutRef.current);
      }
    };
  }, [editState.date, editState.startTime, editState.duration, selectedStudent, editState.teacherId, isCreating, selectedLesson, checkConflicts]);

  // Auto-update price when duration or lessonType changes (only if not manually edited)
  useEffect(() => {
    if (editState.lessonType === 'private' && !priceManuallyEdited && editState.duration) {
      const calculatedPrice = Math.round(editState.duration * 2.92 * 100) / 100;
      setEditState(p => ({ ...p, price: calculatedPrice }));
    }
  }, [editState.duration, editState.lessonType, priceManuallyEdited]);

  // Reset priceManuallyEdited when lesson type changes or when creating new lesson
  useEffect(() => {
    if (isCreating || editState.lessonType !== 'private') {
      setPriceManuallyEdited(false);
    }
  }, [isCreating, editState.lessonType]);

  // Legacy conflict check for backward compatibility (client-side only)
  const checkConflict = (date: string, startTime: string, duration: number, excludeId?: string) => {
    const startNum = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
    const endNum = startNum + duration;
    return lessons.some(l => {
      if (l.id === excludeId || l.status === LessonStatus.CANCELLED) return false;
      if (l.date !== date) return false;
      const lStart = parseInt(l.startTime.split(':')[0]) * 60 + parseInt(l.startTime.split(':')[1]);
      const lEnd = lStart + l.duration;
      return (startNum < lEnd && endNum > lStart);
    });
  };

  /** Performs create or update using current editState/selectedStudent/selectedLesson. Used by handleSave and overlap-modal actions. */
  const performLessonSave = useCallback(async (): Promise<Lesson> => {
    const studentId = selectedStudent?.id || editState.studentId || editState.studentIds?.[0];
    if (!studentId || typeof studentId !== 'string' || !studentId.startsWith('rec') || !editState.date || !editState.startTime) {
      throw new Error('חסרים שדות חובה');
    }
    if (selectedLesson) {
      return await nexusApi.updateLesson(selectedLesson.id, {
        ...editState,
        studentId,
        studentName: selectedStudent?.name || editState.studentName,
      });
    }
    return await nexusApi.createLesson({
      studentId,
      date: editState.date,
      startTime: editState.startTime,
      duration: editState.duration || 60,
      status: LessonStatus.SCHEDULED,
      subject: editState.subject || 'מתמטיקה',
      teacherId: editState.teacherId,
      notes: editState.notes || '',
      isPrivate: editState.lessonType === 'private',
      lessonType: editState.lessonType || 'private',
      price: editState.price !== undefined ? editState.price : (editState.lessonType === 'private' ? Math.round((editState.duration || 60) * 2.92 * 100) / 100 : undefined),
    });
  }, [editState, selectedStudent, selectedLesson]);

  const handleOverlapAction = useCallback(
    async (action: 'save_anyway' | 'save_and_close' | 'reserve_slot' | 'cancel', selectedSlotId: string) => {
      if (action === 'cancel') {
        setShowSlotOverlapModal(false);
        setOverlappingSlotsForModal([]);
        return;
      }
      setIsOverlapActionLoading(true);
      try {
        if (action === 'save_anyway') {
          await performLessonSave();
          await refreshCalendarData();
          setShowSlotOverlapModal(false);
          setOverlappingSlotsForModal([]);
          setSelectedLesson(null);
          setSelectedStudent(null);
          setIsCreating(false);
          setConflicts([]);
          setPriceManuallyEdited(false);
          return;
        }
        if (action === 'save_and_close') {
          const saved = await performLessonSave();
          await nexusApi.closeSlotForLesson(selectedSlotId, saved.id);
          await refreshCalendarData();
          setShowSlotOverlapModal(false);
          setOverlappingSlotsForModal([]);
          setSelectedLesson(null);
          setSelectedStudent(null);
          setIsCreating(false);
          setConflicts([]);
          setPriceManuallyEdited(false);
          return;
        }
        if (action === 'reserve_slot') {
          await nexusApi.reserveSlot(selectedSlotId);
          await refreshCalendarData();
          setShowSlotOverlapModal(false);
          setOverlappingSlotsForModal([]);
          setSelectedLesson(null);
          setSelectedStudent(null);
          setIsCreating(false);
          setConflicts([]);
          setPriceManuallyEdited(false);
          return;
        }
      } catch (err: any) {
        setToast({ message: parseApiError(err), type: 'error' });
      } finally {
        setIsOverlapActionLoading(false);
      }
    },
    [performLessonSave, refreshCalendarData]
  );

  const handleEditOpenSlot = useCallback((slot: OpenSlotRecord) => {
    const start = new Date(slot.startDateTime);
    const end = new Date(slot.endDateTime);
    const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const startTime = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
    const endTime = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
    setEditingSlot(slot);
    setSlotEditForm({ date, startTime, endTime });
    setShowSlotEditOverlapModal(false);
    setSlotEditOverlapConflicts([]);
  }, []);

  const handleSlotEditOverlapContinue = useCallback(async () => {
    if (!editingSlot || !slotEditForm.date || !slotEditForm.startTime || !slotEditForm.endTime) return;
    const conflictSummary = buildConflictSummary(slotEditOverlapConflicts);
    logConflictOverride({
      recordId: editingSlot.id,
      entity: 'slot_inventory',
      teacherId: editingSlot.teacherId ?? '',
      date: slotEditForm.date,
      conflictSummary: conflictSummary || undefined,
    });
    setIsSavingSlotEdit(true);
    try {
      await nexusApi.updateSlotInventory(editingSlot.id, {
        date: slotEditForm.date,
        startTime: slotEditForm.startTime,
        endTime: slotEditForm.endTime,
      });
      await refreshCalendarData();
      setShowSlotEditOverlapModal(false);
      setSlotEditOverlapConflicts([]);
      setEditingSlot(null);
      setSlotEditForm({ date: '', startTime: '', endTime: '' });
    } catch (err: any) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setIsSavingSlotEdit(false);
    }
  }, [editingSlot, slotEditForm, slotEditOverlapConflicts, refreshCalendarData]);

  const handleSlotEditSave = useCallback(async () => {
    if (!editingSlot || !slotEditForm.date || !slotEditForm.startTime || !slotEditForm.endTime) return;
    setIsCheckingSlotConflictsApi(true);
    let checkResult: { hasConflicts: boolean; conflicts: ConflictItem[] };
    try {
      checkResult = await nexusApi.checkConflicts({
        entity: 'slot_inventory',
        recordId: editingSlot.id,
        teacherId: editingSlot.teacherId ?? '',
        date: slotEditForm.date,
        start: slotEditForm.startTime,
        end: slotEditForm.endTime,
      });
    } catch (err: any) {
      setIsCheckingSlotConflictsApi(false);
      setToast({ message: parseApiError(err), type: 'error' });
      return;
    }
    setIsCheckingSlotConflictsApi(false);
    if (checkResult.hasConflicts && checkResult.conflicts.length > 0) {
      setSlotEditOverlapConflicts(checkResult.conflicts);
      setShowSlotEditOverlapModal(true);
      return;
    }
    setIsSavingSlotEdit(true);
    try {
      await nexusApi.updateSlotInventory(editingSlot.id, {
        date: slotEditForm.date,
        startTime: slotEditForm.startTime,
        endTime: slotEditForm.endTime,
      });
      await refreshCalendarData();
      setEditingSlot(null);
      setSlotEditForm({ date: '', startTime: '', endTime: '' });
    } catch (err: any) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setIsSavingSlotEdit(false);
    }
  }, [editingSlot, slotEditForm, refreshCalendarData]);

  const handleLessonOverlapContinue = useCallback(async () => {
    const conflictSummary = buildConflictSummary(lessonOverlapConflicts);
    const teacherId = editState.teacherId ?? selectedLesson?.teacherId ?? '';
    const date = editState.date ?? selectedLesson?.date ?? '';
    logConflictOverride({
      recordId: selectedLesson?.id,
      entity: 'lesson',
      teacherId: typeof teacherId === 'string' ? teacherId : '',
      date: typeof date === 'string' ? date : '',
      conflictSummary: conflictSummary || undefined,
    });
    setIsSaving(true);
    try {
      await performLessonSave();
      await refreshCalendarData();
      setShowLessonOverlapModal(false);
      setLessonOverlapConflicts([]);
      setSelectedLesson(null);
      setSelectedStudent(null);
      setIsCreating(false);
      setConflicts([]);
      setPriceManuallyEdited(false);
    } catch (err: any) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setIsSaving(false);
    }
  }, [performLessonSave, refreshCalendarData, lessonOverlapConflicts, editState.teacherId, editState.date, selectedLesson?.id, selectedLesson?.teacherId, selectedLesson?.date]);

  const handleSave = async () => {
    // For new lessons, require selectedStudent
    if (isCreating && !selectedStudent) {
      alert('נא לבחור תלמיד');
      return;
    }

    const studentId = selectedStudent?.id || editState.studentId || editState.studentIds?.[0];
    
    // Validate studentId is a valid Airtable record ID (must start with "rec")
    if (!studentId || typeof studentId !== 'string' || !studentId.startsWith('rec')) {
      alert('שגיאה: יש לבחור תלמיד מהרשימה. נא לנסות שוב.');
      if (import.meta.env?.DEV) console.error('[Calendar] Invalid studentId:', studentId, 'selectedStudent:', selectedStudent);
      return;
    }
    
    if (!editState.date || !editState.startTime) {
      alert('נא למלא את כל שדות החובה ולבחור תלמיד');
      return;
    }
    
    if (editState.lessonType === 'recurring' && !editState.endDate) {
      alert('נא להזין תאריך סיום לשיעור מחזורי');
      return;
    }

    // Non-blocking overlap check via API (lessons + slot_inventory)
    const duration = editState.duration ?? 60;
    const endTime = endTimeFromDuration(editState.startTime!, duration);
    setIsCheckingConflictsApi(true);
    let checkResult: { hasConflicts: boolean; conflicts: ConflictItem[] };
    try {
      checkResult = await nexusApi.checkConflicts({
        entity: 'lesson',
        recordId: selectedLesson?.id,
        teacherId: editState.teacherId ?? '',
        date: editState.date!,
        start: editState.startTime!,
        end: endTime,
      });
    } catch (err: any) {
      setIsCheckingConflictsApi(false);
      setToast({ message: parseApiError(err), type: 'error' });
      return;
    }
    setIsCheckingConflictsApi(false);
    if (checkResult.hasConflicts && checkResult.conflicts.length > 0) {
      setLessonOverlapConflicts(checkResult.conflicts);
      setShowLessonOverlapModal(true);
      return;
    }

    setIsSaving(true);
    try {
      await performLessonSave();
      await refreshCalendarData();
      setSelectedLesson(null);
      setSelectedStudent(null);
      setIsCreating(false);
      setConflicts([]);
      setPriceManuallyEdited(false);
    } catch (err: any) {
      if (err.code === 'CONFLICT_ERROR' || err.status === 409) {
        const conflictDetails = err.conflicts?.map((c: Lesson) => 
          `• ${c.studentName || 'ללא שם'} - ${c.date} ${c.startTime} (${c.duration || 60} דקות)`
        ).join('\n') || '';
        alert(`לא ניתן לקבוע שיעורים חופפים!\n\n${err.message || 'שיעור זה חופף עם שיעור קיים'}\n\n${conflictDetails ? `שיעורים חופפים:\n${conflictDetails}\n\n` : ''}אנא בחר זמן אחר.`);
      } else {
        alert(parseApiError(err));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedLesson) return;
    if (!confirm('האם אתה בטוח שברצונך לבטל את השיעור?')) return;
    setIsSaving(true);
    try {
      const updated = await nexusApi.updateLesson(selectedLesson.id, { status: LessonStatus.CANCELLED });
      setLessons(prev => prev.map(l => l.id === selectedLesson.id ? updated : l));
      setSelectedLesson(null);
    } catch (err: any) {
      alert(parseApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSlotClick = (date: Date, hour: number) => {
    const timeStr = `${hour < 10 ? '0' : ''}${hour}:00`;
    setEditState({
      date: date.toISOString().split('T')[0],
      startTime: timeStr,
      duration: 60,
      status: LessonStatus.SCHEDULED,
      subject: 'מתמטיקה',
      lessonType: 'private',
      studentIds: [],
      notes: ''
    });
    setSelectedStudent(null);
    setConflicts([]);
    setIsCreating(true);
    setSelectedLesson(null);
  };

  // toggleStudentSelection removed - StudentsPicker handles multi-select internally

  const navigate = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() + direction * (viewMode === 'day' ? 1 : 7));
    setCurrentDate(newDate);
  };

  return (
    <div className="flex flex-col h-full gap-6 animate-in fade-in duration-500 w-full overflow-visible">
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col lg:flex-row items-center justify-between gap-6 w-full">
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
          <button 
            onClick={() => {
              setEditState({ date: new Date().toISOString().split('T')[0], startTime: '10:00', duration: 60, lessonType: 'private', studentIds: [], notes: '', subject: 'מתמטיקה' });
              setIsCreating(true);
              setSelectedLesson(null);
            }}
            className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold text-sm shadow-md hover:bg-blue-700 transition-all w-full sm:w-auto text-center"
          >
            שיעור חדש
          </button>
          <div className="flex items-center bg-slate-50 p-1.5 rounded-2xl border border-slate-100 w-full sm:w-auto">
            <button onClick={() => navigate(-1)} className="px-3 py-2 hover:bg-white rounded-xl transition-all text-slate-400">←</button>
            <button onClick={() => setCurrentDate(new Date())} className="px-6 py-2 text-slate-700 font-bold text-sm rounded-xl">היום</button>
            <button onClick={() => navigate(1)} className="px-3 py-2 hover:bg-white rounded-xl transition-all text-slate-400">→</button>
          </div>
          <div className="hidden lg:block h-8 w-px bg-slate-100 mx-2"></div>
          <div className="text-lg font-black text-slate-800 shrink-0">
            {currentMonthDisplay}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:flex-1 lg:max-w-xl">
          <div className="relative w-full">
            <input 
              type="text" 
              placeholder="חפש תלמיד..."
              className="w-full pr-12 pl-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:bg-white outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <select 
            className="w-full sm:w-40 px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
          >
            <option value="agenda">כל השיעורים</option>
            <option value="recurring">שיעורים מחזוריים</option>
            <option value="day">יום</option>
            <option value="week">שבוע</option>
          </select>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-[32px] border border-slate-200 shadow-sm flex flex-col w-full overflow-hidden">
        {(viewMode === 'agenda' || viewMode === 'recurring') ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {weekDates.map((date, dayIdx) => {
              const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const dayItems = calendarItems.filter(item => itemDate(item) === dateStr);
              const dayLessons = dayItems.filter((it): it is CalendarItem & { kind: 'lesson' } => it.kind === 'lesson').map(it => it.meta.lesson);
              const dayOpenSlots = dayItems.filter((it): it is CalendarItem & { kind: 'open_slot' } => it.kind === 'open_slot');
              if (dayLessons.length === 0 && dayOpenSlots.length === 0) return null;
              return (
                <div key={dayIdx} className="space-y-3">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-2 px-2">
                    {DAYS_HEBREW[date.getDay()]}, {date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                  </h3>
                  {dayLessons.map(lesson => (
                    <button
                      key={lesson.id}
                      onClick={() => { 
                        setSelectedLesson(lesson);
                        const student = students.find(s => s.id === lesson.studentId);
                        setSelectedStudent(student || null);
                        setEditState({ ...lesson, studentIds: lesson.studentIds || [lesson.studentId] }); 
                      }}
                      className={`w-full bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between text-right hover:border-blue-200 transition-all ${lesson.status === LessonStatus.CANCELLED ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center gap-6">
                         <div className="w-12 h-12 bg-slate-50 text-slate-900 rounded-xl flex items-center justify-center border border-slate-100">
                            <span className="text-xs font-bold">{lesson.startTime}</span>
                         </div>
                         <div className="text-right">
                            <div className="font-bold text-slate-900">{lesson.studentName}</div>
                            <div className="text-[10px] font-medium text-slate-400">{lesson.subject} • {lesson.duration} דק׳ • {
                              lesson.lessonType === 'private' ? 'פרטי' : 
                              lesson.lessonType === 'pair' ? 'זוגי' : 
                              lesson.lessonType === 'recurring' ? 'מחזורי' : 'קבוצתי'
                            }</div>
                         </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {overlapBadges.lessonIdsOverlappingSlot.has(lesson.id) && (
                          <span className={BADGE_OVERLAP_LESSON}>חופף לחלון</span>
                        )}
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold border ${
                          lesson.status === LessonStatus.COMPLETED ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                          lesson.status === LessonStatus.CANCELLED ? 'bg-slate-50 text-slate-400 border-slate-200' : 
                          'bg-blue-50 text-blue-600 border-blue-100'
                        }`}>
                          {lesson.status}
                        </span>
                      </div>
                    </button>
                  ))}
                  {dayOpenSlots.map(item => {
                    const s = item.meta.openSlot;
                    const start = new Date(s.startDateTime);
                    const end = new Date(s.endDateTime);
                    const timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}–${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedSlot(s)}
                        className={`w-full p-5 rounded-2xl flex items-center justify-between text-right group/slot ${OPEN_SLOT_CARD_CLASS} hover:border-slate-400 transition-all cursor-pointer`}
                      >
                        <div className="flex items-center gap-6">
                          <div className="w-12 h-12 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center border border-slate-200">
                            <span className="text-xs font-bold">{timeStr.slice(0, 5)}</span>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-slate-600">חלון פתוח</div>
                            <div className="text-[10px] font-medium text-slate-400">{timeStr}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {overlapBadges.slotIdsOverlappingLesson.has(s.id) && (
                            <span className={BADGE_OVERLAP_SLOT}>חופף</span>
                          )}
                          <span className={OPEN_SLOT_TAG_CLASS}>חלון פתוח</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex flex-col w-full overflow-x-auto overflow-y-hidden custom-scrollbar">
            <div className={`flex border-b border-slate-100 bg-slate-50/30 sticky top-0 z-20 shrink-0 ${viewMode === 'week' ? 'min-w-[800px] md:min-w-0' : 'min-w-full'}`}>
              <div className="w-16 md:w-20 border-l border-slate-100 shrink-0"></div>
              {(viewMode === 'day' ? [currentDate] : weekDates).map((date, idx) => (
                <div key={idx} className={`flex-1 py-4 text-center border-l border-slate-100 last:border-l-0 ${date.toDateString() === new Date().toDateString() ? 'bg-blue-50/30' : ''}`}>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{DAYS_HEBREW[date.getDay()]}</div>
                  <div className={`text-lg font-extrabold ${date.toDateString() === new Date().toDateString() ? 'text-blue-600' : 'text-slate-900'}`}>
                    {date.getDate()}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto relative custom-scrollbar">
              <div className={`flex ${viewMode === 'week' ? 'min-w-[800px] md:min-w-0' : 'min-w-full'}`}>
                <div className="w-16 md:w-20 bg-slate-50/10 sticky right-0 z-10 border-l border-slate-100 shrink-0">
                  {HOURS.map(hour => (
                    <div key={hour} className="h-24 text-[10px] text-slate-400 font-bold text-center pt-3 border-b border-slate-100/50">
                      {hour}:00
                    </div>
                  ))}
                </div>
                {(viewMode === 'day' ? [currentDate] : weekDates).map((date, dayIdx) => {
                  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                  const dayItems = calendarItems.filter(item => itemDate(item) === dateStr);
                  const dayOpenSlots = dayItems.filter((it): it is CalendarItem & { kind: 'open_slot' } => it.kind === 'open_slot');
                  const dayLessons = dayItems.filter((it): it is CalendarItem & { kind: 'lesson' } => it.kind === 'lesson');
                  return (
                  <div key={dayIdx} className="flex-1 border-l border-slate-100 last:border-l-0 relative min-h-[1344px]">
                    {HOURS.map(hour => (
                      <div 
                        key={hour} 
                        className="h-24 border-b border-slate-100/30 cursor-crosshair hover:bg-slate-50/50 transition-colors"
                        onClick={() => handleSlotClick(date, hour)}
                      ></div>
                    ))}
                    {dayOpenSlots.map(item => {
                      const s = item.meta.openSlot;
                      const startD = new Date(s.startDateTime);
                      const endD = new Date(s.endDateTime);
                      const topOffset = (startD.getHours() - 8) * 96 + (startD.getMinutes() / 60) * 96;
                      const height = Math.max(24, ((endD.getTime() - startD.getTime()) / 60000) * (96 / 60));
                      return (
                        <button
                          key={item.id}
                          type="button"
                          style={{ top: `${topOffset}px`, height: `${height}px` }}
                          className={`absolute left-2 right-2 rounded-xl flex flex-col justify-center items-center gap-0.5 z-[1] hover:border-slate-400 hover:bg-slate-100/80 transition-colors cursor-pointer ${OPEN_SLOT_CARD_CLASS}`}
                          title={`חלון פתוח ${s.startDateTime.slice(11, 16)}–${s.endDateTime.slice(11, 16)} — לחץ לפעולה`}
                          onClick={() => setSelectedSlot(s)}
                        >
                          {overlapBadges.slotIdsOverlappingLesson.has(s.id) && (
                            <span className={BADGE_OVERLAP_SLOT}>חופף</span>
                          )}
                          <span className={OPEN_SLOT_TAG_CLASS}>חלון פתוח</span>
                        </button>
                      );
                    })}
                    {dayLessons.map(item => {
                      const lesson = item.meta.lesson;
                      const hour = parseInt(lesson.startTime.split(':')[0]);
                      const mins = parseInt(lesson.startTime.split(':')[1]);
                      const topOffset = (hour - 8) * 96 + (mins / 60) * 96;
                      const height = (lesson.duration / 60) * 96;
                      const rawRecord = rawRecords.get(lesson.id);
                      return (
                          <button
                            key={lesson.id}
                            onClick={() => { 
                              setSelectedLesson(lesson);
                              setSelectedRecord(rawRecords.get(lesson.id) || null);
                              const student = students.find(s => s.id === lesson.studentId);
                              setSelectedStudent(student || null);
                              setEditState({ ...lesson, studentIds: lesson.studentIds || [lesson.studentId] }); 
                            }}
                            style={{ top: `${topOffset}px`, height: `${height}px` }}
                            className={`absolute left-1.5 right-1.5 rounded-2xl p-4 text-right border-r-4 shadow-sm border border-slate-200 flex flex-col justify-between overflow-hidden bg-white hover:z-10 transition-all z-[5] ${
                              lesson.lessonType === 'recurring' ? 'border-indigo-600' : 
                              lesson.lessonType === 'group' ? 'border-amber-600' : 'border-blue-600'
                            }`}
                            title={lesson.notes ? `${lesson.studentName} - ${lesson.notes}` : lesson.studentName}
                          >
                            <div className="flex items-start justify-between gap-1 min-w-0">
                              <div className="font-bold text-sm leading-tight text-slate-900 line-clamp-1 min-w-0">{lesson.studentName}</div>
                              {overlapBadges.lessonIdsOverlappingSlot.has(lesson.id) && (
                                <span className={BADGE_OVERLAP_LESSON + ' shrink-0'}>חופף לחלון</span>
                              )}
                            </div>
                            {lesson.notes && (
                              <div 
                                className="text-xs text-slate-600 mt-1 line-clamp-2 truncate"
                                title={lesson.notes}
                              >
                                {lesson.notes}
                              </div>
                            )}
                            <div className="hidden sm:flex items-center justify-between mt-2 pt-2 border-t border-slate-50 gap-1">
                               <div className="text-[10px] font-bold text-slate-400">{lesson.startTime}</div>
                               <div className="text-[10px] font-bold bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full">{lesson.subject}</div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                ); })}
              </div>
            </div>
          </div>
        )}
      </div>

      {(selectedLesson || isCreating) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px]" onClick={() => { 
            setSelectedLesson(null); 
            setIsCreating(false);
            setSelectedStudent(null);
            setConflicts([]);
            setPriceManuallyEdited(false);
          }}></div>
          <div className="relative w-full lg:w-[500px] bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-left duration-300">
            <div className="p-8 border-b border-slate-100 relative shrink-0">
               <button onClick={() => { 
                 setSelectedLesson(null); 
                 setIsCreating(false);
                 setSelectedStudent(null);
                 setConflicts([]);
                 setPriceManuallyEdited(false);
               }} className="absolute left-8 top-8 p-2 text-slate-300 hover:text-slate-900 transition-colors">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
               <h3 className="font-bold text-2xl text-slate-900 mt-6">{isCreating ? 'קביעת שיעור חדש' : 'פרטי שיעור'}</h3>
            </div>

            <div className="flex-1 p-8 space-y-8 overflow-y-auto custom-scrollbar">
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">סוג שיעור</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['private', 'pair', 'group', 'recurring'] as LessonType[]).map(type => (
                    <button 
                      key={type}
                      type="button"
                      onClick={() => setEditState(p => ({ ...p, lessonType: type, studentIds: type === 'private' ? (p.studentIds?.slice(0, 1)) : p.studentIds }))}
                      className={`py-2 text-[10px] font-bold border rounded-xl transition-all ${
                        editState.lessonType === type ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {type === 'private' ? 'פרטי' : type === 'pair' ? 'זוגי' : type === 'group' ? 'קבוצתי' : 'מחזורי'}
                    </button>
                  ))}
                </div>
              </div>

              {editState.lessonType === 'recurring' && (
                <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl space-y-4">
                  <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">הגדרות מחזוריות</div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">סוג שיעור במחזור</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['private', 'pair', 'group'].map(t => (
                        <button 
                          key={t}
                          type="button"
                          onClick={() => setEditState(p => ({ ...p, isPrivate: t === 'private' }))}
                          className={`py-2 text-[10px] font-bold border rounded-xl transition-all ${
                            (t === 'private' && editState.isPrivate) || (t !== 'private' && !editState.isPrivate) ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-100 text-slate-400'
                          }`}
                        >
                          {t === 'private' ? 'פרטי' : t === 'pair' ? 'זוגי' : 'קבוצתי'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">תאריך סיום (עד...)</label>
                    <input 
                      type="date" 
                      className="w-full bg-white border border-slate-200 rounded-xl p-3 font-bold outline-none" 
                      value={editState.endDate || ''} 
                      onChange={(e) => setEditState(p => ({ ...p, endDate: e.target.value }))} 
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {editState.lessonType === 'private' ? 'תלמיד' : 'תלמידים (בחירה מרובה)'}
                </label>
                {editState.lessonType === 'private' ? (
                  <StudentPicker
                    value={selectedStudent}
                    onChange={(student) => {
                      setSelectedStudent(student);
                      setEditState(prev => ({
                        ...prev,
                        studentId: student?.id,
                        studentIds: student ? [student.id] : [],
                        studentName: student?.name
                      }));
                    }}
                    placeholder="חפש תלמיד לפי שם או טלפון..."
                    disabled={isSaving}
                    filterActiveOnly={true}
                  />
                ) : (
                  <StudentsPicker
                    values={editState.studentIds || []}
                    onChange={(studentIds) => {
                      setEditState(prev => ({
                        ...prev,
                        studentIds,
                        studentId: studentIds[0] || undefined,
                        studentName: studentIds.length === 1 ? students.find(s => s.id === studentIds[0])?.name : undefined
                      }));
                    }}
                    placeholder="חפש תלמידים לפי שם או טלפון..."
                    disabled={isSaving}
                    filterActiveOnly={true}
                  />
                )}
              </div>

              {/* Conflict Warning */}
              {isCreating && conflicts.length > 0 && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                  <div className="flex items-start gap-3">
                    <span className="text-rose-600 text-xl">⚠️</span>
                    <div className="flex-1">
                      <div className="text-sm font-black text-rose-800 mb-2">
                        שיעור זה חופף עם שיעור קיים
                      </div>
                      <div className="space-y-1">
                        {conflicts.map(conflict => (
                          <div key={conflict.id} className="text-xs font-bold text-rose-700">
                            • {conflict.studentName} - {conflict.date} {conflict.startTime}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Conflict Check Loading */}
              {isCreating && isCheckingConflicts && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-center">
                  <div className="text-xs font-bold text-blue-600">בודק התנגשויות...</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{editState.lessonType === 'recurring' ? 'תאריך התחלה' : 'תאריך'}</label>
                  <input type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" value={editState.date || ''} onChange={(e) => setEditState(p => ({ ...p, date: e.target.value }))} />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שעת התחלה</label>
                  <input type="time" step="900" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" value={editState.startTime || ''} onChange={(e) => setEditState(p => ({ ...p, startTime: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">משך (דקות)</label>
                  <input 
                    type="number" 
                    min="1" 
                    step="1"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" 
                    value={editState.duration || 60} 
                    onChange={(e) => {
                      const newDuration = parseInt(e.target.value) || 60;
                      setEditState(p => {
                        // אם זה שיעור פרטי, עדכן גם את המחיר אוטומטית
                        const newState = { ...p, duration: newDuration };
                        if ((p.lessonType === 'private' || p.isPrivate) && p.price === undefined) {
                          newState.price = Math.round(newDuration * 2.92 * 100) / 100;
                        }
                        return newState;
                      });
                    }}
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">מקצוע</label>
                  <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" value={editState.subject || ''} onChange={(e) => setEditState(p => ({ ...p, subject: e.target.value }))} />
                </div>
              </div>

              {editState.lessonType === 'private' && (
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    מחיר שיעור (₪)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                      value={editState.price !== undefined ? editState.price.toFixed(2) : (editState.duration ? (editState.duration * 2.92).toFixed(2) : '0.00')}
                      onChange={(e) => {
                        const newPrice = parseFloat(e.target.value) || 0;
                        setEditState(p => ({ ...p, price: newPrice }));
                        setPriceManuallyEdited(true);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const calculatedPrice = Math.round((editState.duration || 60) * 2.92 * 100) / 100;
                        setEditState(p => ({ ...p, price: calculatedPrice }));
                        setPriceManuallyEdited(false);
                      }}
                      className="px-4 py-4 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs hover:bg-blue-100 transition-all"
                      title="חשב אוטומטית"
                    >
                      ↻
                    </button>
                  </div>
                  <div className="text-xs text-slate-400">
                    מחיר לדקה: 2.92 ₪ • מחיר מחושב: {Math.round((editState.duration || 60) * 2.92 * 100) / 100} ₪
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">הערות לשיעור</label>
                <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-medium min-h-[120px] outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" placeholder="הערות..." value={editState.notes || ''} onChange={(e) => setEditState(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex flex-col gap-3 shrink-0">
              <button 
                disabled={isSaving || isCheckingConflictsApi || (isCreating && !selectedStudent)} 
                onClick={handleSave} 
                className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                  isSaving || isCheckingConflictsApi || (isCreating && !selectedStudent)
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isCheckingConflictsApi ? 'בודק...' : isSaving ? 'מעבד...' : (isCreating ? 'צור שיעור' : 'שמור שינויים')}
              </button>
              {!isCreating && (
                <button disabled={isSaving} onClick={handleCancel} className="w-full py-4 text-rose-600 font-bold hover:bg-rose-50 rounded-2xl transition-all">בטל שיעור</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lesson Details Modal */}
      {selectedRecord && (
        <LessonDetailsModal
          record={selectedRecord}
          onClose={() => {
            setSelectedRecord(null);
            setSelectedLesson(null);
          }}
          onEdit={() => {
            // Close modal and open edit form
            setSelectedRecord(null);
            setEditState({ ...selectedLesson, studentIds: selectedLesson?.studentIds || [selectedLesson?.studentId || ''] });
          }}
        />
      )}

      {/* Non-blocking overlap confirmation when saving over open slots */}
      <SlotOverlapModal
        isOpen={showSlotOverlapModal}
        overlappingSlots={overlappingSlotsForModal}
        onAction={handleOverlapAction}
        onCancel={() => {
          setShowSlotOverlapModal(false);
          setOverlappingSlotsForModal([]);
        }}
        isLoading={isOverlapActionLoading}
      />

      {/* Non-blocking lesson overlap warning (API: lessons + slot_inventory) */}
      <LessonOverlapWarningModal
        isOpen={showLessonOverlapModal}
        conflicts={lessonOverlapConflicts}
        onContinue={handleLessonOverlapContinue}
        onBack={() => {
          setShowLessonOverlapModal(false);
          setLessonOverlapConflicts([]);
        }}
        isLoading={isSaving}
      />

      {/* Edit open slot (slot_inventory) — overlap warning via checkConflicts (lessons + slot_inventory) */}
      {editingSlot && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setEditingSlot(null); setSlotEditForm({ date: '', startTime: '', endTime: '' }); setShowSlotEditOverlapModal(false); setSlotEditOverlapConflicts([]); }} />
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900">עריכת חלון פתוח</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">תאריך</label>
                <input
                  type="date"
                  value={slotEditForm.date}
                  onChange={(e) => setSlotEditForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-bold outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שעת התחלה</label>
                <input
                  type="time"
                  step="900"
                  value={slotEditForm.startTime}
                  onChange={(e) => setSlotEditForm((f) => ({ ...f, startTime: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-bold outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שעת סיום</label>
                <input
                  type="time"
                  step="900"
                  value={slotEditForm.endTime}
                  onChange={(e) => setSlotEditForm((f) => ({ ...f, endTime: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-bold outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleSlotEditSave}
                disabled={isSavingSlotEdit || isCheckingSlotConflictsApi || !slotEditForm.date || !slotEditForm.startTime || !slotEditForm.endTime}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckingSlotConflictsApi ? 'בודק...' : isSavingSlotEdit ? 'שומר...' : 'שמור'}
              </button>
              <button
                type="button"
                onClick={() => { setEditingSlot(null); setSlotEditForm({ date: '', startTime: '', endTime: '' }); setShowSlotEditOverlapModal(false); setSlotEditOverlapConflicts([]); }}
                disabled={isSavingSlotEdit || isCheckingSlotConflictsApi}
                className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold disabled:opacity-50"
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
        isLoading={isSavingSlotEdit}
      />

      {/* Slot Inventory Modal - for reserving or booking lessons from open slots */}
      {selectedSlot && (
        <SlotInventoryModal
          slot={selectedSlot}
          onClose={() => setSelectedSlot(null)}
          onSuccess={async () => {
            await refreshCalendarData();
          }}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default Calendar;
