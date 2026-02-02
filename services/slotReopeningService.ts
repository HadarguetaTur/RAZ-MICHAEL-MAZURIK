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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:17',message:'reopenSlotsForCancelledLesson entry',data:{lessonId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
  // #endregion
  try {
    if (import.meta.env.DEV) {
      console.log(`[reopenSlotsForCancelledLesson] Starting - looking for slots linked to lesson ${lessonId}`);
    }
    
    const slotTableId = getTableId('slotInventory');
    const lessonsField = getField('slotInventory', 'lessons');
    const statusField = 'סטטוס';
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:26',message:'Got field names',data:{slotTableId,lessonsField,statusField},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    
    // Find all slot_inventory records that have this lesson linked
    // Strategy: Fetch all slots that have any lessons linked, then filter in memory
    // This avoids Airtable filter formula issues with linked record arrays
    const escapedLessonId = lessonId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    
    // Try filter formula first, but if it doesn't work, we'll fetch all slots with lessons
    const filterFormula = `FIND("${escapedLessonId}", ARRAYJOIN({${lessonsField}}, ",")) > 0`;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:32',message:'Before searching slots',data:{lessonId,escapedLessonId,filterFormula,lessonsField},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    
    if (import.meta.env.DEV) {
      console.log(`[reopenSlotsForCancelledLesson] Filter formula: ${filterFormula}`);
    }
    
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
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:49',message:'After searching slots with filter',data:{lessonId,slotsFound:slots.length,slotIds:slots.map(s=>s.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      
      // If filter didn't find anything, try fetching all slots with non-empty lessons field
      if (slots.length === 0) {
        if (import.meta.env.DEV) {
          console.log(`[reopenSlotsForCancelledLesson] Filter returned 0 results, trying alternative: fetch all slots with lessons`);
        }
        
        // Fetch all slots that have any lessons linked (non-empty lessons field)
        const allSlotsWithLessons = await airtableClient.getRecords<SlotInventoryAirtableFields>(
          slotTableId,
          {
            filterByFormula: `LEN(ARRAYJOIN({${lessonsField}}, ",")) > 0`,
            maxRecords: 1000, // Increase limit for fallback
          }
        );
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:62',message:'Fetched all slots with lessons (fallback)',data:{lessonId,allSlotsWithLessonsCount:allSlotsWithLessons.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
        
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
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:78',message:'After filtering in memory',data:{lessonId,slotsFound:slots.length,slotIds:slots.map(s=>s.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
      }
    } catch (filterError: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:85',message:'Filter formula error, trying fallback',data:{lessonId,filterError:filterError?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      
      // If filter formula fails, fallback to fetching all slots with lessons and filtering in memory
      if (import.meta.env.DEV) {
        console.log(`[reopenSlotsForCancelledLesson] Filter formula failed, using fallback:`, filterError);
      }
      
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
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:110',message:'Final slots found',data:{lessonId,slotsFound:slots.length,slotIds:slots.map(s=>s.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    
    if (import.meta.env.DEV) {
      console.log(`[reopenSlotsForCancelledLesson] Found ${slots.length} slot(s) linked to lesson ${lessonId}`);
    }
    
    if (slots.length === 0) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:50',message:'No slots found - returning empty array',data:{lessonId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      if (import.meta.env.DEV) {
        console.log(`[reopenSlotsForCancelledLesson] No slots found linked to lesson ${lessonId}`);
      }
      return [];
    }
    
    const reopenedSlotIds: string[] = [];
    
    // Process each slot
    for (const slot of slots) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:55',message:'Processing slot',data:{slotId:slot.id,lessonId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      const fields = slot.fields;
      const linkedLessons = fields[lessonsField] || fields.lessons;
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:59',message:'Extracted linked lessons',data:{slotId:slot.id,linkedLessons,linkedLessonsType:typeof linkedLessons,linkedLessonsIsArray:Array.isArray(linkedLessons)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      
      // Extract lesson IDs from linked lessons field
      let lessonIds: string[] = [];
      if (Array.isArray(linkedLessons)) {
        lessonIds = linkedLessons.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
      } else if (linkedLessons) {
        lessonIds = [typeof linkedLessons === 'string' ? linkedLessons : linkedLessons.id].filter(Boolean);
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:68',message:'Extracted lesson IDs',data:{slotId:slot.id,lessonIds,lessonIdsCount:lessonIds.length,lessonIdToRemove:lessonId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      
      // Remove the cancelled lesson from the list
      const remainingLessons = lessonIds.filter(id => id !== lessonId);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:72',message:'After removing cancelled lesson',data:{slotId:slot.id,remainingLessons,remainingLessonsCount:remainingLessons.length,willReopen:remainingLessons.length === 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      
      // Prepare update fields
      const updateFields: Partial<SlotInventoryAirtableFields> = {};
      
      // Update lessons field - remove the cancelled lesson
      if (lessonsField) {
        (updateFields as any)[lessonsField] = remainingLessons;
      }
      
      // If no lessons remain, reopen the slot
      if (remainingLessons.length === 0) {
        updateFields[statusField as keyof SlotInventoryAirtableFields] = 'פתוח' as any;
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:82',message:'Will reopen slot - no lessons remain',data:{slotId:slot.id,updateFields},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
        // #endregion
        
        if (import.meta.env.DEV) {
          console.log(`[reopenSlotsForCancelledLesson] Reopening slot ${slot.id} - no lessons remain`);
        }
      } else {
        // Still has other lessons, keep it closed but update the lessons list
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:88',message:'Will update slot but keep closed - other lessons remain',data:{slotId:slot.id,remainingLessonsCount:remainingLessons.length,updateFields},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
        // #endregion
        if (import.meta.env.DEV) {
          console.log(`[reopenSlotsForCancelledLesson] Updating slot ${slot.id} - ${remainingLessons.length} lesson(s) remain`);
        }
      }
      
      // Update the slot
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:96',message:'Before updating slot',data:{slotId:slot.id,updateFields,updateFieldsKeys:Object.keys(updateFields)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        
        await airtableClient.updateRecord<SlotInventoryAirtableFields>(
          slotTableId,
          slot.id,
          updateFields,
          { typecast: true }
        );
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:105',message:'After updating slot - success',data:{slotId:slot.id,remainingLessonsCount:remainingLessons.length,wasReopened:remainingLessons.length === 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        
        if (remainingLessons.length === 0) {
          reopenedSlotIds.push(slot.id);
        }
        
        if (import.meta.env.DEV) {
          console.log(`[reopenSlotsForCancelledLesson] Updated slot ${slot.id}`);
        }
      } catch (updateError: any) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:115',message:'Error updating slot',data:{slotId:slot.id,updateError:updateError?.message,updateErrorStatus:updateError?.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        console.error(`[reopenSlotsForCancelledLesson] Failed to update slot ${slot.id}:`, updateError);
        // Continue with other slots even if one fails
      }
    }
    
    // Invalidate cache for slot inventory
    if (reopenedSlotIds.length > 0 || slots.length > 0) {
      invalidateSlotInventory();
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:123',message:'reopenSlotsForCancelledLesson completed',data:{lessonId,slotsProcessed:slots.length,reopenedSlotsCount:reopenedSlotIds.length,reopenedSlotIds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    
    if (import.meta.env.DEV) {
      console.log(`[reopenSlotsForCancelledLesson] Processed ${slots.length} slot(s), reopened ${reopenedSlotIds.length}`);
    }
    
    return reopenedSlotIds;
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotReopeningService.ts:132',message:'Error in reopenSlotsForCancelledLesson',data:{lessonId,error:error?.message,errorStack:error?.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    console.error(`[reopenSlotsForCancelledLesson] Error reopening slots for lesson ${lessonId}:`, error);
    // Don't throw - this is a side effect, shouldn't fail lesson cancellation
    return [];
  }
}
