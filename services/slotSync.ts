/**
 * Slot Sync Engine
 * 
 * Synchronizes weekly_slot templates with slot_inventory dated slots.
 * Keeps slot_inventory filled X days ahead, starting from the nearest Sunday.
 * Prevents duplicates and overlaps, and respects manual changes.
 */

import { WeeklySlotAirtableFields, SlotInventoryAirtableFields, LinkedRecord } from '../contracts/types';
import { formatDate, getWeekStart, getDateForDayOfWeek, addWeeks } from './dateUtils';
import { getField } from '../contracts/fieldMap';

/**
 * ============================================================================
 * TYPES
 * ============================================================================
 */

export interface WeeklySlotTemplate {
  id: string;
  teacherId: string;
  dayOfWeek: number; // 0-6 (0 = Sunday)
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  type?: string;
  durationMin?: number;
  isActive?: boolean; // Whether template is active (not deleted/disabled)
}

export interface GeneratedSlot {
  naturalKey: string;
  teacherId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  type?: string;
  durationMin?: number;
  createdFrom: string; // weekly_slot record ID
  dayOfWeek: number;
}

export interface ExistingSlotInventory {
  id: string;
  naturalKey: string;
  teacherId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  startDT?: string; // ISO datetime string (from formula)
  endDT?: string; // ISO datetime string (from formula)
  isLocked?: boolean;
  hasLessons?: boolean; // true if lessons field is not empty
  isBlock?: boolean; // from is_block formula
  createdFrom?: string; // weekly_slot record ID
  status?: string;
}

export interface OverlapReport {
  overlaps: Array<{
    slot1: ExistingSlotInventory;
    slot2: ExistingSlotInventory;
    reason: string;
  }>;
}

export interface InventoryDiff {
  toCreate: GeneratedSlot[];
  toUpdate: Array<{
    existing: ExistingSlotInventory;
    generated: GeneratedSlot;
  }>;
  toDeactivate: ExistingSlotInventory[];
}

/**
 * ============================================================================
 * PURE FUNCTIONS
 * ============================================================================
 */

/**
 * Build template key for a weekly slot template
 * Format: teacherId|dayOfWeek|startTime
 */
export function buildTemplateKey(
  teacherId: string,
  dayOfWeek: number,
  startTime: string
): string {
  if (!teacherId || dayOfWeek === undefined || !startTime) {
    throw new Error(`buildTemplateKey: missing required parameters. teacherId=${teacherId}, dayOfWeek=${dayOfWeek}, startTime=${startTime}`);
  }
  return `${teacherId}|${dayOfWeek}|${startTime}`;
}

/**
 * Build natural key for slot inventory
 * Format: teacherId|YYYY-MM-DD|HH:mm
 */
export function buildNaturalKey(
  teacherId: string,
  dateYmd: string,
  startTime: string
): string {
  if (!teacherId || !dateYmd || !startTime) {
    throw new Error(`buildNaturalKey: missing required parameters. teacherId=${teacherId}, dateYmd=${dateYmd}, startTime=${startTime}`);
  }
  return `${teacherId}|${dateYmd}|${startTime}`;
}

/**
 * Generate inventory slots from weekly slot templates
 * @param templates - Array of weekly slot templates
 * @param startDate - Start date (will be adjusted to nearest Sunday)
 * @param daysAhead - Number of days ahead to generate (default 14)
 * @returns Array of generated slots
 */
