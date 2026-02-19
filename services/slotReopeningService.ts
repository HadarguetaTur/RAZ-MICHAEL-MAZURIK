/**
 * Service to reopen slot_inventory when a linked lesson is cancelled
 */

import { airtableClient } from './airtableClient';
import { getTableId, getField } from '../contracts/fieldMap';
import { SlotInventoryAirtableFields } from '../contracts/types';
import { invalidateSlotInventory } from '../data/resources/slotInventory';

/**
 * Reopen slot_inventory records linked to a cancelled lesson
 * If a lesson is cancelled and it was linked to slot_inventory, reopen the slot
 * 
 * @param lessonId - The ID of the cancelled lesson
 * @returns Array of slot IDs that were reopened
 */
export async function reopenSlotsForCancelledLesson(lessonId: string): Promise<string[]> {
  try {
    
    const slotTableId = getTableId('slotInventory');
    const lessonsField = getField('slotInventory', 'lessons');
    const statusField = 'סטטוס';
    
    // Find all slot_inventory records that have this lesson linked
    // Strategy: Fetch all slots that have any lessons linked, then filter in memory
    // This avoids Airtable filter formula issues with linked record arrays
    const escapedLessonId = lessonId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    
    // Try filter formula first, but if it doesn't work, we'll fetch all slots with lessons
    const filterFormula = `FIND("${escapedLessonId}", ARRAYJOIN({${lessonsField}}, ",")) > 0`;
    
    
    let slots: Array<{ id: string; fields: SlotInventoryAirtableFields }>;
    
    try {
      // Try using filter formula first
      slots = await airtableClient.getRecords<SlotInventoryAirtableFields>(
        slotTableId,
        {
          filterByFormula: filterFormula,
          maxRecords: 100,
        }
      );
      
      // If filter didn't find anything, try fetching all slots with non-empty lessons field
      if (slots.length === 0) {
        
        // Fetch all slots that have any lessons linked (non-empty lessons field)
        const allSlotsWithLessons = await airtableClient.getRecords<SlotInventoryAirtableFields>(
          slotTableId,
          {
            filterByFormula: `LEN(ARRAYJOIN({${lessonsField}}, ",")) > 0`,
            maxRecords: 1000, // Increase limit for fallback
          }
        );
        
        // Filter in memory to find slots that have this specific lesson
        slots = allSlotsWithLessons.filter(slot => {
          const linkedLessons = slot.fields[lessonsField] || slot.fields.lessons;
          if (!linkedLessons) return false;
          
          let lessonIds: string[] = [];
          if (Array.isArray(linkedLessons)) {
            lessonIds = linkedLessons.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
          } else if (linkedLessons) {
            lessonIds = [typeof linkedLessons === 'string' ? linkedLessons : linkedLessons.id].filter(Boolean);
          }
          
          return lessonIds.includes(lessonId);
        });
      }
    } catch (filterError: any) {
      // If filter formula fails, fallback to fetching all slots with lessons and filtering in memory
      
      const allSlotsWithLessons = await airtableClient.getRecords<SlotInventoryAirtableFields>(
        slotTableId,
        {
          filterByFormula: `LEN(ARRAYJOIN({${lessonsField}}, ",")) > 0`,
          maxRecords: 1000,
        }
      );
      
      // Filter in memory
      slots = allSlotsWithLessons.filter(slot => {
        const linkedLessons = slot.fields[lessonsField] || slot.fields.lessons;
        if (!linkedLessons) return false;
        
        let lessonIds: string[] = [];
        if (Array.isArray(linkedLessons)) {
          lessonIds = linkedLessons.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
        } else if (linkedLessons) {
          lessonIds = [typeof linkedLessons === 'string' ? linkedLessons : linkedLessons.id].filter(Boolean);
        }
        
        return lessonIds.includes(lessonId);
      });
    }
    
    
    if (slots.length === 0) {
      return [];
    }
    
    const reopenedSlotIds: string[] = [];
    
    // Process each slot
    for (const slot of slots) {
      const fields = slot.fields;
      const linkedLessons = fields[lessonsField] || fields.lessons;
      
      // Extract lesson IDs from linked lessons field
      let lessonIds: string[] = [];
      if (Array.isArray(linkedLessons)) {
        lessonIds = linkedLessons.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
      } else if (linkedLessons) {
        lessonIds = [typeof linkedLessons === 'string' ? linkedLessons : linkedLessons.id].filter(Boolean);
      }
      
      // Remove the cancelled lesson from the list
      const remainingLessons = lessonIds.filter(id => id !== lessonId);
      
      // Prepare update fields
      const updateFields: Partial<SlotInventoryAirtableFields> = {};
      
      // Update lessons field - remove the cancelled lesson
      if (lessonsField) {
        (updateFields as any)[lessonsField] = remainingLessons;
      }
      
      // If no lessons remain, reopen the slot
      if (remainingLessons.length === 0) {
        updateFields[statusField as keyof SlotInventoryAirtableFields] = 'פתוח' as any;
        
      } else {
        // Still has other lessons, keep it closed but update the lessons list
      }
      
      // Update the slot
      try {
        await airtableClient.updateRecord<SlotInventoryAirtableFields>(
          slotTableId,
          slot.id,
          updateFields,
          { typecast: true }
        );
        
        if (remainingLessons.length === 0) {
          reopenedSlotIds.push(slot.id);
        }
        
      } catch (updateError: any) {
        console.error(`[reopenSlotsForCancelledLesson] Failed to update slot ${slot.id}:`, updateError);
        // Continue with other slots even if one fails
      }
    }
    
    // Invalidate cache for slot inventory
    if (reopenedSlotIds.length > 0 || slots.length > 0) {
      invalidateSlotInventory();
    }
    
    
    return reopenedSlotIds;
  } catch (error) {
    console.error(`[reopenSlotsForCancelledLesson] Error reopening slots for lesson ${lessonId}:`, error);
    // Don't throw - this is a side effect, shouldn't fail lesson cancellation
    return [];
  }
}
