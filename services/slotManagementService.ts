/**
 * Slot Management Service
 * Handles all operations related to weekly_slot and slot_inventory tables
 */

import { airtableClient } from './airtableClient';
import { getTableId, getField } from '../contracts/fieldMap';
import { WeeklySlot, SlotInventory } from '../types';
import { WeeklySlotAirtableFields, SlotInventoryAirtableFields, LinkedRecord } from '../contracts/types';
import { formatDate, generateNaturalKey, getDateForDayOfWeek, getWeekStart, calculateDuration, DAYS_HEBREW, DAY_HEBREW_TO_NUM } from './dateUtils';
import { LessonStatus } from '../types';
import { preventSlotOpeningIfLessonsOverlap } from './conflictValidationService';

// Lazy import to avoid circular dependency
let _nexusApi: typeof import('./nexusApi').nexusApi | null = null;
async function getNexusApi() {
  if (!_nexusApi) {
    const module = await import('./nexusApi');
    _nexusApi = module.nexusApi;
  }
  return _nexusApi;
}

/**
 * Map Airtable weekly slot record to WeeklySlot type
 */
function mapAirtableToWeeklySlot(record: { id: string; fields: WeeklySlotAirtableFields }, teachersMap: Map<string, string>): WeeklySlot {
  const fields = record.fields;
  const teacherIdField = getField('weeklySlot', 'teacher_id');
  const teacherId = Array.isArray(fields[teacherIdField]) 
    ? (fields[teacherIdField] as string[])[0] 
    : (fields[teacherIdField] as string);
  
  const fixedField = getField('weeklySlot', 'קבוע' as any);
  const isFixed = fields[fixedField] === true || fields[fixedField] === 1;
  
  const reservedForField = getField('weeklySlot', 'reserved_for');
  const reservedForValue = fields[reservedForField];
  const reservedForIds: string[] = [];
  if (reservedForValue) {
    if (Array.isArray(reservedForValue)) {
      reservedForIds.push(
        ...reservedForValue.map((item: unknown) =>
          typeof item === 'string' ? item : (item as { id?: string })?.id ?? ''
        ).filter(Boolean)
      );
    } else if (typeof reservedForValue === 'string' && reservedForValue.startsWith('rec')) {
      reservedForIds.push(reservedForValue);
    } else if (typeof reservedForValue === 'object' && reservedForValue !== null && 'id' in reservedForValue && typeof (reservedForValue as { id: string }).id === 'string') {
      reservedForIds.push((reservedForValue as { id: string }).id);
    }
  }
  const reservedFor = reservedForIds.length > 0 ? reservedForIds[0] : undefined;

  const isReservedField = getField('weeklySlot', 'is_reserved');
  const isReservedRaw = fields[isReservedField];
  const isReserved = isReservedRaw === true || isReservedRaw === 1 || isReservedRaw === 'לא פנוי';
  
  // Extract type - NO FALLBACK, use actual value from Airtable
  // Type values in Airtable are in Hebrew: "פרטי", "זוגי", "קבוצתי"
  const typeField = getField('weeklySlot', 'type');
  const rawTypeValue = fields[typeField];
  // Map Hebrew values to English for internal use
  let type: 'private' | 'group' | 'pair' | undefined;
  if (rawTypeValue) {
    const typeStr = String(rawTypeValue).trim();
    if (typeStr === 'פרטי' || typeStr.toLowerCase() === 'private') {
      type = 'private';
    } else if (typeStr === 'קבוצתי' || typeStr.toLowerCase() === 'group') {
      type = 'group';
    } else if (typeStr === 'זוגי' || typeStr.toLowerCase() === 'pair') {
      type = 'pair';
    } else {
      // Unknown value - keep as-is for debugging
      type = rawTypeValue as any;
    }
  }
  const finalType = type || 'private'; // Only fallback to 'private' if completely missing
  
  // Determine status - we'll assume active if not explicitly paused
  // Note: There might not be a status field, so we'll default to active
  const status: 'active' | 'paused' = 'active';
  
  let durationMin = fields.duration_min;
  if (!durationMin && fields.start_time && fields.end_time) {
    try {
      durationMin = calculateDuration(fields.start_time, fields.end_time);
    } catch (error) {
      // Silently handle error - duration will remain undefined
    }
  }
  
  // Extract day_num (preferred) or day_of_week (fallback)
  // day_num is 1-7 (1=Sunday), convert to 0-6 (0=Sunday)
  let dayOfWeek: number;
  if (fields.day_num !== null && fields.day_num !== undefined && fields.day_num !== '') {
    const num = typeof fields.day_num === 'string' ? parseInt(fields.day_num, 10) : fields.day_num;
    if (!isNaN(num) && num >= 1 && num <= 7) {
      dayOfWeek = num - 1; // 1->0, 2->1, ..., 7->6
    } else {
      dayOfWeek = 0;
    }
  } else if (fields.day_of_week !== null && fields.day_of_week !== undefined && fields.day_of_week !== '') {
    const raw = fields.day_of_week;
    const str = typeof raw === 'string' ? raw.trim() : String(raw);
    const fromHebrew = DAY_HEBREW_TO_NUM[str];
    if (fromHebrew !== undefined) {
      dayOfWeek = fromHebrew;
    } else {
      const num = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
      dayOfWeek = isNaN(num) ? 0 : Math.max(0, Math.min(6, Math.floor(num)));
    }
  } else {
    dayOfWeek = 0;
  }
  
  return {
    id: record.id,
    teacherId: teacherId || '',
    teacherName: teachersMap.get(teacherId || '') || '',
    dayOfWeek: dayOfWeek,
    startTime: fields.start_time || '',
    endTime: fields.end_time || '',
    type: finalType as 'private' | 'group' | 'pair',
    status: status,
    isFixed: isFixed,
    reservedFor: reservedFor,
    reservedForIds: reservedForIds.length > 0 ? reservedForIds : undefined,
    durationMin: durationMin,
    isReserved: isReserved,
  };
}