export function generateInventoryFromTemplates(
  templates: WeeklySlotTemplate[],
  startDate: Date,
  daysAhead: number = 14
): GeneratedSlot[] {
  const generated: GeneratedSlot[] = [];
  const weekStart = getWeekStart(startDate);
  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + daysAhead);

  // Filter active templates only
  const activeTemplates = templates.filter(t => t.isActive !== false);

  for (const template of activeTemplates) {
    if (!template.teacherId || template.dayOfWeek === undefined || !template.startTime || !template.endTime) {
      console.warn(`[slotSync] Skipping invalid template ${template.id}: missing required fields`);
      continue;
    }

    // Generate slots for each occurrence of this template within the date range
    let currentDate = new Date(weekStart);
    let currentDayOfWeek = currentDate.getDay(); // 0 = Sunday

    // Find first occurrence of this day of week
    let daysUntilFirst = (template.dayOfWeek - currentDayOfWeek + 7) % 7;
    currentDate.setDate(currentDate.getDate() + daysUntilFirst);

    // Generate slots for all occurrences within the range
    while (currentDate <= endDate) {
      const dateStr = formatDate(currentDate);
      const naturalKey = buildNaturalKey(template.teacherId, dateStr, template.startTime);

      generated.push({
        naturalKey,
        teacherId: template.teacherId,
        date: dateStr,
        startTime: template.startTime,
        endTime: template.endTime,
        type: template.type,
        durationMin: template.durationMin,
        createdFrom: template.id,
        dayOfWeek: template.dayOfWeek,
      });

      // Move to next week
      currentDate.setDate(currentDate.getDate() + 7);
    }
  }

  return generated;
}

/**
 * Detect time overlaps for slots on the same date and teacher
 * Uses StartDT and EndDT for accurate overlap detection
 */
export function detectOverlaps(
  existingSlotsForDate: ExistingSlotInventory[]
): OverlapReport {
  const overlaps: OverlapReport['overlaps'] = [];

  // Group by teacher and date
  const byTeacherAndDate = new Map<string, ExistingSlotInventory[]>();
  for (const slot of existingSlotsForDate) {
    const key = `${slot.teacherId}|${slot.date}`;
    if (!byTeacherAndDate.has(key)) {
      byTeacherAndDate.set(key, []);
    }
    byTeacherAndDate.get(key)!.push(slot);
  }

  // Check overlaps within each group
  for (const [key, slots] of byTeacherAndDate) {
    // Sort by start time
    const sorted = [...slots].sort((a, b) => {
      const aStart = a.startDT ? new Date(a.startDT).getTime() : parseTime(a.startTime);
      const bStart = b.startDT ? new Date(b.startDT).getTime() : parseTime(b.startTime);
      return aStart - bStart;
    });

    // Check each pair
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const slot1 = sorted[i];
        const slot2 = sorted[j];

        if (hasOverlap(slot1, slot2)) {
          overlaps.push({
            slot1,
            slot2,
            reason: `Time overlap detected: ${slot1.startTime}-${slot1.endTime} overlaps with ${slot2.startTime}-${slot2.endTime}`,
          });
        }
      }
    }
  }

  return { overlaps };
}

/**
 * Helper: Check if two slots overlap in time
 */
function hasOverlap(slot1: ExistingSlotInventory, slot2: ExistingSlotInventory): boolean {
  // Use StartDT/EndDT if available (more accurate), otherwise use time strings
  let start1: number, end1: number, start2: number, end2: number;

  if (slot1.startDT && slot1.endDT && slot2.startDT && slot2.endDT) {
    start1 = new Date(slot1.startDT).getTime();
    end1 = new Date(slot1.endDT).getTime();
    start2 = new Date(slot2.startDT).getTime();
    end2 = new Date(slot2.endDT).getTime();
  } else {
    // Fallback to time strings (less accurate, doesn't account for date)
    start1 = parseTime(slot1.startTime);
    end1 = parseTime(slot1.endTime);
    start2 = parseTime(slot2.startTime);
    end2 = parseTime(slot2.endTime);
  }

  // Overlap if: start1 < end2 && start2 < end1
  return start1 < end2 && start2 < end1;
}

/**
 * Helper: Parse time string (HH:mm) to minutes since midnight
 */
function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Check if a slot is protected from updates
 * Protected if: is_locked=true OR lessons is not empty OR is_block=true
 */
export function isSlotProtected(slot: ExistingSlotInventory): boolean {
  if (slot.isLocked === true || slot.isLocked === 1) {
    return true;
  }
  if (slot.hasLessons === true) {
    return true;
  }
  if (slot.isBlock === true) {
    return true;
  }
  return false;
}

/**
 * Diff existing inventory against generated slots
 * Determines what to create, update, or deactivate
 */
