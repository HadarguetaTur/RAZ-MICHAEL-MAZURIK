
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Lesson, LessonStatus, Teacher, Student, LessonType, SlotInventory, WeeklySlot } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import { updateLesson } from '../data/mutations';
import { getLessons } from '../data/resources/lessons';
import { getSlotInventory } from '../data/resources/slotInventory';
import LessonDetailsModal from './LessonDetailsModal';
import SlotInventoryModal from './SlotInventoryModal';
import StudentPicker from './StudentPicker';
import StudentsPicker from './StudentsPicker';
import LessonOverlapWarningModal from './ui/LessonOverlapWarningModal';
import CancelLessonModal from './ui/CancelLessonModal';
import type { ConflictItem, CheckConflictsResult } from '../services/conflictsCheckService';
import { buildConflictSummary } from '../services/conflictsCheckService';
import { useOpenSlotModal } from '../hooks/useOpenSlotModal';
import { logConflictOverride } from '../services/eventLog';
import { isOverlapping } from '../utils/overlaps';
import { apiUrl } from '../config/api';
import { useToast } from '../hooks/useToast';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useWeeklySlots } from '../data/hooks/useWeeklySlots';
import { invalidateWeeklySlots } from '../data/resources/weeklySlots';
import { sendTeacherCancelNotification, normalizePhoneNumber, triggerCancelLessonScenario } from '../services/makeApi';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 08:00 to 21:00
const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * Helper: Determine if an open slot card should be rendered
 * Returns false if:
 * - Status is not "open" (e.g., "closed", "סגור", "blocked")
 * - Slot has linked lessons (lessons array not empty)
 * - A lesson exists for the same slot_inventory id (by date, time, teacher)
 */
function shouldRenderOpenSlot(
  slot: SlotInventory,
  allLessons: Lesson[]
): boolean {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:shouldRenderOpenSlot:entry',message:'shouldRenderOpenSlot called',data:{slotId:slot.id,slotStatus:slot.status,slotLessons:slot.lessons,slotLessonsType:typeof slot.lessons,slotLessonsIsArray:Array.isArray(slot.lessons),slotLessonsLength:slot.lessons?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  // Guard 1: Status must be "open" (strict check)
  if (slot.status !== 'open') {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:shouldRenderOpenSlot:guard1',message:'Slot filtered out - status not open',data:{slotId:slot.id,slotStatus:slot.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    if (import.meta.env.DEV) {
      console.log(`[shouldRenderOpenSlot] Slot ${slot.id} filtered out - status is "${slot.status}", not "open"`);
    }
    return false;
  }
  
  // Guard 2: Check if slot has linked lessons (direct check from slot_inventory.lessons field)
  if (slot.lessons && slot.lessons.length > 0) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:shouldRenderOpenSlot:guard2',message:'Slot filtered out - has linked lessons',data:{slotId:slot.id,slotLessons:slot.lessons,slotLessonsLength:slot.lessons.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    if (import.meta.env.DEV) {
      console.log(`[shouldRenderOpenSlot] Slot ${slot.id} filtered out - has ${slot.lessons.length} linked lesson(s):`, slot.lessons);
    }
    return false;
  }
  
  // Guard 3: Check if any lesson matches this slot (by date, time, teacher)
  // This handles cases where lessons exist but aren't linked to slot_inventory yet
  // Normalize dates and times for comparison
  const slotDateNormalized = slot.date.trim();
  const slotTimeNormalized = slot.startTime.trim().padStart(5, '0'); // Ensure HH:mm format
  
  const hasMatchingLesson = allLessons.some(lesson => {
    // Ignore cancelled lessons – they should not block showing the reopened slot
    if (lesson.status === LessonStatus.CANCELLED || lesson.status === LessonStatus.PENDING_CANCEL) {
      return false;
    }
    const lessonDateNormalized = lesson.date.trim();
    const lessonTimeNormalized = lesson.startTime.trim().padStart(5, '0');
    
    // Match by date, time, and teacher
    const dateMatches = lessonDateNormalized === slotDateNormalized;
    const timeMatches = lessonTimeNormalized === slotTimeNormalized;
    const teacherMatches = lesson.teacherId === slot.teacherId;
    
    if (dateMatches && timeMatches && teacherMatches) {
      if (import.meta.env.DEV) {
        console.log(`[shouldRenderOpenSlot] Slot ${slot.id} matches lesson ${lesson.id}:`, {
          slotDate: slotDateNormalized,
          slotTime: slotTimeNormalized,
          lessonDate: lessonDateNormalized,
          lessonTime: lessonTimeNormalized,
          teacherMatch: teacherMatches,
        });
      }
      return true;
    }
    
    return false;
  });
  
  if (hasMatchingLesson) {
    if (import.meta.env.DEV) {
      console.log(`[shouldRenderOpenSlot] Suppressing slot ${slot.id} - has matching lesson`);
    }
    return false;
  }
  
  return true;
}