/**
 * Map Airtable slot inventory record to SlotInventory type
 */
function mapAirtableToSlotInventory(record: { id: string; fields: SlotInventoryAirtableFields }, teachersMap: Map<string, string>): SlotInventory {
  const fields = record.fields;
  // Use the 'מורה' Linked Record field instead of 'מזהה_מורה' text field
  const teacherIdField = 'מורה';
  const teacherIdValue = fields[teacherIdField];
  const teacherId = Array.isArray(teacherIdValue) 
    ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
    : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
  
  const statusField = 'סטטוס';
  const rawStatusValue = (fields[statusField] || 'open') as string;
  // Normalize status value: trim whitespace and handle both Hebrew and English
  const rawStatus = typeof rawStatusValue === 'string' ? rawStatusValue.trim() : String(rawStatusValue).trim();
  // Normalize Hebrew and English values from Airtable to internal enum:
  // Hebrew: "פתוח" → 'open', "סגור" → 'closed', "מבוטל" → 'canceled', "חסום ע"י מנהל" → 'blocked'
  // English: "open" → 'open', "closed"/"booked" → 'closed', "canceled" → 'canceled', "blocked" → 'blocked'
  const status = (
    rawStatus === 'פתוח' || rawStatus === 'open'
      ? 'open'
      : rawStatus === 'סגור' || rawStatus === 'closed' || rawStatus === 'booked'
      ? 'closed'
      : rawStatus === 'מבוטל' || rawStatus === 'canceled'
      ? 'canceled'
      : rawStatus === 'חסום ע"י מנהל' || rawStatus === 'חסום' || rawStatus === 'blocked'
      ? 'blocked'
      : 'open' // Default to 'open' for unknown values
  ) as 'open' | 'closed' | 'canceled' | 'blocked';
  
  // Extract lesson IDs from linked record field (for filtering slots with lessons)
  const lessonsField = getField('slotInventory', 'lessons');
  const lessonsVal = fields[lessonsField] || fields.lessons;
  let lessonIds: string[] = [];
  if (Array.isArray(lessonsVal)) {
    lessonIds = lessonsVal.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
  } else if (lessonsVal) {
    lessonIds = [typeof lessonsVal === 'string' ? lessonsVal : lessonsVal.id].filter(Boolean);
  }
  
  return {
    id: record.id,
    teacherId: teacherId || '',
    teacherName: teachersMap.get(teacherId || '') || '',
    date: fields[getField('slotInventory', 'תאריך_שיעור')],
    startTime: fields[getField('slotInventory', 'שעת_התחלה')],
    endTime: fields[getField('slotInventory', 'שעת_סיום')],
    status: status,
    lessons: lessonIds, // Include linked lessons for filtering
  };
}