export function diffInventory(
  existingInventory: ExistingSlotInventory[],
  generated: GeneratedSlot[],
  activeTemplateIds: Set<string>
): InventoryDiff {
  const result: InventoryDiff = {
    toCreate: [],
    toUpdate: [],
    toDeactivate: [],
  };

  // Build map of existing inventory by natural key
  const existingByKey = new Map<string, ExistingSlotInventory>();
  for (const slot of existingInventory) {
    existingByKey.set(slot.naturalKey, slot);
  }

  // Build set of generated natural keys
  const generatedKeys = new Set(generated.map(g => g.naturalKey));

  // Find slots to create (in generated but not in existing)
  for (const gen of generated) {
    if (!existingByKey.has(gen.naturalKey)) {
      result.toCreate.push(gen);
    }
  }

  // Find slots to update (in both, but not protected)
  for (const gen of generated) {
    const existing = existingByKey.get(gen.naturalKey);
    if (existing && !isSlotProtected(existing)) {
      // Check if update is needed (compare key fields)
      const needsUpdate =
        existing.teacherId !== gen.teacherId ||
        existing.date !== gen.date ||
        existing.startTime !== gen.startTime ||
        existing.endTime !== gen.endTime ||
        existing.createdFrom !== gen.createdFrom;

      if (needsUpdate) {
        result.toUpdate.push({ existing, generated: gen });
      }
    }
  }

  // Find slots to deactivate (in existing but not in generated, and from inactive templates)
  for (const existing of existingInventory) {
    if (!generatedKeys.has(existing.naturalKey)) {
      // Check if this slot was created from a template that is now inactive
      if (existing.createdFrom && !activeTemplateIds.has(existing.createdFrom)) {
        // Only deactivate if not protected
        if (!isSlotProtected(existing)) {
          result.toDeactivate.push(existing);
        }
      }
    }
  }

  return result;
}

/**
 * ============================================================================
 * RUNNER FUNCTION
 * ============================================================================
 */

import { airtableClient } from './airtableClient';
import { getTableId } from '../contracts/fieldMap';

/**
 * Sync options
 */
export interface SyncSlotsOptions {
  startDate?: Date; // Default: today
  daysAhead?: number; // Default: 14
  teacherId?: string; // Optional: filter by teacher
}

/**
 * Sync slots from weekly_slot templates to slot_inventory
 */