const Calendar: React.FC = () => {
  const toast = useToast();
  const { confirm } = useConfirmDialog();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'day' | 'agenda' | 'recurring'>(window.innerWidth < 768 ? 'agenda' : 'week');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [openSlots, setOpenSlots] = useState<SlotInventory[]>([]);
  const [rawRecords, setRawRecords] = useState<Map<string, any>>(new Map()); // Store raw Airtable records
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<any>(null); // Raw Airtable record for modal
  const [isCreating, setIsCreating] = useState(false);
  const [isOpeningWeek, setIsOpeningWeek] = useState(false);
  const [openWeekMessage, setOpenWeekMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  type RecurringLessonType = 'private' | 'pair' | 'group';
  const [editState, setEditState] = useState<Partial<Lesson & { endDate?: string; recurringLessonType?: RecurringLessonType }>>({ studentIds: [], lessonType: 'private' });
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [conflicts, setConflicts] = useState<Lesson[]>([]);
  const [clickedSlot, setClickedSlot] = useState<SlotInventory | null>(null);
  const slotModal = useOpenSlotModal();
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const conflictCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [priceInputValue, setPriceInputValue] = useState<string>('');
  const [overlapConflicts, setOverlapConflicts] = useState<ConflictItem[]>([]);
  const [showOverlapModal, setShowOverlapModal] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<(() => Promise<void>) | null>(null);
  const [realtimeOverlapWarning, setRealtimeOverlapWarning] = useState<{
    hasOverlap: boolean;
    conflicts: Array<{ type: 'lesson' | 'slot'; label: string; time: string }>;
  } | null>(null);
  
  // Cancel lesson modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelModalLesson, setCancelModalLesson] = useState<Lesson | null>(null);

  const { data: weeklySlots } = useWeeklySlots();
  const fixedWeeklySlots = useMemo(() => weeklySlots.filter(s => s.isFixed), [weeklySlots]);

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

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [lessonsData, inventoryData, teachersData, studentsData] = await Promise.all([
          getLessons({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }),
          getSlotInventory({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }),
          nexusApi.getTeachers(),
          nexusApi.getStudents()
        ]);
        setLessons(lessonsData);
        // Show only OPEN slots in calendar (exclude slots with linked lessons)
        const filteredOpenSlots = inventoryData.filter(slot => shouldRenderOpenSlot(slot, lessonsData));
        setOpenSlots(filteredOpenSlots);
        
        if (import.meta.env.DEV) {
          console.log(`[Calendar] Loaded data:`, {
            lessonsCount: lessonsData.length,
            inventoryCount: inventoryData.length,
            openSlotsCount: filteredOpenSlots.length,
            filteredOut: inventoryData.length - filteredOpenSlots.length,
          });
        }
        
        // Note: rawRecords not available when using resources (only from direct nexusApi calls)
        // This is fine as rawRecords are mainly used for detailed lesson info
        setTeachers(teachersData);
        setStudents(studentsData);
      } catch (err: any) {
        console.error(parseApiError(err));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [startDate, endDateStr]);

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

  // Memoized overlap detection: check if a lesson overlaps with any open slot
  // Logic: filter by teacherId only if both have teacherId; otherwise check all slots for same date
  const lessonOverlapsSlot = useMemo(() => {
    const overlapMap = new Map<string, boolean>();
    
    filteredLessons.forEach(lesson => {
      if (!lesson.date || !lesson.startTime || !lesson.duration) {
        return;
      }
      
      const key = `${lesson.id}`;
      const lessonStartISO = new Date(`${lesson.date}T${lesson.startTime}:00`).toISOString();
      const lessonEndISO = new Date(new Date(lessonStartISO).getTime() + lesson.duration * 60 * 1000).toISOString();
      
      const hasOverlap = openSlots.some(slot => {
        // Must be open slot
        if (slot.status !== 'open') {
          return false;
        }
        
        // Must be same date
        if (slot.date !== lesson.date) {
          return false;
        }
        
        // Filter by teacherId only if both have teacherId (same logic as overlapDetection.ts)
        if (
          lesson.teacherId != null &&
          lesson.teacherId !== '' &&
          slot.teacherId != null &&
          slot.teacherId !== '' &&
          slot.teacherId !== lesson.teacherId
        ) {
          return false;
        }
        
        const slotStartISO = new Date(`${slot.date}T${slot.startTime}:00`).toISOString();
        const slotEndISO = new Date(`${slot.date}T${slot.endTime}:00`).toISOString();
        
        return isOverlapping(lessonStartISO, lessonEndISO, slotStartISO, slotEndISO);
      });
      
      overlapMap.set(key, hasOverlap);
    });
    
    return overlapMap;
  }, [filteredLessons, openSlots]);

  // Memoized overlap detection: check if a slot overlaps with any lesson
  // Logic: filter by teacherId only if both have teacherId; otherwise check all lessons for same date
  const slotOverlapsLesson = useMemo(() => {
    const overlapMap = new Map<string, boolean>();
    
    openSlots.forEach(slot => {
      if (slot.status !== 'open' || !slot.date || !slot.startTime || !slot.endTime) {
        return;
      }
      
      const key = `${slot.id}`;
      const slotStartISO = new Date(`${slot.date}T${slot.startTime}:00`).toISOString();
      const slotEndISO = new Date(`${slot.date}T${slot.endTime}:00`).toISOString();
      
      const hasOverlap = filteredLessons.some(lesson => {
        // Exclude cancelled lessons
        if (lesson.status === LessonStatus.CANCELLED || lesson.status === LessonStatus.PENDING_CANCEL) {
          return false;
        }
        
        // Must be same date
        if (lesson.date !== slot.date) {
          return false;
        }
        
        // Filter by teacherId only if both have teacherId (same logic as overlapDetection.ts)
        if (
          slot.teacherId != null &&
          slot.teacherId !== '' &&
          lesson.teacherId != null &&
          lesson.teacherId !== '' &&
          lesson.teacherId !== slot.teacherId
        ) {
          return false;
        }
        
        const lessonStartISO = new Date(`${lesson.date}T${lesson.startTime}:00`).toISOString();
        const lessonEndISO = new Date(new Date(lessonStartISO).getTime() + (lesson.duration || 60) * 60 * 1000).toISOString();
        
        return isOverlapping(slotStartISO, slotEndISO, lessonStartISO, lessonEndISO);
      });
      
      overlapMap.set(key, hasOverlap);
    });
    
    return overlapMap;
  }, [openSlots, filteredLessons]);

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
      console.error('Conflict check error:', err);
      setConflicts([]);
    } finally {
      setIsCheckingConflicts(false);
    }
  }, []);

  // Debounced conflict check for lessons
  useEffect(() => {
    if (conflictCheckTimeoutRef.current) {
      clearTimeout(conflictCheckTimeoutRef.current);
    }

    if (isCreating && editState.date && editState.startTime && editState.duration) {
      conflictCheckTimeoutRef.current = setTimeout(() => {
        // For pair/group lessons, check conflicts for the first student
        // (conflict check API currently supports single student)
        const recurringPrivate = editState.lessonType === 'recurring' && (editState.recurringLessonType ?? 'private') === 'private';
        const studentIdToCheck = editState.lessonType === 'private' || recurringPrivate
          ? (selectedStudent?.id || editState.studentId)
          : (editState.studentIds?.[0] || editState.studentId);
        
        checkConflicts(
          editState.date!,
          editState.startTime!,
          editState.duration || 60,
          studentIdToCheck,
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
  }, [editState.date, editState.startTime, editState.duration, editState.lessonType, editState.recurringLessonType, selectedStudent, editState.studentIds, editState.studentId, editState.teacherId, isCreating, selectedLesson, checkConflicts]);

  // Real-time overlap detection for both lessons and slots (client-side, debounced)
  // Shows warning in the form before save
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      // Only check if form is open and has required fields
      if (!(isCreating || selectedLesson) || !editState.date || !editState.startTime || !editState.duration) {
        setRealtimeOverlapWarning(null);
        return;
      }

      const proposedStartISO = new Date(`${editState.date}T${editState.startTime}:00`).toISOString();
      const proposedEndISO = new Date(new Date(proposedStartISO).getTime() + (editState.duration || 60) * 60 * 1000).toISOString();
      
      const conflicts: Array<{ type: 'lesson' | 'slot'; label: string; time: string }> = [];

      // Check overlapping lessons (exclude cancelled and current lesson)
      filteredLessons.forEach(lesson => {
        if (lesson.status === LessonStatus.CANCELLED || lesson.status === LessonStatus.PENDING_CANCEL) {
          return;
        }
        if (selectedLesson && lesson.id === selectedLesson.id) {
          return;
        }
        if (lesson.date !== editState.date) {
          return;
        }
        
        // Filter by teacherId only if both have teacherId
        if (
          editState.teacherId != null &&
          editState.teacherId !== '' &&
          lesson.teacherId != null &&
          lesson.teacherId !== '' &&
          lesson.teacherId !== editState.teacherId
        ) {
          return;
        }

        const existingLessonStartISO = new Date(`${lesson.date}T${lesson.startTime}:00`).toISOString();
        const existingLessonEndISO = new Date(new Date(existingLessonStartISO).getTime() + (lesson.duration || 60) * 60 * 1000).toISOString();
        
        if (isOverlapping(proposedStartISO, proposedEndISO, existingLessonStartISO, existingLessonEndISO)) {
          conflicts.push({
            type: 'lesson',
            label: lesson.studentName || 'שיעור',
            time: `${lesson.startTime} (${lesson.duration || 60} דק׳)`,
          });
        }
      });

      // Check overlapping open slots
      openSlots.forEach(slot => {
        if (slot.status !== 'open') {
          return;
        }
        if (slot.date !== editState.date) {
          return;
        }
        
        // Filter by teacherId only if both have teacherId
        if (
          editState.teacherId != null &&
          editState.teacherId !== '' &&
          slot.teacherId != null &&
          slot.teacherId !== '' &&
          slot.teacherId !== editState.teacherId
        ) {
          return;
        }

        const slotStartISO = new Date(`${slot.date}T${slot.startTime}:00`).toISOString();
        const slotEndISO = new Date(`${slot.date}T${slot.endTime}:00`).toISOString();
        
        if (isOverlapping(proposedStartISO, proposedEndISO, slotStartISO, slotEndISO)) {
          conflicts.push({
            type: 'slot',
            label: 'חלון פתוח',
            time: `${slot.startTime}–${slot.endTime}`,
          });
        }
      });

      if (conflicts.length > 0) {
        setRealtimeOverlapWarning({
          hasOverlap: true,
          conflicts,
        });
      } else {
        setRealtimeOverlapWarning(null);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [editState.date, editState.startTime, editState.duration, editState.teacherId, filteredLessons, openSlots, selectedLesson, isCreating]);

  // Auto-update price when duration or lessonType changes (only if not manually edited)
  const isPrivatePrice = editState.lessonType === 'private' || (editState.lessonType === 'recurring' && (editState.recurringLessonType ?? 'private') === 'private');
  const isPairPrice = editState.lessonType === 'pair' || (editState.lessonType === 'recurring' && editState.recurringLessonType === 'pair');
  useEffect(() => {
    if (isPrivatePrice && !priceManuallyEdited && editState.duration) {
      const calculatedPrice = Math.round(((editState.duration || 60) / 60) * 175 * 100) / 100;
      setEditState(p => ({ ...p, price: calculatedPrice }));
      setPriceInputValue(calculatedPrice.toFixed(2));
    }
    if (isPairPrice && !priceManuallyEdited) {
      setEditState(p => ({ ...p, price: 225 }));
      setPriceInputValue('225.00');
    }
  }, [editState.duration, editState.lessonType, editState.recurringLessonType, priceManuallyEdited, isPrivatePrice, isPairPrice]);

  // Reset priceManuallyEdited when lesson type changes or when creating new lesson
  useEffect(() => {
    const recurType = editState.recurringLessonType ?? 'private';
    const showPrice = editState.lessonType === 'private' || editState.lessonType === 'pair'
      || (editState.lessonType === 'recurring' && (recurType === 'private' || recurType === 'pair'));
    if (isCreating || !showPrice) {
      setPriceManuallyEdited(false);
    }
  }, [isCreating, editState.lessonType, editState.recurringLessonType]);

  // Initialize priceInputValue when editState.price changes externally (e.g., when editing existing lesson)
  useEffect(() => {
    const recurType = editState.recurringLessonType ?? 'private';
    const isPrivate = editState.lessonType === 'private' || (editState.lessonType === 'recurring' && recurType === 'private');
    const isPair = editState.lessonType === 'pair' || (editState.lessonType === 'recurring' && recurType === 'pair');
    if (isPrivate) {
      if (editState.price !== undefined) {
        setPriceInputValue(editState.price.toFixed(2));
      } else if (editState.duration) {
        const calculatedPrice = Math.round(((editState.duration / 60) * 175 * 100) / 100);
        setPriceInputValue(calculatedPrice.toFixed(2));
      } else {
        setPriceInputValue('175.00');
      }
    } else if (isPair) {
      // זוגי/מחזורי זוגי: ברירת מחדל 225; אם נשאר 175 מפרטי – להציג 225 עד שהאפקט יעדכן
      const pairPrice = editState.price === 175 ? 225 : editState.price;
      if (pairPrice !== undefined) {
        setPriceInputValue(pairPrice.toFixed(2));
      } else {
        setPriceInputValue('225.00');
      }
    } else if (editState.lessonType === 'group' || (editState.lessonType === 'recurring' && recurType === 'group')) {
      setPriceInputValue('');
    } else {
      setPriceInputValue('');
    }
  }, [editState.price, editState.duration, editState.lessonType, editState.recurringLessonType]);

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

  const refreshData = async (forceRefresh = false) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:refreshData:entry',message:'refreshData called',data:{startDate,endDateStr,forceRefresh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    try {
      if (import.meta.env.DEV) {
        console.log(`[Calendar.refreshData] Refreshing data for ${startDate} to ${endDateStr}${forceRefresh ? ' (forceRefresh=true)' : ''}`);
      }
      
      // If forceRefresh, invalidate cache before fetching
      if (forceRefresh) {
        const { invalidateLessons } = await import('../data/resources/lessons');
        const { invalidateSlotInventory } = await import('../data/resources/slotInventory');
        invalidateLessons({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` });
        invalidateSlotInventory({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` });
      }
      
      // Use resources that respect cache invalidation
      const [lessonsData, inventoryData] = await Promise.all([
        getLessons({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }),
        getSlotInventory({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }, undefined, forceRefresh),
      ]);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:refreshData:afterFetch',message:'getLessons returned',data:{lessonsCount:lessonsData.length,lessonIds:lessonsData.slice(-3).map(l=>({id:l.id,date:l.date,startTime:l.startTime})),startDate,endDateStr},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H7'})}).catch(()=>{});
      // #endregion
      setLessons(lessonsData);
      
      // Show only OPEN slots in calendar (exclude slots with linked lessons)
      // Filter aggressively: only show slots that are truly open AND have no matching lessons
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:refreshData:beforeFilter',message:'Before filtering slots',data:{inventoryDataCount:inventoryData.length,inventorySlots:inventoryData.map(s=>({id:s.id,status:s.status,lessons:s.lessons,lessonsLength:s.lessons?.length}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      const filteredOpenSlots = inventoryData.filter(slot => {
        const shouldRender = shouldRenderOpenSlot(slot, lessonsData);
        if (!shouldRender && import.meta.env.DEV) {
          // Log why slot was filtered out
          const matchingLesson = lessonsData.find(lesson => {
            const slotDateNormalized = slot.date.trim();
            const slotTimeNormalized = slot.startTime.trim().padStart(5, '0');
            const lessonDateNormalized = lesson.date.trim();
            const lessonTimeNormalized = lesson.startTime.trim().padStart(5, '0');
            return lessonDateNormalized === slotDateNormalized &&
                   lessonTimeNormalized === slotTimeNormalized &&
                   lesson.teacherId === slot.teacherId;
          });
          if (matchingLesson) {
            console.log(`[Calendar.refreshData] Filtered out slot ${slot.id} (${slot.date} ${slot.startTime}) - has matching lesson ${matchingLesson.id}`);
          }
        }
        return shouldRender;
      });
      const outByStatus = inventoryData.filter(s => s.status !== 'open').length;
      const outByLessons = inventoryData.filter(s => s.lessons && s.lessons.length > 0).length;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:refreshData:afterFilter',message:'After filtering slots',data:{filteredOpenSlotsCount:filteredOpenSlots.length,inventoryTotal:inventoryData.length,outByStatusNotOpen:outByStatus,outByHasLessons:outByLessons,filteredSlots:filteredOpenSlots.map(s=>({id:s.id,status:s.status,lessons:s.lessons}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:refreshData:setState',message:'refreshData about to setOpenSlots',data:{lessonsSet:lessonsData.length,openSlotsToSet:filteredOpenSlots.length,forceRefresh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H-cal-refresh'})}).catch(()=>{});
      // #endregion
      setOpenSlots(filteredOpenSlots);
      
      if (import.meta.env.DEV) {
        console.log(`[Calendar.refreshData] Refreshed data:`, {
          lessonsCount: lessonsData.length,
          inventoryCount: inventoryData.length,
          openSlotsCount: filteredOpenSlots.length,
          filteredOut: inventoryData.length - filteredOpenSlots.length,
          inventoryStatuses: inventoryData.map(s => ({ 
            id: s.id, 
            status: s.status,
            date: s.date,
            startTime: s.startTime,
            teacherId: s.teacherId,
          })),
          lessons: lessonsData.map(l => ({
            id: l.id,
            date: l.date,
            startTime: l.startTime,
            teacherId: l.teacherId,
            studentName: l.studentName,
          })),
        });
      }
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:refreshData:catch',message:'refreshData threw',data:{errorMessage:err instanceof Error ? err.message : String(err),forceRefresh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H-cal-refresh'})}).catch(()=>{});
      // #endregion
      console.error('Error refreshing calendar data:', err);
    }
  };

  // Check conflicts via API endpoint
  const checkConflictsViaAPI = async (
    teacherId: string | undefined,
    date: string,
    startTime: string,
    duration: number,
    recordId?: string
  ): Promise<CheckConflictsResult | null> => {
    if (!teacherId || !date || !startTime || !duration) {
      return null;
    }

    try {
      // Calculate end time
      const startTimeStr = startTime.length === 5 ? `${startTime}:00` : startTime;
      const startDate = new Date(`${date}T${startTimeStr}`);
      const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
      const endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;

      const response = await fetch(apiUrl('/api/conflicts/check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'lesson',
          recordId: recordId,
          teacherId: teacherId,
          date: date,
          start: startTime,
          end: endTime,
        }),
      });

      if (!response.ok) {
        console.error('[Calendar] Conflicts check failed:', response.status, response.statusText);
        return null;
      }

      const result: CheckConflictsResult = await response.json();
      return result;
    } catch (err) {
      console.error('[Calendar] Conflicts check error:', err);
      return null;
    }
  };

  const performSave = async () => {
    const studentId = selectedStudent?.id || editState.studentId || editState.studentIds?.[0];
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:performSave:entry',message:'performSave called',data:{studentId,isCreating,selectedLessonId:selectedLesson?.id,editState:{date:editState.date,startTime:editState.startTime,duration:editState.duration}},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    setIsSaving(true);
    try {
      if (selectedLesson) {
        // Update existing lesson
        const updateData: Partial<Lesson> = {
          ...editState,
          studentId: studentId,
          studentName: editState.lessonType === 'private' || (editState.lessonType === 'recurring' && (editState.recurringLessonType ?? 'private') === 'private')
            ? (selectedStudent?.name || editState.studentName)
            : (editState.studentIds && editState.studentIds.length === 1 
                ? students.find(s => s.id === editState.studentIds?.[0])?.name 
                : undefined)
        };
        
        // Include studentIds for pair/group lessons
        if (editState.lessonType !== 'private' && editState.lessonType !== 'recurring') {
          updateData.studentIds = editState.studentIds;
        } else if (editState.lessonType === 'recurring' && (editState.recurringLessonType ?? 'private') !== 'private') {
          updateData.studentIds = editState.studentIds;
        }
        
        const updated = await updateLesson(selectedLesson.id, updateData);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:performSave:afterUpdate',message:'After updateLesson, about to refreshData(false)',data:{lessonId:selectedLesson.id,forceRefresh:false},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H-cal-update'})}).catch(()=>{});
        // #endregion
        // Refresh both lessons and slots (slots may have been auto-closed)
        await refreshData(true);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:performSave:afterRefreshEdit',message:'refreshData() completed after edit',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H-cal-update'})}).catch(()=>{});
        // #endregion
        setSelectedLesson(null);
        setIsCreating(false);
      } else {
        if (editState.lessonType === 'recurring') {
          // Create recurring: weekly_slot template + lesson(s) for target date
          const recurType = editState.recurringLessonType ?? 'private';
          const duration = editState.duration || 60;
          const startTime = editState.startTime!;
          const [startH, startM] = startTime.split(':').map(Number);
          const totalM = startH * 60 + startM + duration;
          const endH = Math.floor(totalM / 60) % 24;
          const endMin = totalM % 60;
          const endTime = `${String(endH).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
          const dayOfWeek = new Date(editState.date!).getDay();
          const reservedForIds = (recurType === 'private'
            ? (studentId ? [studentId] : [])
            : (editState.studentIds || [])
          ).filter((id): id is string => Boolean(id));
          if (!editState.teacherId || reservedForIds.length === 0) {
            throw new Error('חסר מורה או תלמידים לשיעור מחזורי');
          }
          await nexusApi.reserveRecurringLesson({
            teacherId: editState.teacherId,
            dayOfWeek,
            startTime,
            endTime,
            type: recurType,
            reservedForIds,
            durationMin: duration,
            targetDate: new Date(editState.date!),
          });
          invalidateWeeklySlots();
          await refreshWeeklySlots();
          await refreshData(true);
          toast.success('שיעור מחזורי נקבע בהצלחה');
        } else {
          // Create new lesson (non-recurring) with server-side validation
          const newLesson = await nexusApi.createLesson({
            studentId: studentId,
            studentIds: editState.lessonType === 'private' ? undefined : editState.studentIds,
            date: editState.date!,
            startTime: editState.startTime!,
            duration: editState.duration || 60,
            status: LessonStatus.SCHEDULED,
            subject: editState.subject || 'מתמטיקה',
            teacherId: editState.teacherId,
            notes: editState.notes || '',
            isPrivate: editState.lessonType === 'private',
            lessonType: editState.lessonType || 'private',
            price: editState.lessonType === 'private' ? (editState.price !== undefined ? editState.price : Math.round(((editState.duration || 60) / 60) * 175 * 100) / 100) : (editState.lessonType === 'pair' ? (editState.price ?? 225) : undefined),
          });
          await refreshData(true);
        }
      }
      setSelectedLesson(null);
      setSelectedStudent(null);
      setIsCreating(false);
      setConflicts([]);
      setPriceManuallyEdited(false);
      setShowOverlapModal(false);
      setOverlapConflicts([]);
      setPendingSaveAction(null);
    } catch (err: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:performSave:catch',message:'performSave error caught',data:{errorMessage:err?.message,errorCode:err?.code,errorStatus:err?.status,errorDetails:err?.details},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
      if (err.code === 'CONFLICT_ERROR' || err.status === 409) {
        // Handle conflicts structure: { lessons: Lesson[], openSlots: SlotInventory[] }
        const conflicts = err.conflicts || {};
        const lessonConflicts = conflicts.lessons || (Array.isArray(conflicts) ? conflicts : []);
        const openSlotConflicts = conflicts.openSlots || [];
        
        let conflictDetails = '';
        
        // Format lesson conflicts
        if (lessonConflicts.length > 0) {
          const lessonDetails = lessonConflicts.map((c: Lesson) => 
            `• ${c.studentName || 'ללא שם'} - ${c.date} ${c.startTime} (${c.duration || 60} דקות)`
          ).join('\n');
          conflictDetails += `שיעורים חופפים:\n${lessonDetails}\n\n`;
        }
        
        // Format open slot conflicts
        if (openSlotConflicts.length > 0) {
          const slotDetails = openSlotConflicts.map((s: SlotInventory) => 
            `• חלון פתוח - ${s.date} ${s.startTime}-${s.endTime}${s.teacherName ? ` (${s.teacherName})` : ''}`
          ).join('\n');
          conflictDetails += `חלונות פתוחים חופפים:\n${slotDetails}\n\n`;
        }
        
        toast.error(`לא ניתן לקבוע שיעורים חופפים - ${err.message || 'שיעור זה חופף עם שיעור קיים או חלון פתוח'}`);
      } else {
        toast.error(parseApiError(err));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:handleSave:entry',message:'handleSave called',data:{isSaving,isCheckingConflicts,isCreating,hasSelectedStudent:!!selectedStudent,selectedStudentId:selectedStudent?.id,editStateDate:editState.date,editStateStartTime:editState.startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    // Prevent double-submit
    if (isSaving || isCheckingConflicts) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:handleSave:blocked',message:'handleSave blocked by isSaving/isCheckingConflicts',data:{isSaving,isCheckingConflicts},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      return;
    }

    // Validate student selection based on lesson type
    if (isCreating) {
      if (editState.lessonType === 'private') {
        if (!selectedStudent) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:handleSave:noStudent',message:'No student selected for private lesson',data:{isCreating,lessonType:editState.lessonType},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
          // #endregion
          toast.error('נא לבחור תלמיד');
          return;
        }
      } else if (editState.lessonType === 'pair') {
        if (!editState.studentIds || editState.studentIds.length !== 2) {
          toast.error('שיעור זוגי דורש בדיוק 2 תלמידים');
          return;
        }
      } else if (editState.lessonType === 'group') {
        if (!editState.studentIds || editState.studentIds.length < 2) {
          toast.error('שיעור קבוצתי דורש לפחות 2 תלמידים');
          return;
        }
      } else if (editState.lessonType === 'recurring') {
        const recurType = editState.recurringLessonType ?? (editState.isPrivate !== false ? 'private' : 'pair');
        if (recurType === 'private') {
          if (!selectedStudent) {
            toast.error('נא לבחור תלמיד');
            return;
          }
        } else if (recurType === 'pair') {
          if (!editState.studentIds || editState.studentIds.length !== 2) {
            toast.error('שיעור מחזורי זוגי דורש בדיוק 2 תלמידים');
            return;
          }
        } else {
          if (!editState.studentIds || editState.studentIds.length < 2) {
            toast.error('שיעור מחזורי קבוצתי דורש לפחות 2 תלמידים');
            return;
          }
        }
      }
    }

    // Extract studentId based on lesson type
    const studentId = editState.lessonType === 'private' || (editState.lessonType === 'recurring' && (editState.recurringLessonType ?? (editState.isPrivate !== false ? 'private' : 'pair')) === 'private')
      ? (selectedStudent?.id || editState.studentId)
      : (editState.studentIds?.[0] || editState.studentId);
    
    // Validate studentId is a valid Airtable record ID (must start with "rec")
    if (!studentId || typeof studentId !== 'string' || !studentId.startsWith('rec')) {
      toast.error('שגיאה: יש לבחור תלמיד מהרשימה. נא לנסות שוב.');
      console.error('[Calendar] Invalid studentId:', studentId, 'selectedStudent:', selectedStudent);
      return;
    }
    
    if (!editState.date || !editState.startTime) {
      toast.error('נא למלא את כל שדות החובה ולבחור תלמיד');
      return;
    }
    
    if (editState.lessonType === 'recurring' && !editState.endDate) {
      toast.error('נא להזין תאריך סיום לשיעור מחזורי');
      return;
    }

    // Check for conflicts (server-side validation will also happen)
    if (conflicts.length > 0) {
      toast.error(`לא ניתן לקבוע שיעורים חופפים - שיעור זה חופף עם ${conflicts.length} שיעור${conflicts.length > 1 ? 'ים' : ''} קיים${conflicts.length > 1 ? 'ים' : ''}`);
      return;
    }

    // Check conflicts via API endpoint before saving
    setIsCheckingConflicts(true);
    try {
      const conflictsResult = await checkConflictsViaAPI(
        editState.teacherId,
        editState.date,
        editState.startTime,
        editState.duration || 60,
        selectedLesson?.id
      );

      if (conflictsResult && conflictsResult.hasConflicts && conflictsResult.conflicts.length > 0) {
        // Show overlap warning modal
        setOverlapConflicts(conflictsResult.conflicts);
        setPendingSaveAction(() => performSave);
        setShowOverlapModal(true);
        setIsCheckingConflicts(false);
        return;
      }
    } catch (err) {
      console.error('[Calendar] Failed to check conflicts:', err);
      // Continue with save if conflict check fails (non-blocking)
    } finally {
      setIsCheckingConflicts(false);
    }

    // No conflicts or check failed - proceed with save
    await performSave();
  };

  const handleOverlapContinue = async () => {
    if (pendingSaveAction) {
      // Log conflict override event
      const conflictSummary = buildConflictSummary(overlapConflicts);
      const recordId = selectedLesson?.id;
      const teacherId = editState.teacherId || selectedLesson?.teacherId || '';
      const date = editState.date || selectedLesson?.date || '';
      
      if (teacherId && date) {
        logConflictOverride({
          recordId,
          entity: 'lesson',
          teacherId,
          date,
          conflictSummary,
        });
        
        if (import.meta.env.DEV) {
          console.log('[Calendar] Conflict override logged:', {
            recordId,
            entity: 'lesson',
            teacherId: teacherId.slice(0, 8) + '…',
            date,
            conflictSummary,
          });
        }
      }
      
      await pendingSaveAction();
    }
  };

  const handleOverlapBack = () => {
    setShowOverlapModal(false);
    setOverlapConflicts([]);
    setPendingSaveAction(null);
  };

  // Open cancel modal instead of direct confirm
  const handleCancel = () => {
    if (!selectedLesson) return;
    setCancelModalLesson(selectedLesson);
    setShowCancelModal(true);
  };

  // Close cancel modal
  const handleCancelModalClose = () => {
    setShowCancelModal(false);
    setCancelModalLesson(null);
  };

  // Cancel lesson only (without notification)
  const handleCancelOnly = async () => {
    if (!cancelModalLesson) return;
    
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:handleCancelOnly:entry',message:'handleCancelOnly called',data:{lessonId:cancelModalLesson.id,date:cancelModalLesson.date,startTime:cancelModalLesson.startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H7'})}).catch(()=>{});
      // #endregion
      const updated = await updateLesson(cancelModalLesson.id, { status: LessonStatus.CANCELLED });
      setLessons(prev => prev.map(l => l.id === cancelModalLesson.id ? updated : l));
      
      // Trigger Make.com scenario to delete calendar event (non-blocking)
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:handleCancelOnly:triggerMake',message:'About to trigger CANCEL_LESSON scenario',data:{lessonId:cancelModalLesson.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H7'})}).catch(()=>{});
        // #endregion
        const makeResult = await triggerCancelLessonScenario({
          lessonId: cancelModalLesson.id,
          studentId: cancelModalLesson.studentId,
          date: cancelModalLesson.date,
          startTime: cancelModalLesson.startTime,
        });
        if (!makeResult.success) {
          console.warn('[Calendar] Failed to trigger cancel lesson scenario:', makeResult.error);
        }
      } catch (makeErr) {
        console.warn('[Calendar] Cancel lesson scenario error (non-blocking):', makeErr);
      }
      
      // Refresh data to show reopened slots (if any)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:handleCancelOnly:beforeRefresh',message:'About to refreshData(true) after cancel',data:{lessonId:cancelModalLesson.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H-cal-cancel'})}).catch(()=>{});
      // #endregion
      await refreshData(true);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'Calendar.tsx:handleCancelOnly:afterRefresh',message:'refreshData(true) completed after cancel',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H-cal-cancel'})}).catch(()=>{});
      // #endregion
      setSelectedLesson(null);
      setShowCancelModal(false);
      setCancelModalLesson(null);
      toast.success('השיעור בוטל בהצלחה');
    } catch (err: any) {
      toast.error(parseApiError(err));
      throw err; // Re-throw to keep modal open on error
    }
  };

  // Cancel lesson and send notification to student
  const handleCancelAndNotify = async () => {
    if (!cancelModalLesson) return;
    
    // First, cancel the lesson
    let updated: Lesson;
    try {
      updated = await updateLesson(cancelModalLesson.id, { status: LessonStatus.CANCELLED });
      setLessons(prev => prev.map(l => l.id === cancelModalLesson.id ? updated : l));
    } catch (err: any) {
      toast.error(parseApiError(err));
      throw err; // Re-throw to keep modal open on error
    }
    
    // Trigger Make.com scenario to delete calendar event (non-blocking)
    try {
      const makeResult = await triggerCancelLessonScenario({
        lessonId: cancelModalLesson.id,
        studentId: cancelModalLesson.studentId,
        date: cancelModalLesson.date,
        startTime: cancelModalLesson.startTime,
      });
      if (!makeResult.success) {
        console.warn('[Calendar] Failed to trigger cancel lesson scenario:', makeResult.error);
      }
    } catch (makeErr) {
      console.warn('[Calendar] Cancel lesson scenario error (non-blocking):', makeErr);
    }
    
    // Refresh data to show reopened slots (if any)
    await refreshData(true);
    
    // Lesson cancelled successfully - now try to send notification
    // Get student phone number
    const student = students.find(s => s.id === cancelModalLesson.studentId);
    const studentPhone = student?.phone || student?.parentPhone;
    const studentName = cancelModalLesson.studentName || student?.name || '';
    const lessonDate = cancelModalLesson.date;
    
    if (!studentPhone) {
      // No phone number available - show warning but close modal
      setSelectedLesson(null);
      setShowCancelModal(false);
      setCancelModalLesson(null);
      toast.warning('השיעור בוטל, אבל לא נמצא מספר טלפון לשליחת הודעה');
      return;
    }
    
    // Send notification via Make scenario
    const result = await sendTeacherCancelNotification({
      phone: studentPhone,
      date: lessonDate,
      name: studentName,
    });
    
    setSelectedLesson(null);
    setShowCancelModal(false);
    setCancelModalLesson(null);
    
    if (result.success) {
      toast.success('השיעור בוטל והודעה נשלחה לתלמיד');
    } else {
      // Lesson cancelled but notification failed
      toast.warning(`השיעור בוטל, אבל ההודעה לא נשלחה: ${result.error || 'שגיאה לא ידועה'}`);
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

  // Handler for opening a week - creates slots and fixed lessons from weekly_slot templates
  const handleOpenWeek = async () => {
    if (isOpeningWeek) return;
    
    setIsOpeningWeek(true);
    setOpenWeekMessage(null);
    
    try {
      // weekDates[0] is Sunday (first day of the displayed week)
      const weekStart = weekDates[0];
      console.log(`[Calendar] Opening week starting ${weekStart.toISOString()}`);
      
      const result = await nexusApi.openWeekSlots(weekStart);
      
      console.log(`[Calendar] Week opened successfully:`, result);
      setOpenWeekMessage({
        type: 'success',
        text: `נפתחו ${result.slotInventoryCount} חלונות ו-${result.fixedLessonsCount} שיעורים קבועים`
      });
      
      // Refresh data after opening week (force refresh to invalidate cache and show new slots)
      await refreshData(true);
      
      // Auto-dismiss success message after 5 seconds
      setTimeout(() => setOpenWeekMessage(null), 5000);
    } catch (error: any) {
      console.error('[Calendar] Error opening week:', error);
      setOpenWeekMessage({
        type: 'error',
        text: `שגיאה בפתיחת שבוע: ${error.message || 'שגיאה לא ידועה'}`
      });
    } finally {
      setIsOpeningWeek(false);
    }
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
          <button 
            onClick={handleOpenWeek}
            disabled={isOpeningWeek}
            className={`bg-emerald-600 text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-md transition-all w-full sm:w-auto text-center ${
              isOpeningWeek 
                ? 'opacity-60 cursor-not-allowed' 
                : 'hover:bg-emerald-700'
            }`}
          >
            {isOpeningWeek ? 'פותח שבוע...' : 'פתיחת שבוע'}
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

      {/* Toast message for open week operation */}
      {openWeekMessage && (
        <div 
          className={`px-6 py-3 rounded-2xl text-sm font-bold shadow-md transition-all ${
            openWeekMessage.type === 'success' 
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <span>{openWeekMessage.text}</span>
            <button 
              onClick={() => setOpenWeekMessage(null)}
              className="text-current opacity-60 hover:opacity-100 transition-opacity"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 bg-white rounded-[32px] border border-slate-200 shadow-sm flex flex-col w-full overflow-hidden">
        {(viewMode === 'agenda' || viewMode === 'recurring') ? (
          viewMode === 'recurring' ? (
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              <h2 className="text-sm font-bold text-slate-700 mb-4">תבניות שיעורים מחזוריים</h2>
              {[0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => {
                const daySlotsList = fixedWeeklySlots.filter(s => s.dayOfWeek === dayOfWeek);
                if (daySlotsList.length === 0) return null;
                return (
                  <div key={dayOfWeek} className="space-y-3">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-2 px-2">
                      {DAYS_HEBREW[dayOfWeek]}
                    </h3>
                    {daySlotsList.map((slot: WeeklySlot) => (
                      <div
                        key={slot.id}
                        className="w-full bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 shadow-sm flex items-center justify-between text-right"
                      >
                        <div className="flex items-center gap-6 flex-1 min-w-0">
                          <div className="w-12 h-12 bg-indigo-100 text-indigo-700 rounded-xl flex items-center justify-center border border-indigo-200 shrink-0">
                            <span className="text-xs font-bold">{slot.startTime}</span>
                          </div>
                          <div className="text-right flex-1 min-w-0">
                            <div className="font-bold text-slate-900">{slot.teacherName || slot.teacherId || 'מורה'}</div>
                            <div className="text-[10px] font-medium text-slate-500 mt-0.5">
                              {slot.startTime}–{slot.endTime}
                              {slot.durationMin != null && ` • ${slot.durationMin} דק׳`}
                            </div>
                            <div className="text-[10px] font-medium text-indigo-600 mt-1">
                              {slot.type === 'private' ? 'פרטי' : slot.type === 'pair' ? 'זוגי' : 'קבוצתי'}
                              {slot.reservedForNames && slot.reservedForNames.length > 0
                                ? ` • ${slot.reservedForNames.join(', ')}`
                                : ' • לא שויך'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {weekDates.map((date, dayIdx) => {
              const dayLessons = filteredLessons.filter(l => new Date(l.date).toDateString() === date.toDateString());
              const daySlots = openSlots
                .filter(s => new Date(s.date).toDateString() === date.toDateString())
                .filter(slot => shouldRenderOpenSlot(slot, lessons));
              
              if (dayLessons.length === 0 && daySlots.length === 0) return null;
              
              return (
                <div key={dayIdx} className="space-y-3">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-2 px-2">
                    {DAYS_HEBREW[date.getDay()]}, {date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                  </h3>
                  {dayLessons.map(lesson => {
                    const hasOverlapWithSlot = lessonOverlapsSlot.get(lesson.id) || false;
                    return (
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
                           <div className="text-right flex-1">
                              <div className="flex items-center gap-2">
                                <div className="font-bold text-slate-900">{lesson.studentName}</div>
                                {hasOverlapWithSlot && (
                                  <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    חופף לחלון
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-medium text-slate-400">{lesson.subject} • {lesson.duration} דק׳ • {
                                lesson.lessonType === 'private' ? 'פרטי' : 
                                lesson.lessonType === 'pair' ? 'זוגי' : 
                                lesson.lessonType === 'recurring' ? 'מחזורי' : 'קבוצתי'
                              }</div>
                           </div>
                        </div>
                        <div className={`px-3 py-1 rounded-full text-[10px] font-bold border ${
                          lesson.status === LessonStatus.COMPLETED ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                          lesson.status === LessonStatus.CANCELLED ? 'bg-slate-50 text-slate-400 border-slate-200' : 
                          'bg-blue-50 text-blue-600 border-blue-100'
                        }`}>
                          {lesson.status}
                        </div>
                      </button>
                    );
                  })}
                  {daySlots.map(slot => {
                    const hasOverlapWithLesson = slotOverlapsLesson.get(slot.id) || false;
                    return (
                      <button
                        key={slot.id}
                        onClick={() => slotModal.open(slot.id, slot)}
                        className="w-full bg-teal-50/30 p-5 rounded-2xl border border-teal-100 shadow-sm flex items-center justify-between text-right hover:border-teal-300 transition-all group"
                      >
                        <div className="flex items-center gap-6 flex-1 min-w-0">
                           <div className="w-12 h-12 bg-teal-50 text-teal-700 rounded-xl flex items-center justify-center border border-teal-100 shrink-0">
                              <span className="text-xs font-black">{slot.startTime}</span>
                           </div>
                           <div className="text-right flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="font-black text-teal-900 leading-tight">חלון פתוח</div>
                                {hasOverlapWithLesson && (
                                  <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    חופף
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-bold text-teal-600/70 leading-tight mt-0.5">{slot.startTime}–{slot.endTime}</div>
                              {slot.teacherName && (
                                <div className="text-[9px] font-medium text-teal-500/60 leading-tight mt-0.5">{slot.teacherName}</div>
                              )}
                           </div>
                        </div>
                        <div className="px-3 py-1 rounded-full text-[10px] font-black border bg-white text-teal-600 border-teal-100 shadow-sm group-hover:bg-teal-600 group-hover:text-white transition-all shrink-0">
                          שריין עכשיו
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          )
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
                {(viewMode === 'day' ? [currentDate] : weekDates).map((date, dayIdx) => (
                  <div key={dayIdx} className="flex-1 border-l border-slate-100 last:border-l-0 relative min-h-[1344px]">
                    {HOURS.map(hour => (
                      <div 
                        key={hour} 
                        className="h-24 border-b border-slate-100/30 cursor-crosshair hover:bg-slate-50/50 transition-colors"
                        onClick={() => handleSlotClick(date, hour)}
                      ></div>
                    ))}
                    {filteredLessons
                      .filter(l => new Date(l.date).toDateString() === date.toDateString())
                      .map(lesson => {
                        const hour = parseInt(lesson.startTime.split(':')[0]);
                        const mins = parseInt(lesson.startTime.split(':')[1]);
                        const topOffset = (hour - 8) * 96 + (mins / 60) * 96;
                        const height = (lesson.duration / 60) * 96;
                        const hasOverlapWithSlot = lessonOverlapsSlot.get(lesson.id) || false;
                        return (
                          <button
                            key={lesson.id}
                            onClick={() => { 
                              setSelectedLesson(lesson);
                              setSelectedRecord(rawRecords.get(lesson.id) || null);
                              // Set selected student from lesson
                              const student = students.find(s => s.id === lesson.studentId);
                              setSelectedStudent(student || null);
                              setEditState({ ...lesson, studentIds: lesson.studentIds || [lesson.studentId] }); 
                            }}
                            style={{ top: `${topOffset}px`, height: `${height}px` }}
                            className={`absolute left-1.5 right-1.5 rounded-2xl p-4 text-right border-r-4 shadow-sm border border-slate-200 flex flex-col justify-between overflow-hidden bg-white hover:z-10 transition-all ${
                              lesson.lessonType === 'recurring' ? 'border-indigo-600' : 
                              lesson.lessonType === 'group' ? 'border-amber-600' : 'border-blue-600'
                            }`}
                            title={lesson.notes ? `${lesson.studentName} - ${lesson.notes}` : lesson.studentName}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-bold text-sm leading-tight text-slate-900 line-clamp-1 flex-1">{lesson.studentName}</div>
                              {hasOverlapWithSlot && (
                                <span className="text-[8px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded-full shrink-0">
                                  חופף לחלון
                                </span>
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
                            <div className="hidden sm:flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                               <div className="text-[10px] font-bold text-slate-400">{lesson.startTime}</div>
                               <div className="text-[10px] font-bold bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full">{lesson.subject}</div>
                            </div>
                          </button>
                        );
                      })
                    }
                    {openSlots
                      .filter(s => new Date(s.date).toDateString() === date.toDateString())
                      .filter(slot => shouldRenderOpenSlot(slot, lessons))
                      .map(slot => {
                        const hour = parseInt(slot.startTime.split(':')[0]);
                        const mins = parseInt(slot.startTime.split(':')[1]);
                        const topOffset = (hour - 8) * 96 + (mins / 60) * 96;
                        
                        const endHour = parseInt(slot.endTime.split(':')[0]);
                        const endMins = parseInt(slot.endTime.split(':')[1]);
                        const duration = (endHour * 60 + endMins) - (hour * 60 + mins);
                        const height = (duration / 60) * 96;
                        const hasOverlapWithLesson = slotOverlapsLesson.get(slot.id) || false;

                        return (
                          <button
                            key={slot.id}
                            onClick={() => {
                              // Use shared hook to open slot modal with preloaded slot data
                              slotModal.open(slot.id, slot);
                            }}
                            style={{ top: `${topOffset}px`, height: `${height}px` }}
                            className="absolute left-1.5 right-1.5 rounded-2xl p-4 text-right border-r-4 border-teal-500 shadow-sm border border-teal-100 flex flex-col justify-start gap-1 overflow-hidden bg-teal-50/50 hover:bg-teal-50 hover:z-10 transition-all group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-black text-xs text-teal-700 leading-tight">חלון פתוח</div>
                              {hasOverlapWithLesson && (
                                <span className="text-[8px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded-full shrink-0">
                                  חופף
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-bold text-teal-600/70 leading-tight">{slot.startTime}–{slot.endTime}</div>
                            {slot.teacherName && (
                              <div className="text-[9px] font-medium text-teal-500/60 leading-tight mt-0.5">{slot.teacherName}</div>
                            )}
                          </button>
                        );
                      })
                    }
                  </div>
                ))}
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
                      onClick={() => setEditState(p => ({
                        ...p,
                        lessonType: type,
                        studentIds: type === 'private' ? (p.studentIds?.slice(0, 1)) : p.studentIds,
                        recurringLessonType: type === 'recurring' ? (p.recurringLessonType ?? 'private') : undefined,
                      }))}
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
                      {(['private', 'pair', 'group'] as RecurringLessonType[]).map(t => {
                        const isSelected = (editState.recurringLessonType ?? (editState.isPrivate !== false ? 'private' : 'pair')) === t;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setEditState(p => ({ ...p, recurringLessonType: t, isPrivate: t === 'private' }))}
                            className={`py-2 text-[10px] font-bold border rounded-xl transition-all ${
                              isSelected ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-100 text-slate-400'
                            }`}
                          >
                            {t === 'private' ? 'פרטי' : t === 'pair' ? 'זוגי' : 'קבוצתי'}
                          </button>
                        );
                      })}
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
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">מורה</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                  value={editState.teacherId ?? ''}
                  onChange={(e) => setEditState(p => ({ ...p, teacherId: e.target.value || undefined }))}
                >
                  <option value="">בחר מורה...</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {isCreating && (editState.lessonType === 'recurring' || !editState.teacherId) && !editState.teacherId && (
                  <div className="text-xs font-bold text-amber-700">נא לבחור מורה לשיעור</div>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {editState.lessonType === 'private' || (editState.lessonType === 'recurring' && (editState.recurringLessonType ?? 'private') === 'private') ? 'תלמיד' : 'תלמידים (בחירה מרובה)'}
                </label>
                {editState.lessonType === 'private' || (editState.lessonType === 'recurring' && (editState.recurringLessonType ?? 'private') === 'private') ? (
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
                  <>
                    <StudentsPicker
                      values={editState.studentIds || []}
                      onChange={(studentIds) => {
                        const isPair = editState.lessonType === 'pair' || (editState.lessonType === 'recurring' && editState.recurringLessonType === 'pair');
                        const ids = isPair && studentIds.length > 2 ? studentIds.slice(0, 2) : studentIds;
                        setEditState(prev => ({
                          ...prev,
                          studentIds: ids,
                          studentId: ids[0] || undefined,
                          studentName: ids.length === 1 ? students.find(s => s.id === ids[0])?.name : undefined
                        }));
                      }}
                      placeholder="חפש תלמידים לפי שם או טלפון..."
                      disabled={isSaving}
                      filterActiveOnly={true}
                      maxSelection={editState.lessonType === 'pair' || (editState.lessonType === 'recurring' && editState.recurringLessonType === 'pair') ? 2 : undefined}
                      fallbackNames={Object.fromEntries(
                        (editState.studentIds || [])
                          .map(id => [id, students.find(s => s.id === id)?.name ?? ''])
                          .filter(([, n]) => n) as [string, string][]
                      )}
                    />
                    {(editState.lessonType === 'pair' || (editState.lessonType === 'recurring' && editState.recurringLessonType === 'pair')) && (editState.studentIds?.length || 0) !== 2 && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <div className="text-xs font-bold text-amber-800">
                          שיעור זוגי דורש בדיוק 2 תלמידים. נבחרו {editState.studentIds?.length || 0} תלמידים.
                        </div>
                      </div>
                    )}
                    {isCreating && editState.lessonType === 'group' && (editState.studentIds?.length || 0) < 2 && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <div className="text-xs font-bold text-amber-800">
                          ⚠️ שיעור קבוצתי דורש לפחות 2 תלמידים. נבחרו {editState.studentIds?.length || 0} תלמידים.
                        </div>
                      </div>
                    )}
                    {isCreating && editState.lessonType === 'recurring' && editState.recurringLessonType === 'group' && (editState.studentIds?.length || 0) < 2 && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <div className="text-xs font-bold text-amber-800">
                          ⚠️ שיעור מחזורי קבוצתי דורש לפחות 2 תלמידים. נבחרו {editState.studentIds?.length || 0} תלמידים.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Real-time Overlap Warning */}
              {realtimeOverlapWarning && realtimeOverlapWarning.hasOverlap && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                  <div className="flex items-start gap-3">
                    <span className="text-amber-600 text-xl">⚠️</span>
                    <div className="flex-1">
                      <div className="text-sm font-black text-amber-800 mb-2">
                        נמצאה חפיפה בלו״ז
                      </div>
                      <div className="text-xs font-medium text-amber-700 mb-2">
                        השיעור המבוקש חופף עם {realtimeOverlapWarning.conflicts.length} פריט{realtimeOverlapWarning.conflicts.length > 1 ? 'ים' : ''} קיים{realtimeOverlapWarning.conflicts.length > 1 ? 'ים' : ''}:
                      </div>
                      <div className="space-y-1">
                        {realtimeOverlapWarning.conflicts.map((conflict, idx) => (
                          <div key={idx} className="text-xs font-bold text-amber-700">
                            • {conflict.label} - {conflict.time} {conflict.type === 'lesson' ? '(שיעור)' : '(חלון פתוח)'}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Conflict Warning (server-side check for lessons only) */}
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
                  <input 
                    type="date" 
                    className={`w-full bg-slate-50 border rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 transition-all ${
                      realtimeOverlapWarning?.hasOverlap ? 'border-amber-300 focus:ring-amber-100' : 'border-slate-200 focus:ring-blue-100'
                    }`}
                    value={editState.date || ''} 
                    onChange={(e) => setEditState(p => ({ ...p, date: e.target.value }))} 
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שעת התחלה</label>
                  <input 
                    type="time" 
                    step="900" 
                    className={`w-full bg-slate-50 border rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 transition-all ${
                      realtimeOverlapWarning?.hasOverlap ? 'border-amber-300 focus:ring-amber-100' : 'border-slate-200 focus:ring-blue-100'
                    }`}
                    value={editState.startTime || ''} 
                    onChange={(e) => setEditState(p => ({ ...p, startTime: e.target.value }))} 
                  />
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
                        const isPrivateRecur = p.lessonType === 'recurring' && (p.recurringLessonType ?? 'private') === 'private';
                        if ((p.lessonType === 'private' || p.isPrivate || isPrivateRecur) && p.price === undefined) {
                          newState.price = Math.round((newDuration / 60) * 175 * 100) / 100;
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

              {(editState.lessonType === 'private' || (editState.lessonType === 'recurring' && (editState.recurringLessonType ?? 'private') === 'private')) && (
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    מחיר שיעור (₪) - ברירת מחדל: 175₪ ל-60 דקות
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                      value={priceInputValue}
                      onChange={(e) => {
                        setPriceInputValue(e.target.value);
                        setPriceManuallyEdited(true);
                      }}
                      onBlur={(e) => {
                        const numValue = parseFloat(e.target.value);
                        if (!isNaN(numValue) && numValue >= 0) {
                          const formattedPrice = Math.round(numValue * 100) / 100;
                          setEditState(p => ({ ...p, price: formattedPrice }));
                          setPriceInputValue(formattedPrice.toFixed(2));
                        } else if (e.target.value === '' || e.target.value === '.') {
                          // Empty or just a dot - reset to calculated/default
                          const calculatedPrice = editState.duration 
                            ? Math.round(((editState.duration / 60) * 175 * 100)) / 100
                            : 175;
                          setEditState(p => ({ ...p, price: calculatedPrice }));
                          setPriceInputValue(calculatedPrice.toFixed(2));
                          setPriceManuallyEdited(false);
                        } else {
                          // Invalid input - restore to last valid price
                          const lastValidPrice = editState.price !== undefined 
                            ? editState.price 
                            : (editState.duration 
                              ? Math.round(((editState.duration / 60) * 175 * 100)) / 100
                              : 175);
                          setPriceInputValue(lastValidPrice.toFixed(2));
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const calculatedPrice = Math.round(((editState.duration || 60) / 60) * 175 * 100) / 100;
                        setEditState(p => ({ ...p, price: calculatedPrice }));
                        setPriceInputValue(calculatedPrice.toFixed(2));
                        setPriceManuallyEdited(false);
                      }}
                      className="px-4 py-4 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs hover:bg-blue-100 transition-all"
                      title="איפוס למחיר יחסי לפי משך השיעור"
                    >
                      ↻
                    </button>
                  </div>
                  <div className="text-xs text-slate-400">
                    מחיר ל-60 דקות: 175 ₪ • מחיר מחושב לפי משך השיעור: {Math.round(((editState.duration || 60) / 60) * 175 * 100) / 100} ₪
                    {!priceManuallyEdited && <span className="block mt-1 text-slate-500">המחיר מתעדכן אוטומטית לפי משך השיעור</span>}
                  </div>
                </div>
              )}

              {(editState.lessonType === 'pair' || (editState.lessonType === 'recurring' && editState.recurringLessonType === 'pair')) && (
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    מחיר שיעור זוגי (סה&quot;כ) – כל תלמיד יחויב במחצית
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                      value={priceInputValue}
                      onChange={(e) => {
                        setPriceInputValue(e.target.value);
                        setPriceManuallyEdited(true);
                      }}
                      onBlur={(e) => {
                        const numValue = parseFloat(e.target.value);
                        if (!isNaN(numValue) && numValue >= 0) {
                          const formattedPrice = Math.round(numValue * 100) / 100;
                          setEditState(p => ({ ...p, price: formattedPrice }));
                          setPriceInputValue(formattedPrice.toFixed(2));
                        } else if (e.target.value === '' || e.target.value === '.') {
                          setEditState(p => ({ ...p, price: 225 }));
                          setPriceInputValue('225.00');
                          setPriceManuallyEdited(false);
                        } else {
                          const lastValid = editState.price !== undefined ? editState.price : 225;
                          setPriceInputValue(lastValid.toFixed(2));
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEditState(p => ({ ...p, price: 225 }));
                        setPriceInputValue('225.00');
                        setPriceManuallyEdited(false);
                      }}
                      className="px-4 py-4 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs hover:bg-blue-100 transition-all"
                      title="איפוס לברירת מחדל 225₪"
                    >
                      ↻
                    </button>
                  </div>
                  <div className="text-xs text-slate-400">
                    ברירת מחדל: 225 ₪ סה&quot;כ (112.50 ₪ לתלמיד). עם מנוי זוגי – החיוב הוא של המנוי בלבד.
                  </div>
                </div>
              )}

            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex flex-col gap-3 shrink-0">
              {(() => {
                // Validation function to check if lesson can be created
                const canCreateLesson = (): boolean => {
                  if (isSaving || isCheckingConflicts || conflicts.length > 0) {
                    return false;
                  }
                  
                  if (!isCreating) {
                    return true; // Editing existing lesson
                  }
                  
                  // For new lessons, validate based on lesson type
                  if (editState.lessonType === 'private') {
                    return !!selectedStudent;
                  }
                  
                  if (editState.lessonType === 'pair') {
                    // Pair lesson requires exactly 2 students
                    return (editState.studentIds?.length || 0) === 2;
                  }
                  
                  if (editState.lessonType === 'group') {
                    // Group lesson requires at least 2 students
                    return (editState.studentIds?.length || 0) >= 2;
                  }
                  
                  if (editState.lessonType === 'recurring') {
                    // Recurring lesson - check based on recurringLessonType
                    const recurType = editState.recurringLessonType ?? 'private';
                    if (recurType === 'private') {
                      return !!(selectedStudent || editState.studentId || editState.studentIds?.[0]);
                    }
                    if (recurType === 'pair') {
                      return (editState.studentIds?.length || 0) === 2;
                    }
                    return (editState.studentIds?.length || 0) >= 2; // group
                  }
                  
                  return false;
                };
                
                const canCreate = canCreateLesson();
                
                return (
                  <button 
                    disabled={!canCreate} 
                    onClick={handleSave} 
                    className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                      !canCreate
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isCheckingConflicts ? 'בודק חפיפות...' : isSaving ? 'מעבד...' : (isCreating ? 'צור שיעור' : 'שמור שינויים')}
                  </button>
                );
              })()}
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

      {/* Slot Inventory Modal - Shared component */}
      {slotModal.isOpen && slotModal.slotData && (
        <SlotInventoryModal
          slot={{
            id: slotModal.slotData.id,
            startDateTime: `${slotModal.slotData.date}T${slotModal.slotData.startTime}:00`,
            endDateTime: `${slotModal.slotData.date}T${slotModal.slotData.endTime}:00`,
            teacherId: slotModal.slotData.teacherId,
            status: slotModal.slotData.status as any,
          }}
          onClose={slotModal.close}
          onSuccess={() => {
            // Immediately remove the slot from openSlots state (optimistic update)
            if (slotModal.activeSlotId) {
              setOpenSlots(prev => prev.filter(s => s.id !== slotModal.activeSlotId));
            }
            // Refresh data to ensure consistency (cache invalidation already happened in reserveSlotAndCreateLessons)
            // This ensures we get the latest lessons and updated slot status
            // Use forceRefresh=true to ensure we get the latest data after reservation
            refreshData(true);
            slotModal.handleSuccess();
          }}
          requireStudentForReserve={true}
        />
      )}
      
      {/* Legacy support: clickedSlot (for backward compatibility) */}
      {clickedSlot && !slotModal.isOpen && (
        <SlotInventoryModal
          slot={{
            id: clickedSlot.id,
            startDateTime: `${clickedSlot.date ?? ''}T${clickedSlot.startTime ?? '00:00'}:00`,
            endDateTime: `${clickedSlot.date ?? ''}T${clickedSlot.endTime ?? '01:00'}:00`,
            teacherId: clickedSlot.teacherId,
            status: clickedSlot.status as any,
          }}
          onClose={() => setClickedSlot(null)}
          onSuccess={() => {
            // Immediately remove the slot from openSlots state (optimistic update)
            setOpenSlots(prev => prev.filter(s => s.id !== clickedSlot.id));
            setClickedSlot(null);
            // Refresh data to ensure consistency (cache invalidation already happened in reserveSlotAndCreateLessons)
            // This ensures we get the latest lessons and updated slot status
            // Use forceRefresh=true to ensure we get the latest data after reservation
            refreshData(true);
          }}
          requireStudentForReserve={true}
        />
      )}

      {/* Overlap Warning Modal */}
      <LessonOverlapWarningModal
        isOpen={showOverlapModal}
        conflicts={overlapConflicts}
        onContinue={handleOverlapContinue}
        onBack={handleOverlapBack}
        isLoading={isSaving}
      />

      {/* Cancel Lesson Modal */}
      <CancelLessonModal
        isOpen={showCancelModal}
        lessonDate={cancelModalLesson?.date || ''}
        lessonTime={cancelModalLesson?.startTime}
        studentName={cancelModalLesson?.studentName || ''}
        onClose={handleCancelModalClose}
        onCancelOnly={handleCancelOnly}
        onCancelAndNotify={handleCancelAndNotify}
      />
    </div>
  );
};

export default Calendar;