/**
 * Get all teachers and create a map of ID to name
 */
async function getTeachersMap(): Promise<Map<string, string>> {
  try {
    const teachersTableId = getTableId('teachers');
    const records = await airtableClient.getRecords<{ full_name: string }>(
      teachersTableId,
      { maxRecords: 1000 }
    );
    const map = new Map<string, string>();
    records.forEach(record => {
      map.set(record.id, record.fields.full_name || '');
    });
    return map;
  } catch (error) {
    return new Map();
  }
}

/**
 * Get all weekly slots from Airtable
 */
export async function getWeeklySlots(): Promise<WeeklySlot[]> {
  try {
    const tableId = getTableId('weeklySlot');
    const teachersMap = await getTeachersMap();
    
    // Get all active weekly slots
    // Note: We might need to filter by status if there's a status field
    const records = await airtableClient.getRecords<WeeklySlotAirtableFields>(
      tableId,
      {
        // Filter for active slots if there's a status field
        // For now, we'll get all slots and filter in code if needed
        maxRecords: 1000,
      }
    );
    
    // Map and filter out invalid slots (missing required fields)
    const mappedSlots = records.map(record => mapAirtableToWeeklySlot(record, teachersMap));
    
    const slots = mappedSlots.filter(slot => {
      // Filter out slots without required fields
      if (!slot.startTime || !slot.endTime || slot.startTime === '' || slot.endTime === '') {
        return false;
      }
      if (!slot.teacherId || slot.teacherId === '') {
        return false;
      }
      return true;
    });
    
    return slots;
  } catch (error) {
    throw error;
  }
}

/**
 * Get slot inventory for a date range
 */
export async function getSlotInventory(startDate: string, endDate: string): Promise<SlotInventory[]> {
  try {
    const tableId = getTableId('slotInventory');
    const teachersMap = await getTeachersMap();
    
    // Filter by date range
    const dateField = getField('slotInventory', 'תאריך_שיעור');
    const filterFormula = `AND({${dateField}} >= "${startDate}", {${dateField}} <= "${endDate}")`;
    
    const records = await airtableClient.getRecords<SlotInventoryAirtableFields>(
      tableId,
      {
        filterByFormula: filterFormula,
        maxRecords: 10000,
      }
    );
    
    return records.map(record => mapAirtableToSlotInventory(record, teachersMap));
  } catch (error) {
    throw error;
  }
}

/**
 * Find slot inventory by natural key
 */
export async function findSlotInventoryByKey(naturalKey: string): Promise<SlotInventory | null> {
  try {
    const tableId = getTableId('slotInventory');
    const teachersMap = await getTeachersMap();
    
    const records = await airtableClient.getRecords<SlotInventoryAirtableFields>(
      tableId,
      {
        filterByFormula: `{natural_key} = "${naturalKey}"`,
        maxRecords: 1,
      }
    );
    
    if (records.length === 0) {
      return null;
    }
    
    return mapAirtableToSlotInventory(records[0], teachersMap);
  } catch (error) {
    console.error('[slotManagementService] Error finding slot inventory by key:', error);
    throw error;
  }
}

/**
 * Create a slot inventory record
 */
