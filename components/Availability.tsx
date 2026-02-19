import React, { useState, useEffect } from 'react';
import { WeeklySlot, Teacher, Student, SlotInventory, Lesson } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import WeeklySlotsGrid from './WeeklySlotsGrid';
import LessonOverlapWarningModal from './ui/LessonOverlapWarningModal';
import type { ConflictItem, CheckConflictsResult } from '../services/conflictsCheckService';
import { buildConflictSummary } from '../services/conflictsCheckService';
import { logConflictOverride } from '../services/eventLog';
import StudentsPicker from './StudentsPicker';
import GroupPicker from './GroupPicker';
import SlotInventoryModal from './SlotInventoryModal';
import { useOpenSlotModal } from '../hooks/useOpenSlotModal';
import { useToast } from '../hooks/useToast';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { apiUrl } from '../config/api';
import { formatDate, parseLocalDate } from '../services/dateUtils';
import { invalidateSlotInventory } from '../data/resources/slotInventory';
import { slotStatusToAirtable } from '../utils/slotStatus';

const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * Detect overlaps between weekly slots
 * Overlap condition: same day_of_week AND time ranges overlap
 * Time overlap: startA < endB && startB < endA (if end==start, no overlap)
 */
export interface WeeklySlotOverlap {
  slotId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * Normalize day of week to consistent format (0-6, where 0=Sunday).
 * Handles multiple input formats:
 * - number (0-6 or 1-7)
 * - string numeric ("0"-"6" or "1"-"7")
 * - string Hebrew ("ראשון", "שני", etc.)
 * - string English ("Sunday", "Monday", etc.)
 * 
 * Returns normalized number (0-6) or null if cannot parse.
 * Convention: 0=Sunday, 1=Monday, ..., 6=Saturday
 */
function normalizeDayOfWeek(input: unknown): number | null {
  if (input === null || input === undefined) {
    return null;
  }

  // Handle number input
  if (typeof input === 'number') {
    const num = Math.floor(input);
    // If 1-7 format, convert to 0-6 (1->0, 2->1, ..., 7->6)
    if (num >= 1 && num <= 7) {
      return num - 1;
    }
    // If already 0-6, validate and return
    if (num >= 0 && num <= 6) {
      return num;
    }
    return null;
  }

  // Handle string input
  if (typeof input === 'string') {
    const trimmed = input.trim();
    
    // Try parsing as number
    const parsed = parseInt(trimmed, 10);
    if (!isNaN(parsed)) {
      // If 1-7 format, convert to 0-6
      if (parsed >= 1 && parsed <= 7) {
        return parsed - 1;
      }
      // If already 0-6, validate and return
      if (parsed >= 0 && parsed <= 6) {
        return parsed;
      }
      return null;
    }

    // Try Hebrew day names
    const hebrewDays: Record<string, number> = {
      'ראשון': 0, // Sunday
      'שני': 1,   // Monday
      'שלישי': 2, // Tuesday
      'רביעי': 3, // Wednesday
      'חמישי': 4, // Thursday
      'שישי': 5,  // Friday
      'שבת': 6,   // Saturday
    };
    if (hebrewDays[trimmed] !== undefined) {
      return hebrewDays[trimmed];
    }

    // Try English day names (case-insensitive)
    const englishDays: Record<string, number> = {
      'sunday': 0,
      'monday': 1,
      'tuesday': 2,
      'wednesday': 3,
      'thursday': 4,
      'friday': 5,
      'saturday': 6,
    };
    const lowerTrimmed = trimmed.toLowerCase();
    if (englishDays[lowerTrimmed] !== undefined) {
      return englishDays[lowerTrimmed];
    }

    return null;
  }

  return null;
}

export function detectWeeklySlotOverlaps(
  editedSlot: { dayOfWeek: number; startTime: string; endTime: string; id?: string },
  allSlots: WeeklySlot[]
): WeeklySlotOverlap[] {
  // Guard: missing required fields
  if (
    editedSlot.dayOfWeek === undefined ||
    !editedSlot.startTime ||
    !editedSlot.endTime
  ) {
    return [];
  }

  // Normalize edited slot's day of week
  const editedNormalizedDay = normalizeDayOfWeek(editedSlot.dayOfWeek);
  if (editedNormalizedDay === null) {
    if (import.meta.env?.DEV) {
      console.warn('[detectWeeklySlotOverlaps] Cannot normalize edited slot dayOfWeek:', editedSlot.dayOfWeek);
    }
    return []; // Cannot determine day, skip overlap check to avoid false positives
  }


  const overlaps: WeeklySlotOverlap[] = [];

  for (const slot of allSlots) {
    // Skip the slot being edited
    if (editedSlot.id && slot.id === editedSlot.id) {
      continue;
    }

    // Normalize other slot's day of week
    const otherNormalizedDay = normalizeDayOfWeek(slot.dayOfWeek);
    if (otherNormalizedDay === null) {
      if (import.meta.env?.DEV) {
        console.warn('[detectWeeklySlotOverlaps] Cannot normalize slot dayOfWeek, skipping:', {
          slotId: slot.id,
          dayOfWeek: slot.dayOfWeek,
        });
      }
      continue; // Skip slots with invalid dayOfWeek
    }

    // STRICT GUARD: Only check overlaps if days match exactly
    if (otherNormalizedDay !== editedNormalizedDay) {
      // DEV log to debug day mismatch issues (only log first few to avoid spam)
      continue; // Different day - no overlap possible
    }

    // Guard: missing time fields
    if (!slot.startTime || !slot.endTime) {
      continue;
    }

    // Check time overlap: startA < endB && startB < endA
    // Convert times to minutes for comparison
    const parseTime = (timeStr: string): number => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + (minutes || 0);
    };

    const editedStart = parseTime(editedSlot.startTime);
    const editedEnd = parseTime(editedSlot.endTime);
    const slotStart = parseTime(slot.startTime);
    const slotEnd = parseTime(slot.endTime);

    // Overlap condition: startA < endB && startB < endA (strict, no <=)
    if (editedStart < slotEnd && slotStart < editedEnd) {
      // Use normalized day for display consistency
      overlaps.push({
        slotId: slot.id,
        dayOfWeek: otherNormalizedDay, // Use normalized day, not raw value
        startTime: slot.startTime,
        endTime: slot.endTime,
      });
    }
  }

  return overlaps;
}

