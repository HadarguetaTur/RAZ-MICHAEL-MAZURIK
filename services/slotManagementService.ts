/**
 * Slot Management Service
 * Handles all operations related to weekly_slot and slot_inventory tables
 */

import { airtableClient } from './airtableClient';
import { getTableId, getField } from '../contracts/fieldMap';
import { WeeklySlot, SlotInventory } from '../types';
import { WeeklySlotAirtableFields, SlotInventoryAirtableFields, LinkedRecord } from '../contracts/types';
import { formatDate, generateNaturalKey, getDateForDayOfWeek, calculateDuration } from './dateUtils';
import { LessonStatus } from '../types';

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
  const reservedFor = fields[reservedForField] 
    ? (Array.isArray(fields[reservedForField]) ? (fields[reservedForField] as string[])[0] : (fields[reservedForField] as string))
    : undefined;
  
  const isReservedField = getField('weeklySlot', 'is_reserved');
  const isReserved = fields[isReservedField] === true || fields[isReservedField] === 1;
  
  const typeField = getField('weeklySlot', 'type');
  const type = (fields[typeField] || 'private') as 'private' | 'group' | 'pair';
  
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
    const num = typeof fields.day_of_week === 'string' ? parseInt(fields.day_of_week, 10) : fields.day_of_week;
    dayOfWeek = isNaN(num) ? 0 : Math.max(0, Math.min(6, Math.floor(num)));
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
    type: type,
    status: status,
    isFixed: isFixed,
    reservedFor: reservedFor,
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
  const rawStatus = (fields[statusField] || 'open') as string;
  // Normalize Hebrew value from Airtable to internal enum:
  // Airtable stores "סגור" for closed slots; map it to "booked" internally.
  const status = (rawStatus === 'סגור' ? 'booked' : rawStatus) as 'open' | 'booked' | 'blocked';
  
  return {
    id: record.id,
    teacherId: teacherId || '',
    teacherName: teachersMap.get(teacherId || '') || '',
    date: fields['תאריך_שיעור'],
    startTime: fields['שעת_התחלה'],
    endTime: fields['שעת_סיום'],
    status: status,
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
    const dateField = 'תאריך_שיעור';
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
    
    const fields: Partial<SlotInventoryAirtableFields> = {
      natural_key: slot.natural_key,
      'מורה': [slot.teacherId], // Linked record as array - use 'מורה' field instead of 'מזהה_מורה'
      'תאריך_שיעור': formatDate(slot.date),
      'שעת_התחלה': slot.startTime,
      'שעת_סיום': slot.endTime,
      'סטטוס': slot.status || 'open',
    };
    
    if (slot.createdFrom) {
      fields['נוצר_מתוך'] = [slot.createdFrom];
    }
    
    if (slot.type) {
      fields['סוג_שיעור'] = slot.type;
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
    const weeklySlots = await getWeeklySlots();
    const fixedSlots = weeklySlots.filter(slot => slot.isFixed);
    
    let createdCount = 0;
    
    for (const slot of fixedSlots) {
      if (!slot.reservedFor) {
        continue;
      }
      
      // Skip slots without valid start/end times
      if (!slot.startTime || !slot.endTime || slot.startTime === '' || slot.endTime === '') {
        continue;
      }
      
      const lessonDate = getDateForDayOfWeek(weekStart, slot.dayOfWeek);
      
      // Check if lesson already exists (idempotency)
      const existing = await findLessonBySlotAndDate(slot, lessonDate);
      if (existing) {
        continue;
      }
      
      // Create lesson
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
      
      await nexusApi.createLesson({
        studentId: slot.reservedFor,
        date: formatDate(lessonDate),
        startTime: slot.startTime || '16:00', // Default time if missing
        duration: duration,
        status: LessonStatus.SCHEDULED,
        teacherId: slot.teacherId,
        lessonType: slot.type,
        subject: 'מתמטיקה', // Default subject
        isPrivate: slot.type === 'private',
      });
      
      createdCount++;
    }
    
    return createdCount;
  } catch (error) {
    throw error;
  }
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
      // Update day_num (1-7 format) and day_of_week (for backward compatibility)
      // dayOfWeek is 0-6 (0=Sunday), day_num is 1-7 (1=Sunday)
      const dayNum = updates.dayOfWeek + 1; // 0->1, 1->2, ..., 6->7
      (fields as any).day_num = dayNum;
      fields.day_of_week = String(updates.dayOfWeek); // Airtable Select field expects string
    }
    if (updates.startTime !== undefined) {
      fields.start_time = updates.startTime;
    }
    if (updates.endTime !== undefined) {
      fields.end_time = updates.endTime;
    }
    if (updates.type !== undefined) {
      fields.type = updates.type;
    }
    if (updates.isFixed !== undefined) {
      const fixedField = getField('weeklySlot', 'קבוע' as any);
      fields[fixedField] = updates.isFixed ? 1 : 0;
    }
    if (updates.reservedFor !== undefined) {
      const reservedForField = getField('weeklySlot', 'reserved_for');
      // Support both single string and array of strings
      const reservedForArray = Array.isArray(updates.reservedFor) 
        ? updates.reservedFor 
        : (updates.reservedFor ? [updates.reservedFor] : []);
      fields[reservedForField] = reservedForArray.length > 0 ? reservedForArray : undefined;
    }
    // Also handle reservedForStudents as array (for multi-select support)
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
      fields['סטטוס'] = updates.status;
    }
    if (updates.startTime !== undefined) {
      fields['שעת_התחלה'] = updates.startTime;
    }
    if (updates.endTime !== undefined) {
      fields['שעת_סיום'] = updates.endTime;
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
  reservedFor?: string;
  durationMin?: number;
}): Promise<WeeklySlot> {
  try {
    const tableId = getTableId('weeklySlot');
    const teachersMap = await getTeachersMap();
    
    // dayOfWeek is 0-6 (0=Sunday), day_num is 1-7 (1=Sunday)
    const dayNum = slot.dayOfWeek + 1; // 0->1, 1->2, ..., 6->7
    const fields: Partial<WeeklySlotAirtableFields> = {
      day_of_week: String(slot.dayOfWeek), // Airtable Select field expects string
      start_time: slot.startTime,
      end_time: slot.endTime,
      type: slot.type,
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
      fields[fixedField] = slot.isFixed ? 1 : 0;
    }
    
    if (slot.reservedFor !== undefined && slot.reservedFor) {
      const reservedForField = getField('weeklySlot', 'reserved_for');
      fields[reservedForField] = [slot.reservedFor];
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