export async function createSlotInventory(slot: {
  natural_key: string;
  teacherId: string;
  date: Date;
  startTime: string;
  endTime: string;
  createdFrom?: string; // weekly_slot record ID
  type?: string;
  status?: string;
}): Promise<SlotInventory> {
  try {
    const tableId = getTableId('slotInventory');
    const teachersMap = await getTeachersMap();
    
    const dateStr = formatDate(slot.date);
    let finalStatus = slot.status || 'open';

    // PREVENT DUPLICATES: Check for overlapping lessons before creating open slot
    if (finalStatus === 'open' || finalStatus === 'פתוח') {
      try {
        const { canOpen, conflictingLessons } = await preventSlotOpeningIfLessonsOverlap(
          slot.teacherId,
          dateStr,
          slot.startTime,
          slot.endTime
        );

        if (!canOpen) {
          // Cannot open slot - throw error instead of silently changing status
          const conflictError: any = {
            message: `לא ניתן לפתוח חלון - יש ${conflictingLessons.length} שיעור${conflictingLessons.length > 1 ? 'ים' : ''} חופף${conflictingLessons.length > 1 ? 'ים' : ''} בזמן זה`,
            code: 'CONFLICT_ERROR',
            status: 409,
            conflicts: {
              lessons: conflictingLessons,
              openSlots: [],
            },
          };
          throw conflictError;
        }
      } catch (preventError: any) {
        // Re-throw conflict errors (they should prevent slot creation)
        if (preventError.code === 'CONFLICT_ERROR') {
          throw preventError;
        }
        // Log but don't fail slot creation; keep finalStatus as 'open' so slot is created open
        // (Technical/network errors should not force slots to be created as closed.)
        console.warn(`[createSlotInventory] Failed to check for lesson overlaps before creating slot ${slot.natural_key}:`, preventError);
      }
    }
    
    const fields: Partial<SlotInventoryAirtableFields> = {
      natural_key: slot.natural_key,
      [getField('slotInventory', 'מורה')]: [slot.teacherId], // Linked record as array
      [getField('slotInventory', 'תאריך_שיעור')]: dateStr,
      [getField('slotInventory', 'שעת_התחלה')]: slot.startTime,
      [getField('slotInventory', 'שעת_סיום')]: slot.endTime,
      [getField('slotInventory', 'סטטוס')]: finalStatus === 'open' ? 'פתוח' : (finalStatus === 'closed' ? 'סגור' : finalStatus),
    };
    
    if (slot.createdFrom) {
      fields[getField('slotInventory', 'נוצר_מתוך')] = [slot.createdFrom];
    }
    
    if (slot.type) {
      // Map English type to Hebrew for Airtable
      const typeMap: Record<string, string> = {
        'private': 'פרטי',
        'pair': 'זוגי',
        'group': 'קבוצתי',
      };
      fields[getField('slotInventory', 'סוג_שיעור')] = typeMap[slot.type] || slot.type;
    }
    
    const result = await airtableClient.createRecord<SlotInventoryAirtableFields>(
      tableId,
      fields as SlotInventoryAirtableFields,
      { typecast: true } // Enable automatic option creation for Single Select fields (e.g., time fields)
    );
    
    return mapAirtableToSlotInventory(result, teachersMap);
  } catch (error) {
    throw error;
  }
}

/**
 * Create slot inventory for a specific week
 * Only creates slots for non-fixed weekly_slot entries
 */
export async function createSlotInventoryForWeek(weekStart: Date): Promise<number> {
  try {
    const weeklySlots = await getWeeklySlots();
    const nonFixedSlots = weeklySlots.filter(
      slot => !slot.isFixed && slot.status === 'active'
    );
    
    let createdCount = 0;
    
    for (const slot of nonFixedSlots) {
      // Skip slots without valid start/end times
      if (!slot.startTime || !slot.endTime || slot.startTime === '' || slot.endTime === '') {
        continue;
      }
      
      const slotDate = getDateForDayOfWeek(weekStart, slot.dayOfWeek);
      const naturalKey = generateNaturalKey(slot.teacherId, slotDate, slot.startTime);
      
      // Check if already exists (idempotency)
      const existing = await findSlotInventoryByKey(naturalKey);
      if (existing) {
        continue;
      }
      
      // Create slot inventory
      await createSlotInventory({
        natural_key: naturalKey,
        teacherId: slot.teacherId,
        date: slotDate,
        startTime: slot.startTime,
        endTime: slot.endTime,
        createdFrom: slot.id,
        type: slot.type,
        status: 'open',
      });
      
      createdCount++;
    }
    
    return createdCount;
  } catch (error) {
    throw error;
  }
}

/**
 * Find existing lesson by slot and date
 */