export async function syncSlots(options: SyncSlotsOptions = {}): Promise<{
  created: number;
  updated: number;
  deactivated: number;
  errors: Array<{ slot: string; error: string }>;
}> {
  const startDate = options.startDate || new Date();
  const daysAhead = options.daysAhead || 14;
  const teacherId = options.teacherId;

  console.log(`[slotSync] Starting sync: startDate=${formatDate(startDate)}, daysAhead=${daysAhead}, teacherId=${teacherId || 'all'}`);

  const errors: Array<{ slot: string; error: string }> = [];
  let created = 0;
  let updated = 0;
  let deactivated = 0;

  try {
    // 1. Load weekly_slot templates
    console.log('[slotSync] Loading weekly_slot templates...');
    const weeklySlotTableId = getTableId('weeklySlot');
    const teacherIdField = getField('weeklySlot', 'teacher_id');
    const dayOfWeekField = getField('weeklySlot', 'day_of_week');
    const startTimeField = getField('weeklySlot', 'start_time');
    const endTimeField = getField('weeklySlot', 'end_time');
    const typeField = getField('weeklySlot', 'type');
    const durationMinField = getField('weeklySlot', 'duration_min');

    let filterFormula: string | undefined;
    if (teacherId) {
      filterFormula = `{${teacherIdField}} = "${teacherId}"`;
    }

    const templateRecords = await airtableClient.getRecords<WeeklySlotAirtableFields>(
      weeklySlotTableId,
      {
        filterByFormula: filterFormula,
        maxRecords: 1000,
      }
    );

    const templates: WeeklySlotTemplate[] = templateRecords.map(record => {
      const fields = record.fields;
      const teacherIdValue = Array.isArray(fields[teacherIdField])
        ? (fields[teacherIdField] as string[])[0]
        : (fields[teacherIdField] as string);

      const dayOfWeekValue = typeof fields[dayOfWeekField] === 'string'
        ? parseInt(fields[dayOfWeekField], 10)
        : fields[dayOfWeekField];

      return {
        id: record.id,
        teacherId: teacherIdValue || '',
        dayOfWeek: dayOfWeekValue as number,
        startTime: fields[startTimeField] || '',
        endTime: fields[endTimeField] || '',
        type: fields[typeField] || undefined,
        durationMin: fields[durationMinField] || undefined,
        isActive: true, // Assume active unless we have a status field
      };
    }).filter(t => t.teacherId && t.startTime && t.endTime);

    console.log(`[slotSync] Loaded ${templates.length} templates`);

    // Build set of active template IDs
    const activeTemplateIds = new Set(templates.map(t => t.id));

    // 2. Generate inventory from templates
    console.log('[slotSync] Generating inventory from templates...');
    const generated = generateInventoryFromTemplates(templates, startDate, daysAhead);
    console.log(`[slotSync] Generated ${generated.length} slots`);

    // 3. Load existing slot_inventory in date range
    console.log('[slotSync] Loading existing slot_inventory...');
    const weekStart = getWeekStart(startDate);
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + daysAhead);

    const slotInventoryTableId = getTableId('slotInventory');
    // Use field names matching TypeScript interface (consistent with slotManagementService)
    const dateField = 'תאריך_שיעור'; // For filter formulas
    const naturalKeyField = 'natural_key';
    // Use the 'מורה' Linked Record field instead of 'מזהה_מורה' text field
    const teacherIdInventoryField = getField('slotInventory', 'מורה');
    const startTimeInventoryField = 'שעת_התחלה'; // TypeScript interface key
    const endTimeInventoryField = 'שעת_סיום'; // TypeScript interface key
    const createdFromField = 'נוצר_מתוך'; // TypeScript interface key
    const isLockedField = 'is_locked'; // TypeScript interface key
    const lessonsField = 'lessons'; // TypeScript interface key
    const studentsField = 'תלמידים'; // Alternative field name
    const statusField = 'סטטוס'; // TypeScript interface key

    let inventoryFilter = `AND({${dateField}} >= "${formatDate(weekStart)}", {${dateField}} <= "${formatDate(endDate)}")`;
    if (teacherId) {
      inventoryFilter = `AND(${inventoryFilter}, {${teacherIdInventoryField}} = "${teacherId}")`;
    }

    const inventoryRecords = await airtableClient.getRecords<SlotInventoryAirtableFields>(
      slotInventoryTableId,
      {
        filterByFormula: inventoryFilter,
        maxRecords: 10000,
      }
    );

    const existingInventory: ExistingSlotInventory[] = inventoryRecords.map(record => {
      const fields = record.fields;
      const teacherIdValue = Array.isArray(fields[teacherIdInventoryField])
        ? (fields[teacherIdInventoryField] as string[])[0]
        : (fields[teacherIdInventoryField] as string);

      const createdFromValue = Array.isArray(fields[createdFromField])
        ? (fields[createdFromField] as string[])[0]
        : (fields[createdFromField] as string);

      const lessonsValue = fields[lessonsField] || fields[studentsField];
      const hasLessons = Array.isArray(lessonsValue) ? lessonsValue.length > 0 : !!lessonsValue;

      return {
        id: record.id,
        naturalKey: fields[naturalKeyField] || '',
        teacherId: teacherIdValue || '',
        date: fields[dateField] || '',
        startTime: fields[startTimeInventoryField] || '',
        endTime: fields[endTimeInventoryField] || '',
        startDT: fields.StartDT,
        endDT: fields.EndDT,
        isLocked: fields[isLockedField] === true || fields[isLockedField] === 1,
        hasLessons,
        isBlock: fields.is_block === true,
        createdFrom: createdFromValue,
        status: fields[statusField] || undefined,
      };
    });

    console.log(`[slotSync] Loaded ${existingInventory.length} existing inventory records`);

    // 4. Detect overlaps
    console.log('[slotSync] Detecting overlaps...');
    const overlapReport = detectOverlaps(existingInventory);
    if (overlapReport.overlaps.length > 0) {
      console.warn(`[slotSync] WARNING: Found ${overlapReport.overlaps.length} overlaps:`);
      overlapReport.overlaps.forEach(overlap => {
        console.warn(`[slotSync]   - ${overlap.reason} (${overlap.slot1.naturalKey} vs ${overlap.slot2.naturalKey})`);
      });
    }

    // 5. Diff inventory
    console.log('[slotSync] Computing diff...');
    const diff = diffInventory(existingInventory, generated, activeTemplateIds);
    console.log(`[slotSync] Diff: ${diff.toCreate.length} to create, ${diff.toUpdate.length} to update, ${diff.toDeactivate.length} to deactivate`);

    // 6. Create missing slots
    console.log('[slotSync] Creating missing slots...');
    for (const gen of diff.toCreate) {
      try {
        const fields: Partial<SlotInventoryAirtableFields> = {
          natural_key: gen.naturalKey,
          'מורה': [gen.teacherId], // Use 'מורה' Linked Record field instead of 'מזהה_מורה'
          'תאריך_שיעור': gen.date,
          'שעת_התחלה': gen.startTime,
          'שעת_סיום': gen.endTime,
          'נוצר_מתוך': [gen.createdFrom],
        };

        if (gen.type) {
          fields['סוג שיעור'] = gen.type;
        }

        await airtableClient.createRecord<SlotInventoryAirtableFields>(
          slotInventoryTableId,
          fields as SlotInventoryAirtableFields,
          { typecast: true } // Enable automatic option creation for Single Select fields (e.g., time fields)
        );

        created++;
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        console.error(`[slotSync] Error creating slot ${gen.naturalKey}:`, errorMsg);
        errors.push({ slot: gen.naturalKey, error: errorMsg });
      }
    }

    // 7. Update safe slots
    console.log('[slotSync] Updating safe slots...');
    for (const { existing, generated: gen } of diff.toUpdate) {
      try {
        const fields: Partial<SlotInventoryAirtableFields> = {
          'מורה': [gen.teacherId], // Use 'מורה' Linked Record field instead of 'מזהה_מורה'
          'תאריך_שיעור': gen.date,
          'שעת_התחלה': gen.startTime,
          'שעת_סיום': gen.endTime,
          'נוצר_מתוך': [gen.createdFrom],
        };

        if (gen.type) {
          fields['סוג_שיעור'] = gen.type;
        }

        await airtableClient.updateRecord<SlotInventoryAirtableFields>(
          slotInventoryTableId,
          existing.id,
          fields,
          { typecast: true } // Enable automatic option creation for Single Select fields (e.g., time fields)
        );

        updated++;
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        console.error(`[slotSync] Error updating slot ${existing.naturalKey}:`, errorMsg);
        errors.push({ slot: existing.naturalKey, error: errorMsg });
      }
    }

    // 8. Deactivate orphaned slots (from deleted/disabled templates)
    console.log('[slotSync] Deactivating orphaned slots...');
    for (const existing of diff.toDeactivate) {
      try {
        await airtableClient.updateRecord<SlotInventoryAirtableFields>(
          slotInventoryTableId,
          existing.id,
          {
            'סטטוס': 'blocked', // Deactivate by setting status to blocked (field name matches TypeScript interface)
          },
          { typecast: true } // Enable automatic option creation for Single Select fields
        );

        deactivated++;
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        console.error(`[slotSync] Error deactivating slot ${existing.naturalKey}:`, errorMsg);
        errors.push({ slot: existing.naturalKey, error: errorMsg });
      }
    }

    console.log(`[slotSync] Sync complete: ${created} created, ${updated} updated, ${deactivated} deactivated, ${errors.length} errors`);

    return { created, updated, deactivated, errors };
  } catch (error: any) {
    console.error('[slotSync] Fatal error during sync:', error);
    throw error;
  }
}