const Availability: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'weekly' | 'exceptions'>('weekly');
  const [weeklySlots, setWeeklySlots] = useState<WeeklySlot[]>([]);
  const [slotInventory, setSlotInventory] = useState<SlotInventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInventoryLoading, setIsInventoryLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<WeeklySlot | SlotInventory | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const slotModal = useOpenSlotModal();
  const toast = useToast();
  const { confirm } = useConfirmDialog();
  const [weekStart, setWeekStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay()); // Start of current week (Sunday)
    return formatDate(d); // local date so Sunday column shows Sunday slots
  });

  const [formData, setFormData] = useState({
    dayOfWeek: 0,
    startTime: '16:00',
    endTime: '17:00',
    type: 'private' as 'private' | 'group' | 'pair',
    teacherId: '',
    isFixed: false,
    reservedFor: undefined as string | undefined, // Backward compatibility
    reservedForIds: [] as string[], // Array of student IDs
    date: '', // For slot inventory editing
  });
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const [overlapConflicts, setOverlapConflicts] = useState<ConflictItem[]>([]);
  const [showOverlapModal, setShowOverlapModal] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<(() => Promise<void>) | null>(null);
  const [weeklySlotOverlaps, setWeeklySlotOverlaps] = useState<WeeklySlotOverlap[]>([]);
  const [slotInventoryValidationError, setSlotInventoryValidationError] = useState<{
    message: string;
    conflicts: ConflictItem[];
  } | null>(null);
  const [slotInventoryOverlapWarning, setSlotInventoryOverlapWarning] = useState<{
    message: string;
    conflicts: ConflictItem[];
  } | null>(null);

  useEffect(() => {
    loadData();
    loadTeachersAndStudents();
  }, []);

  useEffect(() => {
    if (activeTab === 'exceptions') {
      loadInventory();
    }
  }, [activeTab, weekStart]);

  // STEP 2 & 3: Track selectedSlot changes and update formData accordingly
  useEffect(() => {

    // If modal is open in edit mode and we have a selectedSlot, ensure formData is synced
    if (isModalOpen && modalMode === 'edit' && selectedSlot && 'dayOfWeek' in selectedSlot) {
      const s = selectedSlot as WeeklySlot;
      
      // Check if formData needs to be updated (defensive check)
      const expectedFormData = {
        dayOfWeek: s.dayOfWeek ?? 0,
        startTime: s.startTime || '16:00',
        endTime: s.endTime || '17:00',
        type: (s.type || 'private') as 'private' | 'group' | 'pair',
        teacherId: s.teacherId || '',
        isFixed: s.isFixed || false,
        reservedFor: s.reservedFor,
        reservedForIds: s.reservedForIds && s.reservedForIds.length > 0 
          ? s.reservedForIds 
          : (s.reservedFor ? [s.reservedFor] : []),
        date: '',
      };

      // Only update if formData doesn't match (avoid infinite loops)
      const needsUpdate = 
        formData.teacherId !== expectedFormData.teacherId ||
        formData.type !== expectedFormData.type ||
        formData.dayOfWeek !== expectedFormData.dayOfWeek ||
        formData.startTime !== expectedFormData.startTime ||
        formData.endTime !== expectedFormData.endTime ||
        JSON.stringify(formData.reservedForIds) !== JSON.stringify(expectedFormData.reservedForIds);

      if (needsUpdate) {
        setFormData(expectedFormData);
      }
    }
  }, [selectedSlot?.id, modalMode, isModalOpen]); // Only depend on slot ID to avoid loops

  const loadData = async () => {
    setLoading(true);
    try {
      const slots = await nexusApi.getWeeklySlots();
      setWeeklySlots(slots);
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const loadInventory = async (forceRefresh = false) => {
    setIsInventoryLoading(true);
    try {
      const d = parseLocalDate(weekStart);
      const weekEnd = new Date(d);
      weekEnd.setDate(d.getDate() + 6);
      
      // PART 3: Use resource/cache layer instead of bypassing it
      const { getSlotInventory } = await import('../data/resources/slotInventory');
      
      // Pass forceRefresh to bypass cache if needed (after reservation/edit/delete)
      const inventory = await getSlotInventory(
        {
          start: weekStart,
          end: formatDate(weekEnd),
        },
        undefined, // teacherId
        forceRefresh // forceRefresh flag
      );
      
      // Deduplicate by ID (defensive guard against Airtable returning dupes)
      const seen = new Set<string>();
      const deduplicated = inventory.filter(slot => {
        if (!slot?.id || seen.has(slot.id)) return false;
        seen.add(slot.id);
        return true;
      });
      
      deduplicated.sort((a, b) => {
        const dc = (a.date ?? '').localeCompare(b.date ?? '');
        return dc !== 0 ? dc : (a.startTime ?? '').localeCompare(b.startTime ?? '');
      });
      
      setSlotInventory(deduplicated);
    } catch (err) {
      console.error('Error loading inventory:', err);
    } finally {
      setIsInventoryLoading(false);
    }
  };

  const loadTeachersAndStudents = async () => {
    try {
      const [teachersData, studentsResult] = await Promise.all([
        nexusApi.getTeachers(),
        nexusApi.getStudents()
      ]);
      setTeachers(teachersData);
      setStudents(studentsResult.students);
    } catch (err) {
      console.error('Error loading teachers/students:', err);
    }
  };

  const handleToggleStatus = async (slot: WeeklySlot) => {
    try {
      const updated = await nexusApi.updateWeeklySlot(slot.id, {
        status: slot.status === 'active' ? 'paused' : 'active'
      });
      setWeeklySlots(prev => prev.map(s => s.id === slot.id ? updated : s));
    } catch (err) {
      toast.error(parseApiError(err));
    }
  };

  const handleDelete = async (slot: WeeklySlot) => {
    const confirmed = await confirm({
      title: 'מחיקת חלון זמינות',
      message: 'האם להסיר את חלון הזמינות הזה?',
      variant: 'warning',
      confirmLabel: 'מחק',
      cancelLabel: 'ביטול'
    });
    if (!confirmed) return;
    
    try {
      await nexusApi.deleteWeeklySlot(slot.id);
      setWeeklySlots(prev => prev.filter(s => s.id !== slot.id));
    } catch (err) {
      toast.error(parseApiError(err));
    }
  };

  const handleOpenModal = (slot: WeeklySlot | SlotInventory | null, dayIdx?: number) => {
    // Guard: if edit mode but no slot provided
    if (slot === null && dayIdx === undefined) {
      if (import.meta.env.DEV) {
        console.warn('[Availability] handleOpenModal called with null slot and no dayIdx - this should not happen');
      }
      return;
    }

    if (slot && 'dayOfWeek' in slot) {
      // Weekly slot - EDIT MODE
      const s = slot as WeeklySlot;
      
      // Guard: ensure we have all required data - prevent opening modal if critical fields missing
      if (!s.id) {
        if (import.meta.env.DEV) {
          console.warn('[Availability] Cannot open edit modal: Weekly slot missing ID', s);
        }
        toast.error('שגיאה: לא ניתן לפתוח עריכה - חסר מזהה רצועה');
        return;
      }
      
      if (s.dayOfWeek === undefined || s.dayOfWeek === null) {
        if (import.meta.env.DEV) {
          console.warn('[Availability] Weekly slot missing dayOfWeek:', {
            id: s.id,
            dayOfWeek: s.dayOfWeek,
          });
        }
        // Use fallback but warn
      }
      
      // STEP 2: Fix race condition - set state first, then open modal
      // Prefill form with actual slot data - use exact values from slot
      const newFormData = {
        dayOfWeek: s.dayOfWeek ?? 0,
        startTime: s.startTime || '16:00',
        endTime: s.endTime || '17:00',
        type: (s.type || 'private') as 'private' | 'group' | 'pair', // Use actual type from slot, NO inference
        teacherId: s.teacherId || '',
        isFixed: s.isFixed || false,
        reservedFor: s.reservedFor, // Backward compatibility
        reservedForIds: s.reservedForIds && s.reservedForIds.length > 0 
          ? s.reservedForIds 
          : (s.reservedFor ? [s.reservedFor] : []),
        date: '',
      };
      
      
      // Set all state synchronously before opening modal
      setSelectedSlot(s);
      setModalMode('edit');
      setFormData(newFormData);
      
      // Check overlaps after prefill
      const overlaps = detectWeeklySlotOverlaps(
        {
          id: s.id,
          dayOfWeek: newFormData.dayOfWeek,
          startTime: newFormData.startTime,
          endTime: newFormData.endTime,
        },
        weeklySlots.filter(slot => slot.id !== s.id) // Exclude current slot
      );
      setWeeklySlotOverlaps(overlaps);
      
      setIsModalOpen(true);
    } else if (slot) {
      // Slot inventory - EDIT MODE
      const s = slot as SlotInventory;
      
      
      const inventoryFormData = {
        dayOfWeek: new Date(s.date).getDay(),
        startTime: s.startTime,
        endTime: s.endTime,
        type: (s as any).type || 'private',
        teacherId: s.teacherId,
        isFixed: false,
        reservedFor: undefined,
        reservedForIds: [],
        date: s.date,
      };
      
      setSelectedSlot(s);
      setModalMode('edit');
      setFormData(inventoryFormData);
      // Reset conflict checking state when opening modal
      setIsCheckingConflicts(false);
      setSlotInventoryValidationError(null);
      setSlotInventoryOverlapWarning(null);
      
      // Open modal AFTER state is set
      setTimeout(() => {
        setIsModalOpen(true);
      }, 0);
    } else {
      // CREATE MODE - new slot
      
      const newFormData = {
        dayOfWeek: dayIdx !== undefined ? dayIdx : 0,
        startTime: '16:00',
        endTime: '17:00',
        type: 'private',
        teacherId: teachers.length > 0 ? teachers[0].id : '',
        isFixed: false,
        reservedFor: undefined,
        reservedForIds: [],
        date: '',
      };
      
      setSelectedSlot(null);
      setModalMode('create');
      setFormData(newFormData);
      
      // Check overlaps when creating new slot
      const overlaps = detectWeeklySlotOverlaps(
        {
          dayOfWeek: newFormData.dayOfWeek,
          startTime: newFormData.startTime,
          endTime: newFormData.endTime,
        },
        weeklySlots
      );
      setWeeklySlotOverlaps(overlaps);
      
      // Open modal AFTER state is set
      setTimeout(() => {
        setIsModalOpen(true);
      }, 0);
    }
  };

  // Check conflicts via API endpoint for slot_inventory
  const checkConflictsViaAPI = async (
    teacherId: string | undefined,
    date: string,
    startTime: string,
    endTime: string,
    recordId?: string,
    linkedLessonIds?: string[] // PART 4A: For excluding lessons already linked to this slot
  ): Promise<CheckConflictsResult | null> => {
    if (!teacherId || !date || !startTime || !endTime) {
      return null;
    }

    try {
      const response = await fetch(apiUrl('/api/conflicts/check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'slot_inventory',
          recordId: recordId, // PART 4B: For self-exclusion
          linkedLessonIds: linkedLessonIds, // PART 4A: For excluding linked lessons
          teacherId: teacherId,
          date: date,
          start: startTime,
          end: endTime,
        }),
      });

      if (!response.ok) {
        console.error('[Availability] Conflicts check failed:', response.status, response.statusText);
        return null;
      }

      const result: CheckConflictsResult = await response.json();
      return result;
    } catch (err) {
      console.error('[Availability] Conflicts check error:', err);
      return null;
    }
  };

  const performSave = async () => {
    setIsSaving(true);
    try {
      if (modalMode === 'edit' && selectedSlot) {
        // EDIT MODE: Update existing slot
        if ('dayOfWeek' in selectedSlot) {
          // Weekly slot - UPDATE existing record
          if (!selectedSlot.id) {
            throw new Error('Cannot update slot: missing ID');
          }
          
          const updates: Partial<WeeklySlot> = {
            dayOfWeek: formData.dayOfWeek,
            startTime: formData.startTime,
            endTime: formData.endTime,
            type: formData.type, // Use formData.type (from slot.type, not inferred)
            teacherId: formData.teacherId,
            isFixed: formData.isFixed,
            reservedForIds: formData.reservedForIds.length > 0 ? formData.reservedForIds : undefined,
          };
          const updated = await nexusApi.updateWeeklySlot(selectedSlot.id, updates);
          
          // Check overlaps after save
          const overlaps = detectWeeklySlotOverlaps(
            {
              id: updated.id,
              dayOfWeek: updated.dayOfWeek,
              startTime: updated.startTime,
              endTime: updated.endTime,
            },
            weeklySlots.filter(s => s.id !== updated.id)
          );
          
          // Update hasOverlap flag (calculated client-side)
          updated.hasOverlap = overlaps.length > 0;
          
          // Update local state
          setWeeklySlots(prev => prev.map(s => s.id === selectedSlot.id ? updated : s));
        } else {
          // Slot inventory - UPDATE
          if (!selectedSlot.id) {
            throw new Error('Cannot update slot inventory: missing ID');
          }
          const currentSlot = selectedSlot as SlotInventory;
          const slotDate = formData.date || currentSlot.date;
          
          // IMPORTANT: Only update fields that were changed, do NOT change status
          // Status should only change via explicit Block action, not during edit
          const updates: Partial<SlotInventory> = {
            startTime: formData.startTime,
            endTime: formData.endTime,
          };
          
          // Only include date and teacherId if they were actually changed
          if (formData.date && formData.date !== currentSlot.date) {
            updates.date = formData.date;
          }
          if (formData.teacherId && formData.teacherId !== currentSlot.teacherId) {
            updates.teacherId = formData.teacherId;
          }
          
          // Preserve status in Airtable format to prevent automations from changing it
          updates.status = slotStatusToAirtable(currentSlot.status) as any;
          
          const updated = await nexusApi.updateSlotInventory(selectedSlot.id, updates);
          
          // Double-check: preserve the original status in state
          const finalUpdated = {
            ...updated,
            status: currentSlot.status, // Keep original status from before edit
          };
          
          setSlotInventory(prev => prev.map(s => s.id === selectedSlot.id ? finalUpdated : s));
        }
      } else {
        // CREATE MODE: Create new slot
        if (formData.date && activeTab === 'exceptions') {
          // Creating a one-time exception slot (slot_inventory)
          const { createSlotInventory: createSlotMutation } = await import('../data/mutations');
          const newInventorySlot = await createSlotMutation({
            teacherId: formData.teacherId,
            date: formData.date,
            startTime: formData.startTime,
            endTime: formData.endTime,
            type: formData.type as 'private' | 'group' | 'pair',
            status: 'open',
          });
          
          // Add to local state
          setSlotInventory(prev => [...prev, newInventorySlot]);
          toast.success('חלון חד-פעמי נוצר בהצלחה');
        } else {
          // Creating a weekly slot template
          const newSlot = await nexusApi.createWeeklySlot(formData);
          
          // Check overlaps after creation
          const overlaps = detectWeeklySlotOverlaps(
            {
              id: newSlot.id,
              dayOfWeek: newSlot.dayOfWeek,
              startTime: newSlot.startTime,
              endTime: newSlot.endTime,
            },
            weeklySlots
          );
          
          newSlot.hasOverlap = overlaps.length > 0;
          
          // Add to local state
          setWeeklySlots(prev => [...prev, newSlot]);
        }
      }
      
      // Close modal and reset state
      setIsModalOpen(false);
      setShowOverlapModal(false);
      setOverlapConflicts([]);
      setWeeklySlotOverlaps([]);
      setPendingSaveAction(null);
      setSlotInventoryValidationError(null);
      setSlotInventoryOverlapWarning(null);
      setSelectedSlot(null);
      setModalMode('create');
      // Reset form data to defaults after successful save
      setFormData({
        dayOfWeek: 0,
        startTime: '16:00',
        endTime: '17:00',
        type: 'private',
        teacherId: '',
        isFixed: false,
        reservedFor: undefined,
        reservedForIds: [],
        date: '',
      });
    } catch (err: any) {
      if (err.code === 'CONFLICT_ERROR' || err.status === 409) {
        // Handle conflicts structure: { lessons: Lesson[], openSlots: SlotInventory[] }
        const conflicts = err.conflicts || {};
        const lessonConflicts = conflicts.lessons || [];
        
        let conflictDetails = '';
        if (lessonConflicts.length > 0) {
          const lessonDetails = lessonConflicts.map((c: Lesson) => 
            `• ${c.studentName || 'ללא שם'} - ${c.date} ${c.startTime} (${c.duration || 60} דקות)`
          ).join('\n');
          conflictDetails = `שיעורים חופפים:\n${lessonDetails}\n\n`;
        }
        
        toast.error(`לא ניתן לפתוח חלון - ${err.message || 'החלון המבוקש חופף עם שיעור קיים'}`);
      } else {
        toast.error(parseApiError(err));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    // Prevent double-submit
    if (isSaving || isCheckingConflicts) {
      return;
    }

    if (!formData.teacherId) {
      toast.error('אנא בחר מורה');
      return;
    }

    // Check weekly slot overlaps for weekly slots
    const isWeeklySlot = !selectedSlot || 'dayOfWeek' in selectedSlot;
    if (isWeeklySlot) {
      const overlaps = detectWeeklySlotOverlaps(
        {
          id: selectedSlot?.id,
          dayOfWeek: formData.dayOfWeek,
          startTime: formData.startTime,
          endTime: formData.endTime,
        },
        weeklySlots
      );
      setWeeklySlotOverlaps(overlaps);
      
      // Show warning if overlaps exist (non-blocking)
      if (overlaps.length > 0) {
        const overlapList = overlaps
          .map(
            (o) =>
              `${DAYS_HEBREW[o.dayOfWeek]} ${o.startTime}-${o.endTime} (${o.slotId.substring(0, 8)})`
          )
          .join(', ');
        // Alert is shown in modal UI, not blocking save
      }
    }

    // Only check conflicts for slot_inventory (not weekly slots)
    const isSlotInventory = selectedSlot && !('dayOfWeek' in selectedSlot);
    
    if (isSlotInventory) {
      const currentSlot = selectedSlot as SlotInventory;
      const slotDate = formData.date || currentSlot.date;
      
      // Validate required fields for slot_inventory
      if (!slotDate || !formData.startTime || !formData.endTime) {
        toast.error('נא למלא את כל שדות החובה: תאריך, שעת התחלה ושעת סיום');
        return;
      }

      // PART 5: Check internal slot_inventory overlaps (warning only) against loaded inventory
      const { hasOverlap } = await import('../services/overlapDetection');
      const editedSlotStartISO = new Date(`${slotDate}T${formData.startTime}:00`).toISOString();
      const editedSlotEndISO = new Date(`${slotDate}T${formData.endTime}:00`).toISOString();
      
      const internalOverlaps: ConflictItem[] = [];
      const currentSlotId = currentSlot?.id; // The slot being edited
      for (const otherSlot of slotInventory) { // slotInventory is the array from state
        // Exclude self when editing
        if (currentSlotId && otherSlot.id === currentSlotId) {
          continue;
        }
        
        // Only compare same date (one-off scope)
        if (otherSlot.date !== slotDate) {
          continue;
        }
        
        // Only compare against non-cancelled slots
        if (otherSlot.status === 'canceled' || otherSlot.status === 'מבוטל') {
          continue;
        }
        
        // Check overlap using half-open intervals
        const otherStartISO = new Date(`${otherSlot.date}T${otherSlot.startTime}:00`).toISOString();
        const otherEndISO = new Date(`${otherSlot.date}T${otherSlot.endTime}:00`).toISOString();
        
        if (hasOverlap(editedSlotStartISO, editedSlotEndISO, otherStartISO, otherEndISO)) {
          internalOverlaps.push({
            source: 'slot_inventory',
            recordId: otherSlot.id,
            start: otherStartISO,
            end: otherEndISO,
            label: `חלון פתוח ${otherSlot.startTime}-${otherSlot.endTime}`,
            meta: {},
          });
        }
      }
      
      // Show internal overlap warning (non-blocking)
      if (internalOverlaps.length > 0) {
        setSlotInventoryOverlapWarning({
          message: `יש ${internalOverlaps.length} חלון${internalOverlaps.length > 1 ? 'ות' : ''} פתוח${internalOverlaps.length > 1 ? 'ים' : ''} חופף${internalOverlaps.length > 1 ? 'ים' : ''} בזמן הזה`,
          conflicts: internalOverlaps,
        });
      } else {
        setSlotInventoryOverlapWarning(null);
      }

      // Check conflicts via API endpoint before saving (works for both CREATE and UPDATE)
      // This checks against lessons (blocking) and open slots from API (additional check)
      setIsCheckingConflicts(true);
      try {
        // PART 4A: Get linked lesson IDs for exclusion (if editing existing slot)
        const linkedLessonIds = currentSlot?.lessons || [];
        
        const conflictsResult = await checkConflictsViaAPI(
          formData.teacherId,
          slotDate,
          formData.startTime,
          formData.endTime,
          currentSlot?.id,  // PART 4B: undefined אם CREATE, id אם UPDATE (for self-exclusion)
          linkedLessonIds.length > 0 ? linkedLessonIds : undefined // PART 4A: Exclude linked lessons
        );

        if (conflictsResult && conflictsResult.hasConflicts && conflictsResult.conflicts.length > 0) {
          // Separate lesson conflicts (blocking) from slot conflicts (warning only)
          const lessonConflicts = conflictsResult.conflicts.filter(c => c.source === 'lessons');
          const apiSlotConflicts = conflictsResult.conflicts.filter(c => c.source === 'slot_inventory');
          
          // 1. Lesson conflicts - BLOCKING (red error)
          if (lessonConflicts.length > 0) {
            setSlotInventoryValidationError({
              message: `לא ניתן לשמור – יש ${lessonConflicts.length} שיעור${lessonConflicts.length > 1 ? 'ים' : ''} קיים${lessonConflicts.length > 1 ? 'ים' : ''} בזמן הזה`,
              conflicts: lessonConflicts,
            });
            // Clear yellow warning if there's a blocking error
            setSlotInventoryOverlapWarning(null);
            setIsCheckingConflicts(false);
            return; // חסימה - לא ממשיך לשמירה
          }
          
          // 2. API Slot conflicts - merge with internal overlaps (WARNING ONLY)
          // Combine internal overlaps with API slot conflicts
          const allSlotConflicts = [...internalOverlaps, ...apiSlotConflicts];
          if (allSlotConflicts.length > 0) {
            setSlotInventoryOverlapWarning({
              message: `יש ${allSlotConflicts.length} חלון${allSlotConflicts.length > 1 ? 'ות' : ''} פתוח${allSlotConflicts.length > 1 ? 'ים' : ''} חופף${allSlotConflicts.length > 1 ? 'ים' : ''} בזמן הזה`,
              conflicts: allSlotConflicts,
            });
          } else {
            setSlotInventoryOverlapWarning(null);
          }
        } else {
          // No API conflicts - keep internal overlap warning if exists, otherwise clear
          if (internalOverlaps.length === 0) {
            setSlotInventoryValidationError(null);
            setSlotInventoryOverlapWarning(null);
          }
        }
      } catch (err) {
        console.error('[Availability] Failed to check conflicts:', err);
        // On error, clear validation error and warning, allow save (fail-safe)
        setSlotInventoryValidationError(null);
        setSlotInventoryOverlapWarning(null);
      } finally {
        setIsCheckingConflicts(false);
      }
    } else {
      // Not slot_inventory - clear validation error and warning
      setSlotInventoryValidationError(null);
      setSlotInventoryOverlapWarning(null);
    }

    // No conflicts or not slot_inventory - proceed with save
    await performSave();
  };

  const handleOverlapContinue = async () => {
    if (pendingSaveAction) {
      // Log conflict override event
      const conflictSummary = buildConflictSummary(overlapConflicts);
      const isSlotInventory = selectedSlot && !('dayOfWeek' in selectedSlot);
      
      if (isSlotInventory) {
        const slotInventory = selectedSlot as SlotInventory;
        const slotDate = formData.date || slotInventory.date;
        const teacherId = formData.teacherId || slotInventory.teacherId || '';
        
        if (teacherId && slotDate) {
          logConflictOverride({
            recordId: slotInventory.id,
            entity: 'slot_inventory',
            teacherId,
            date: slotDate,
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

  const changeWeek = (delta: number) => {
    const d = parseLocalDate(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(formatDate(d));
  };

  const formatWeekRange = () => {
    const start = parseLocalDate(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} - ${end.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}`;
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-6">
        <div className="space-y-1">
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">ניהול זמינות</h2>
          <p className="text-slate-500 font-medium">הגדרת שעות פעילות קבועות וחריגים</p>
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
        <WeeklySlotsGrid
          mode="weekly"
          slots={weeklySlots}
          students={students}
          onSlotToggleStatus={handleToggleStatus}
          onSlotEdit={handleOpenModal}
          onSlotDelete={handleDelete}
          onAddSlot={(dayIdx) => handleOpenModal(null, dayIdx)}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
              <button onClick={() => changeWeek(-1)} className="p-2 hover:bg-slate-50 rounded-xl transition-all text-slate-400">←</button>
              <div className="px-4 text-sm font-black text-slate-700">{formatWeekRange()}</div>
              <button onClick={() => changeWeek(1)} className="p-2 hover:bg-slate-50 rounded-xl transition-all text-slate-400">→</button>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - d.getDay());
                  setWeekStart(formatDate(d));
                }}
                className="text-xs font-bold text-blue-600 hover:underline"
              >
                חזור לשבוע הנוכחי
              </button>
              <button
                onClick={() => {
                  // Open create modal for one-time exception slot
                  const startOfWeek = parseLocalDate(weekStart);
                  const defaultDate = formatDate(startOfWeek); // Default to first day of shown week
                  setSelectedSlot({ id: '', teacherId: '', teacherName: '', date: defaultDate, startTime: '16:00', endTime: '17:00', status: 'open' } as SlotInventory);
                  setModalMode('create');
                  setFormData({
                    dayOfWeek: startOfWeek.getDay(),
                    startTime: '16:00',
                    endTime: '17:00',
                    type: 'private',
                    teacherId: teachers.length > 0 ? teachers[0].id : '',
                    isFixed: false,
                    reservedFor: undefined,
                    reservedForIds: [],
                    date: defaultDate,
                  });
                  setIsCheckingConflicts(false);
                  setSlotInventoryValidationError(null);
                  setSlotInventoryOverlapWarning(null);
                  setIsModalOpen(true);
                }}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-all shadow-sm"
              >
                + חלון חד-פעמי
              </button>
            </div>
          </div>

          {isInventoryLoading ? (
            <div className="py-20 text-center text-slate-300 font-bold">טוען חריגים...</div>
          ) : (
            <WeeklySlotsGrid
              mode="onetime"
              slots={slotInventory}
              weekStart={weekStart}
              students={students}
              onSlotEdit={handleOpenModal}
              onAddSlot={(dayIdx) => {
                const startDate = parseLocalDate(weekStart);
                const targetDate = new Date(startDate);
                targetDate.setDate(startDate.getDate() + dayIdx);
                const dateStr = formatDate(targetDate);
                setSelectedSlot({ id: '', teacherId: '', teacherName: '', date: dateStr, startTime: '16:00', endTime: '17:00', status: 'open' } as SlotInventory);
                setModalMode('create');
                setFormData({
                  dayOfWeek: targetDate.getDay(),
                  startTime: '16:00',
                  endTime: '17:00',
                  type: 'private',
                  teacherId: teachers.length > 0 ? teachers[0].id : '',
                  isFixed: false,
                  reservedFor: undefined,
                  reservedForIds: [],
                  date: dateStr,
                });
                setIsCheckingConflicts(false);
                setSlotInventoryValidationError(null);
                setSlotInventoryOverlapWarning(null);
                setIsModalOpen(true);
              }}
              onReserveSlot={(slotId) => {
                // Find the slot in current state to pass as preloadedSlot (same as Calendar)
                const slot = slotInventory.find(s => s.id === slotId);
                if (slot) {
                  slotModal.open(slotId, slot);
                } else {
                  slotModal.open(slotId);
                }
              }}
              onSlotDelete={async (slotId) => {
                try {
                  setSlotInventory(prev => prev.filter(s => s.id !== slotId));
                  await nexusApi.deleteSlotInventory(slotId);
                  invalidateSlotInventory();
                  toast.success('החלון נמחק בהצלחה');
                } catch (err: any) {
                  console.error('[Availability] Failed to delete slot:', err);
                  toast.error(parseApiError(err));
                  await loadInventory(true);
                }
              }}
              onSlotBlock={async (slotId) => {
                try {
                  const slot = slotInventory.find(s => s.id === slotId);
                  if (!slot) {
                    toast.error('חלון לא נמצא');
                    return;
                  }
                  
                  const newStatus = slot.status === 'blocked' ? 'open' : 'blocked';
                  setSlotInventory(prev => prev.map(s => 
                    s.id === slotId 
                      ? { ...s, status: newStatus }
                      : s
                  ));
                  
                  await nexusApi.updateSlotInventory(slotId, { status: slotStatusToAirtable(newStatus) as any });
                  invalidateSlotInventory();
                  toast.success(newStatus === 'blocked' ? 'החלון נחסם בהצלחה' : 'החסימה בוטלה בהצלחה');
                } catch (err: any) {
                  console.error('[Availability] Failed to block/unblock slot:', err);
                  toast.error(parseApiError(err));
                  await loadInventory(true);
                }
              }}
            />
          )}
        </div>
      )}

      {/* Editor Modal - Side Panel (matching Calendar lesson modal style) */}
      {isModalOpen && !(modalMode === 'edit' && !selectedSlot) && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div 
            className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px]" 
            onClick={() => {
              setIsModalOpen(false);
              setSelectedSlot(null);
              setModalMode('create');
              setWeeklySlotOverlaps([]);
              // Reset form data to defaults when closing
              setFormData({
                dayOfWeek: 0,
                startTime: '16:00',
                endTime: '17:00',
                type: 'private',
                teacherId: '',
                isFixed: false,
                reservedFor: undefined,
                reservedForIds: [],
                date: '',
              });
            }}
          ></div>
          <div className="relative w-full lg:w-[500px] bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-left duration-300">
            {/* Header */}
            <div className="p-8 border-b border-slate-100 relative shrink-0">
              <button 
                onClick={() => {
                  setIsModalOpen(false);
                  setSelectedSlot(null);
                  setModalMode('create');
                  setWeeklySlotOverlaps([]);
                  // Reset form data to defaults when closing
                  setFormData({
                    dayOfWeek: 0,
                    startTime: '16:00',
                    endTime: '17:00',
                    type: 'private',
                    teacherId: '',
                    isFixed: false,
                    reservedFor: undefined,
                    reservedForIds: [],
                    date: '',
                  });
                }} 
                className="absolute left-8 top-8 p-2 text-slate-300 hover:text-slate-900 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h3 className="font-bold text-2xl text-slate-900 mt-6">
                {modalMode === 'edit' ? 'עריכת חלון' : 'חלון זמינות חדש'}
              </h3>
            </div>

            {/* Body - Scrollable Content */}
            <div className="flex-1 p-8 space-y-8 overflow-y-auto custom-scrollbar">
            
              {/* Day/Date Selection */}
              {!selectedSlot || 'dayOfWeek' in selectedSlot ? (
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">יום בשבוע</label>
                  <select 
                    value={formData.dayOfWeek} 
                    onChange={(e) => {
                      const newDay = parseInt(e.target.value);
                      setFormData({...formData, dayOfWeek: newDay});
                      // Recheck overlaps when day changes
                      if (!selectedSlot || 'dayOfWeek' in selectedSlot) {
                        const overlaps = detectWeeklySlotOverlaps(
                          {
                            id: selectedSlot?.id,
                            dayOfWeek: newDay,
                            startTime: formData.startTime,
                            endTime: formData.endTime,
                          },
                          weeklySlots
                        );
                        setWeeklySlotOverlaps(overlaps);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                    disabled={!!selectedSlot}
                  >
                    {DAYS_HEBREW.map((day, idx) => (
                      <option key={idx} value={idx}>{day}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">תאריך</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({...formData, date: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                    disabled={isSaving || isCheckingConflicts}
                  />
                </div>
              )}

              {/* Teacher Selection */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">מורה *</label>
                <select 
                  value={formData.teacherId} 
                  onChange={(e) => {
                    setFormData({...formData, teacherId: e.target.value});
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                  required
                  disabled={isSaving || isCheckingConflicts}
                >
                  <option value="">בחר מורה</option>
                  {teachers.map(teacher => (
                    <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                  ))}
                  {/* Temporary option if teacherId exists but teacher not in options yet */}
                  {formData.teacherId && !teachers.find(t => t.id === formData.teacherId) && selectedSlot && 'dayOfWeek' in selectedSlot && (
                    <option value={formData.teacherId} disabled>
                      {(selectedSlot as WeeklySlot).teacherName || formData.teacherId} (טוען...)
                    </option>
                  )}
                </select>
              </div>

              {/* Time Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שעת התחלה</label>
                  <input 
                    type="time" 
                    value={formData.startTime}
                    onChange={(e) => {
                      const newStartTime = e.target.value;
                      setFormData({...formData, startTime: newStartTime});
                      // Recheck overlaps when time changes
                      if (!selectedSlot || 'dayOfWeek' in selectedSlot) {
                        const overlaps = detectWeeklySlotOverlaps(
                          {
                            id: selectedSlot?.id,
                            dayOfWeek: formData.dayOfWeek,
                            startTime: newStartTime,
                            endTime: formData.endTime,
                          },
                          weeklySlots
                        );
                        setWeeklySlotOverlaps(overlaps);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                    disabled={isSaving || isCheckingConflicts}
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שעת סיום</label>
                  <input 
                    type="time" 
                    value={formData.endTime}
                    onChange={(e) => {
                      const newEndTime = e.target.value;
                      setFormData({...formData, endTime: newEndTime});
                      // Recheck overlaps when time changes
                      if (!selectedSlot || 'dayOfWeek' in selectedSlot) {
                        const overlaps = detectWeeklySlotOverlaps(
                          {
                            id: selectedSlot?.id,
                            dayOfWeek: formData.dayOfWeek,
                            startTime: formData.startTime,
                            endTime: newEndTime,
                          },
                          weeklySlots
                        );
                        setWeeklySlotOverlaps(overlaps);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                    disabled={isSaving || isCheckingConflicts}
                  />
                </div>
              </div>

              {/* Type Selection - Only for weekly slots */}
              {(!selectedSlot || 'dayOfWeek' in selectedSlot) && (
                <>
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">סוג ברירת מחדל</label>
                    <select 
                      value={formData.type}
                      onChange={(e) => setFormData({...formData, type: e.target.value as 'private' | 'group' | 'pair'})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                    >
                      <option value="private">פרטני</option>
                      <option value="pair">זוגי</option>
                      <option value="group">קבוצתי</option>
                    </select>
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={formData.isFixed}
                        onChange={(e) => setFormData({...formData, isFixed: e.target.checked, reservedFor: e.target.checked ? formData.reservedFor : undefined})}
                        className="w-5 h-5 rounded border-slate-300"
                      />
                      <span className="text-sm font-bold text-slate-700">סלוט קבוע (יוצר שיעור אוטומטית)</span>
                    </label>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">תלמידים</label>
                    {formData.type === 'group' && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">מלא מקבוצה</div>
                        <GroupPicker
                          value={null}
                          onChange={(_groupId, studentIds) => {
                            if (studentIds.length > 0) {
                              setFormData({...formData, reservedForIds: studentIds});
                            }
                          }}
                          disabled={isSaving}
                          placeholder="בחר קבוצה למילוי תלמידים..."
                        />
                      </div>
                    )}
                    <StudentsPicker
                      values={formData.reservedForIds}
                      onChange={(ids) => {
                        setFormData({...formData, reservedForIds: ids});
                      }}
                      placeholder="חפש תלמידים..."
                      disabled={isSaving}
                      fallbackNames={
                        selectedSlot && 'dayOfWeek' in selectedSlot && (selectedSlot as WeeklySlot).reservedForNames && (selectedSlot as WeeklySlot).reservedForIds
                          ? Object.fromEntries(
                              (selectedSlot as WeeklySlot).reservedForIds!.map((id, idx) => [
                                id,
                                (selectedSlot as WeeklySlot).reservedForNames![idx] || ''
                              ]).filter(([_, name]) => name)
                            )
                          : {}
                      }
                    />
                    {formData.type === 'pair' && formData.reservedForIds.length !== 2 && formData.reservedForIds.length > 0 && (
                      <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                        <div className="text-xs font-bold text-amber-800">
                          אזהרה: סוג זוגי דורש בדיוק 2 תלמידים. נבחרו {formData.reservedForIds.length} תלמידים.
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Weekly Slot Overlap Warning */}
              {(!selectedSlot || 'dayOfWeek' in selectedSlot) && weeklySlotOverlaps.length > 0 && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                  <div className="flex items-start gap-3">
                    <span className="text-rose-600 text-xl">⚠️</span>
                    <div className="flex-1">
                      <div className="text-sm font-black text-rose-800 mb-2">
                        נמצאה חפיפה בלו״ז
                      </div>
                      <div className="text-xs font-medium text-rose-700 mb-2">
                        החלון המבוקש חופף עם {weeklySlotOverlaps.length} רצוע{weeklySlotOverlaps.length > 1 ? 'ות' : 'ה'} קיימ{weeklySlotOverlaps.length > 1 ? 'ות' : 'ת'}:
                      </div>
                      <ul className="text-xs text-rose-700 space-y-1 list-disc list-inside">
                        {weeklySlotOverlaps.map((overlap, idx) => (
                          <li key={idx} className="font-bold">
                            {DAYS_HEBREW[overlap.dayOfWeek]} {overlap.startTime}-{overlap.endTime}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-8 bg-slate-50 border-t border-slate-100 flex flex-col gap-3 shrink-0">
              {/* Slot Inventory Overlap Warning - Yellow (slot vs slot, non-blocking) */}
              {(!selectedSlot || !('dayOfWeek' in selectedSlot)) && slotInventoryOverlapWarning && (
                <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl mb-2">
                  <div className="flex items-start gap-3">
                    <span className="text-amber-600 text-xl">⚠️</span>
                    <div className="flex-1">
                      <div className="text-sm font-black text-amber-800 mb-2">
                        {slotInventoryOverlapWarning.message}
                      </div>
                      <div className="text-xs font-medium text-amber-700 space-y-1">
                        {slotInventoryOverlapWarning.conflicts.map((conflict, idx) => {
                          const startTime = conflict.start.includes('T') ? conflict.start.slice(11, 16) : conflict.start.slice(0, 5);
                          const endTime = conflict.end.includes('T') ? conflict.end.slice(11, 16) : conflict.end.slice(0, 5);
                          const date = conflict.start.includes('T') ? conflict.start.slice(0, 10) : (formData.date || (selectedSlot as SlotInventory)?.date || '');
                          return (
                            <div key={idx} className="font-bold">
                              • {date} {startTime}-{endTime} - {conflict.label || 'חלון פתוח'} {conflict.recordId ? `(${conflict.recordId.substring(0, 8)}...)` : ''}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Slot Inventory Validation Error - Red (slot vs lesson, blocking) */}
              {(!selectedSlot || !('dayOfWeek' in selectedSlot)) && slotInventoryValidationError && (
                <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl mb-2">
                  <div className="flex items-start gap-3">
                    <span className="text-rose-600 text-xl">⚠️</span>
                    <div className="flex-1">
                      <div className="text-sm font-black text-rose-800 mb-2">
                        {slotInventoryValidationError.message}
                      </div>
                      <div className="text-xs font-medium text-rose-700 space-y-1">
                        {slotInventoryValidationError.conflicts.map((conflict, idx) => {
                          const startTime = conflict.start.includes('T') ? conflict.start.slice(11, 16) : conflict.start.slice(0, 5);
                          const date = conflict.start.includes('T') ? conflict.start.slice(0, 10) : (formData.date || (selectedSlot as SlotInventory)?.date || '');
                          return (
                            <div key={idx} className="font-bold">
                              • {date} {startTime} - {conflict.label || 'שיעור'} {conflict.recordId ? `(${conflict.recordId.substring(0, 8)}...)` : ''}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <button 
                disabled={isSaving || isCheckingConflicts || !formData.teacherId || (slotInventoryValidationError !== null)} 
                onClick={handleSave}
                className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all flex items-center justify-center ${
                  isSaving || isCheckingConflicts || !formData.teacherId || (slotInventoryValidationError !== null)
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isCheckingConflicts ? 'בודק חפיפות...' : isSaving ? 'מעבד...' : 'שמור'}
              </button>
              <button 
                disabled={isSaving || isCheckingConflicts}
                onClick={() => {
                  setIsModalOpen(false);
                  setSelectedSlot(null);
                  setModalMode('create');
                  setWeeklySlotOverlaps([]);
                  // Reset form data to defaults when canceling
                  setFormData({
                    dayOfWeek: 0,
                    startTime: '16:00',
                    endTime: '17:00',
                    type: 'private',
                    teacherId: '',
                    isFixed: false,
                    reservedFor: undefined,
                    reservedForIds: [],
                    date: '',
                  });
                }}
                className="w-full py-4 text-slate-600 font-bold hover:bg-slate-100 rounded-2xl transition-all"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Overlap Warning Modal */}
      <LessonOverlapWarningModal
        isOpen={showOverlapModal}
        conflicts={overlapConflicts}
        onContinue={handleOverlapContinue}
        onBack={handleOverlapBack}
        isLoading={isSaving}
      />

      <div className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-start gap-4">
         <span className="text-xl shrink-0">💡</span>
         <div className="text-sm text-blue-800 leading-relaxed font-bold">
           שימו לב: הגדרות הזמינות השבועי משמשות כבסיס לשיבוץ שיעורים ביומן. שינוי כאן לא ימחק שיעורים שכבר קיימים, אך ימנע שיבוצים עתידיים בשעות אלו.
         </div>
      </div>

      {/* Slot Inventory Modal - Shared component (same as Calendar) */}
      {/* For Availability: require student selection when reserving */}
      {slotModal.isOpen && slotModal.slotData && (
        <SlotInventoryModal
          slot={{
            id: slotModal.slotData.id,
            startDateTime: `${slotModal.slotData.date ?? ''}T${slotModal.slotData.startTime ?? '00:00'}:00`,
            endDateTime: `${slotModal.slotData.date ?? ''}T${slotModal.slotData.endTime ?? '01:00'}:00`,
            teacherId: slotModal.slotData.teacherId,
            status: slotModal.slotData.status as any,
            slotType: (() => {
              const lt = (slotModal.slotData as any).lessonType;
              if (lt === 'קבוצתי' || lt === 'group') return 'group';
              if (lt === 'זוגי' || lt === 'pair') return 'pair';
              return 'private';
            })(),
          }}
          onClose={slotModal.close}
          onSuccess={async () => {
            // Immediately remove the slot from slotInventory state (optimistic update - same as Calendar)
            if (slotModal.activeSlotId) {
              setSlotInventory(prev => prev.filter(s => s.id !== slotModal.activeSlotId));
            }
            
            // Force refresh: reload with forceRefresh=true to bypass cache
            // This ensures we get the latest data after reservation
            await loadInventory(true); // forceRefresh=true bypasses cache
            
            slotModal.handleSuccess();
          }}
          requireStudentForReserve={true}
        />
      )}
    </div>
  );
};

export default Availability;