async function findLessonBySlotAndDate(
  slot: WeeklySlot,
  lessonDate: Date
): Promise<{ id: string } | null> {
  try {
    // Use nexusApi to search for lessons
    const dateStr = formatDate(lessonDate);
    const nexusApi = await getNexusApi();
    const lessons = await nexusApi.getLessons(dateStr, dateStr, slot.teacherId);
    
    // Check if there's a lesson at the same time
    const matchingLesson = lessons.find(lesson => {
      return lesson.date === dateStr &&
             lesson.startTime === slot.startTime &&
             lesson.teacherId === slot.teacherId;
    });
    
    return matchingLesson ? { id: matchingLesson.id } : null;
  } catch (error) {
    return null;
  }
}

/**
 * Create fixed lessons for a specific week
 * Creates lessons in the Lessons table for all weekly_slot entries with קבוע=true
 */
export async function createFixedLessonsForWeek(weekStart: Date): Promise<number> {
  try {
    const nexusApi = await getNexusApi();
    const weeklySlots = await getWeeklySlots();
    const fixedSlots = weeklySlots.filter(slot => slot.isFixed);
    
    let createdCount = 0;
    
    for (const slot of fixedSlots) {
      // Get student IDs - prefer reservedForIds, fallback to reservedFor
      const studentIds: string[] = [];
      if (slot.reservedForIds && slot.reservedForIds.length > 0) {
        studentIds.push(...slot.reservedForIds);
      } else if (slot.reservedFor) {
        studentIds.push(slot.reservedFor);
      }
      
      // Skip if no students assigned
      if (studentIds.length === 0) {
        continue;
      }
      
      // Skip slots without valid start/end times
      if (!slot.startTime || !slot.endTime || slot.startTime === '' || slot.endTime === '') {
        continue;
      }
      
      const lessonDate = getDateForDayOfWeek(weekStart, slot.dayOfWeek);
      
      // Calculate duration
      let duration = slot.durationMin;
      if (!duration && slot.startTime && slot.endTime && slot.startTime !== '' && slot.endTime !== '') {
        try {
          duration = calculateDuration(slot.startTime, slot.endTime);
        } catch (error) {
          duration = 60; // Default to 60 minutes
        }
      } else if (!duration) {
        duration = 60; // Default to 60 minutes if no time info
      }
      
      // Create lesson(s) based on type:
      // - private: one lesson per student
      // - pair: one lesson with 2 students (if exactly 2)
      // - group: one lesson with all students
      if (slot.type === 'private') {
        // Create one lesson per student for private lessons
        for (const studentId of studentIds) {
          // Check if lesson already exists (idempotency)
          const existing = await findLessonBySlotAndDate(slot, lessonDate);
          if (existing) {
            continue;
          }
          
          await nexusApi.createLesson({
            studentId: studentId,
            date: formatDate(lessonDate),
            startTime: slot.startTime || '16:00',
            duration: duration,
            status: LessonStatus.SCHEDULED,
            teacherId: slot.teacherId,
            lessonType: slot.type,
            subject: 'מתמטיקה', // Default subject
            isPrivate: true,
            weeklySlotId: slot.id,
          });
          
          createdCount++;
        }
      } else if (slot.type === 'pair') {
        // For pair lessons, create one lesson with exactly 2 students
        if (studentIds.length === 2) {
          // Check if lesson already exists (idempotency)
          const existing = await findLessonBySlotAndDate(slot, lessonDate);
          if (existing) {
            continue;
          }
          
          // Create lesson with first student (primary), studentIds array will be handled by createLesson if supported
          await nexusApi.createLesson({
            studentId: studentIds[0],
            studentIds: studentIds, // Include all students for pair/group
            date: formatDate(lessonDate),
            startTime: slot.startTime || '16:00',
            duration: duration,
            status: LessonStatus.SCHEDULED,
            teacherId: slot.teacherId,
            lessonType: slot.type,
            subject: 'מתמטיקה',
            isPrivate: false,
            price: 225, // Default pair total (each student charged 112.5 when no subscription)
            weeklySlotId: slot.id,
          });

          createdCount++;
        } else {
          console.warn(`[createFixedLessonsForWeek] Slot ${slot.id} is type 'pair' but has ${studentIds.length} students (expected 2). Skipping.`);
        }
      } else if (slot.type === 'group') {
        // For group lessons, create one lesson with all students
        if (studentIds.length > 0) {
          // Check if lesson already exists (idempotency)
          const existing = await findLessonBySlotAndDate(slot, lessonDate);
          if (existing) {
            continue;
          }
          
          // Create lesson with first student (primary), studentIds array will be handled by createLesson if supported
          await nexusApi.createLesson({
            studentId: studentIds[0],
            studentIds: studentIds, // Include all students for group
            date: formatDate(lessonDate),
            startTime: slot.startTime || '16:00',
            duration: duration,
            status: LessonStatus.SCHEDULED,
            teacherId: slot.teacherId,
            lessonType: slot.type,
            subject: 'מתמטיקה',
            isPrivate: false,
            weeklySlotId: slot.id,
            // Group: fixed 120 per student at billing - no price field
          });

          createdCount++;
        }
      }
    }
    
    return createdCount;
  } catch (error) {
    throw error;
  }
}

/**
 * Reserve a recurring lesson: create/update weekly_slot and create lesson(s) for the target date.
 * One operation that (a) creates or updates the weekly_slot template with all required fields,
 * (b) creates lesson(s) for the given week with slot linked to the weekly_slot.
 */
export async function reserveRecurringLesson(params: {
  teacherId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  type: 'private' | 'group' | 'pair';
  reservedForIds: string[];
  durationMin?: number;
  /** Week of this date is used to compute the lesson date; default current week */
  targetDate?: Date;
  /** If provided, update this weekly_slot instead of creating a new one */
  weeklySlotId?: string;
}): Promise<{ weeklySlot: WeeklySlot; lessonIds: string[] }> {
  const nexusApi = await getNexusApi();
  const targetWeekStart = getWeekStart(params.targetDate || new Date());
  const lessonDate = getDateForDayOfWeek(targetWeekStart, params.dayOfWeek);

  let weeklySlot: WeeklySlot;
  if (params.weeklySlotId) {
    weeklySlot = await updateWeeklySlot(params.weeklySlotId, {
      teacherId: params.teacherId,
      dayOfWeek: params.dayOfWeek,
      startTime: params.startTime,
      endTime: params.endTime,
      type: params.type,
      isFixed: true,
      isReserved: true,
      reservedForIds: params.reservedForIds,
      durationMin: params.durationMin,
    });
  } else {
    weeklySlot = await createWeeklySlot({
      teacherId: params.teacherId,
      dayOfWeek: params.dayOfWeek,
      startTime: params.startTime,
      endTime: params.endTime,
      type: params.type,
      isFixed: true,
      isReserved: true,
      reservedForIds: params.reservedForIds,
      durationMin: params.durationMin,
    });
  }

  const studentIds = params.reservedForIds;
  if (studentIds.length === 0) {
    return { weeklySlot, lessonIds: [] };
  }

  let duration = params.durationMin;
  if (duration == null && params.startTime && params.endTime) {
    try {
      duration = calculateDuration(params.startTime, params.endTime);
    } catch {
      duration = 60;
    }
  }
  duration = duration ?? 60;

  const lessonIds: string[] = [];

  if (params.type === 'private') {
    for (const studentId of studentIds) {
      const lesson = await nexusApi.createLesson({
        studentId,
        date: formatDate(lessonDate),
        startTime: params.startTime,
        duration,
        status: LessonStatus.SCHEDULED,
        teacherId: params.teacherId,
        lessonType: params.type,
        subject: 'מתמטיקה',
        isPrivate: true,
        weeklySlotId: weeklySlot.id,
      });
      lessonIds.push(lesson.id);
    }
  } else if (params.type === 'pair' && studentIds.length === 2) {
    const lesson = await nexusApi.createLesson({
      studentId: studentIds[0],
      studentIds,
      date: formatDate(lessonDate),
      startTime: params.startTime,
      duration,
      status: LessonStatus.SCHEDULED,
      teacherId: params.teacherId,
      lessonType: params.type,
      subject: 'מתמטיקה',
      isPrivate: false,
      price: 225,
      weeklySlotId: weeklySlot.id,
    });
    lessonIds.push(lesson.id);
  } else if (params.type === 'group' && studentIds.length > 0) {
    const lesson = await nexusApi.createLesson({
      studentId: studentIds[0],
      studentIds,
      date: formatDate(lessonDate),
      startTime: params.startTime,
      duration,
      status: LessonStatus.SCHEDULED,
      teacherId: params.teacherId,
      lessonType: params.type,
      subject: 'מתמטיקה',
      isPrivate: false,
      weeklySlotId: weeklySlot.id,
    });
    lessonIds.push(lesson.id);
  }

  return { weeklySlot, lessonIds };
}

/**
 * Update weekly slot
 */
export async function updateWeeklySlot(
  id: string,
  updates: Partial<WeeklySlot>
): Promise<WeeklySlot> {
  try {
    const tableId = getTableId('weeklySlot');
    const teachersMap = await getTeachersMap();
    
    const fields: Partial<WeeklySlotAirtableFields> = {};
    
    if (updates.dayOfWeek !== undefined) {
      // Update day_num (1-7 format) and day_of_week (Hebrew text per API spec)
      // dayOfWeek is 0-6 (0=Sunday), day_num is 1-7 (1=Sunday)
      const dayNum = updates.dayOfWeek + 1; // 0->1, 1->2, ..., 6->7
      (fields as any).day_num = dayNum;
      fields.day_of_week = DAYS_HEBREW[updates.dayOfWeek] ?? DAYS_HEBREW[0]; // Airtable: Hebrew day name (e.g. "שני")
    }
    if (updates.startTime !== undefined) {
      fields.start_time = updates.startTime;
    }
    if (updates.endTime !== undefined) {
      fields.end_time = updates.endTime;
    }
    if (updates.type !== undefined) {
      // Map English type values to Hebrew for Airtable
      const typeMap: Record<'private' | 'group' | 'pair', string> = {
        'private': 'פרטי',
        'group': 'קבוצתי',
        'pair': 'זוגי',
      };
      fields.type = typeMap[updates.type] || updates.type;
    }
    if (updates.isFixed !== undefined) {
      const fixedField = getField('weeklySlot', 'קבוע' as any);
      fields[fixedField] = updates.isFixed ? true : false;
    }
    // Handle reservedForIds (preferred) or reservedFor (backward compatibility)
    if (updates.reservedForIds !== undefined) {
      const reservedForField = getField('weeklySlot', 'reserved_for');
      fields[reservedForField] = Array.isArray(updates.reservedForIds) && updates.reservedForIds.length > 0
        ? updates.reservedForIds
        : undefined;
    } else if (updates.reservedFor !== undefined) {
      const reservedForField = getField('weeklySlot', 'reserved_for');
      // Support both single string and array of strings
      const reservedForArray = Array.isArray(updates.reservedFor) 
        ? updates.reservedFor 
        : (updates.reservedFor ? [updates.reservedFor] : []);
      fields[reservedForField] = reservedForArray.length > 0 ? reservedForArray : undefined;
    }
    // Also handle reservedForStudents as array (for multi-select support) - legacy
    if ((updates as any).reservedForStudents !== undefined) {
      const reservedForField = getField('weeklySlot', 'reserved_for');
      const reservedForArray = Array.isArray((updates as any).reservedForStudents)
        ? (updates as any).reservedForStudents
        : [];
      fields[reservedForField] = reservedForArray.length > 0 ? reservedForArray : undefined;
    }
    if (updates.durationMin !== undefined) {
      fields.duration_min = updates.durationMin;
    }
    
    const result = await airtableClient.updateRecord<WeeklySlotAirtableFields>(
      tableId,
      id,
      fields
    );
    
    return mapAirtableToWeeklySlot(result, teachersMap);
  } catch (error) {
    throw error;
  }
}

/**
 * Update slot inventory
 */
export async function updateSlotInventory(
  id: string,
  updates: Partial<SlotInventory>
): Promise<SlotInventory> {
  try {
    const tableId = getTableId('slotInventory');
    const teachersMap = await getTeachersMap();
    
    const fields: Partial<SlotInventoryAirtableFields> = {};
    
    if (updates.status !== undefined) {
      fields[getField('slotInventory', 'סטטוס')] = updates.status;
    }
    if (updates.startTime !== undefined) {
      fields[getField('slotInventory', 'שעת_התחלה')] = updates.startTime;
    }
    if (updates.endTime !== undefined) {
      fields[getField('slotInventory', 'שעת_סיום')] = updates.endTime;
    }
    
    const result = await airtableClient.updateRecord<SlotInventoryAirtableFields>(
      tableId,
      id,
      fields,
      { typecast: true } // Enable automatic option creation for Single Select fields (e.g., time fields)
    );
    
    return mapAirtableToSlotInventory(result, teachersMap);
  } catch (error) {
    throw error;
  }
}

/**
 * Create a new weekly slot
 */
export async function createWeeklySlot(slot: {
  teacherId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  type: 'private' | 'group' | 'pair';
  isFixed?: boolean;
  isReserved?: boolean;
  reservedFor?: string;
  reservedForIds?: string[];
  durationMin?: number;
}): Promise<WeeklySlot> {
  try {
    const tableId = getTableId('weeklySlot');
    const teachersMap = await getTeachersMap();
    
    // dayOfWeek is 0-6 (0=Sunday), day_num is 1-7 (1=Sunday)
    const dayNum = slot.dayOfWeek + 1; // 0->1, 1->2, ..., 6->7
    // Map English type values to Hebrew for Airtable
    const typeMap: Record<'private' | 'group' | 'pair', string> = {
      'private': 'פרטי',
      'group': 'קבוצתי',
      'pair': 'זוגי',
    };
    
    const fields: Partial<WeeklySlotAirtableFields> = {
      day_of_week: DAYS_HEBREW[slot.dayOfWeek] ?? DAYS_HEBREW[0], // Airtable: Hebrew day name (e.g. "שני")
      start_time: slot.startTime,
      end_time: slot.endTime,
      type: typeMap[slot.type] || slot.type, // Convert to Hebrew
      teacher_id: [slot.teacherId], // Linked record as array
    } as any;
    (fields as any).day_num = dayNum; // Add day_num field
    
    if (slot.durationMin !== undefined) {
      fields.duration_min = slot.durationMin;
    } else if (slot.startTime && slot.endTime && slot.startTime !== '' && slot.endTime !== '') {
      // Calculate duration if not provided and times are valid
      try {
        fields.duration_min = calculateDuration(slot.startTime, slot.endTime);
      } catch (error) {
        // Calculate default duration (60 minutes)
        fields.duration_min = 60;
      }
    } else {
      // Default duration if times are missing
      fields.duration_min = 60;
    }
    
    if (slot.isFixed !== undefined) {
      const fixedField = getField('weeklySlot', 'קבוע' as any);
      fields[fixedField] = slot.isFixed ? true : false;
    }
    
    // Handle reservedForIds (preferred) or reservedFor (backward compatibility)
    if (slot.reservedForIds !== undefined && slot.reservedForIds.length > 0) {
      const reservedForField = getField('weeklySlot', 'reserved_for');
      fields[reservedForField] = slot.reservedForIds;
    } else if (slot.reservedFor !== undefined && slot.reservedFor) {
      const reservedForField = getField('weeklySlot', 'reserved_for');
      fields[reservedForField] = [slot.reservedFor];
    }
    // is_reserved: when reserved (recurring), send "לא פנוי" for Single Select or true for Checkbox (Airtable may accept either)
    const isReservedField = getField('weeklySlot', 'is_reserved');
    if (slot.isReserved !== undefined) {
      (fields as any)[isReservedField] = slot.isReserved ? 'לא פנוי' : 'פנוי';
    } else if (slot.reservedForIds?.length || slot.reservedFor) {
      (fields as any)[isReservedField] = 'לא פנוי';
    }
    
    const result = await airtableClient.createRecord<WeeklySlotAirtableFields>(
      tableId,
      fields as WeeklySlotAirtableFields
    );
    
    return mapAirtableToWeeklySlot(result, teachersMap);
  } catch (error) {
    throw error;
  }
}

/**
 * Delete a weekly slot (hard delete from Airtable)
 * Note: This permanently deletes the record. Consider soft delete if you need recovery.
 */
export async function deleteWeeklySlot(id: string): Promise<void> {
  try {
    const tableId = getTableId('weeklySlot');
    await airtableClient.deleteRecord(tableId, id);
  } catch (error) {
    throw error;
  }
}
