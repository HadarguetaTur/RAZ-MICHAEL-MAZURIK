import { airtableClient } from './airtableClient';
import { getTableId, getField } from '../contracts/fieldMap';
import { nexusApi } from './nexusApi';
import {
  Lesson,
  SlotInventory,
  LessonStatus,
} from '../types';
import { SlotInventoryAirtableFields } from '../contracts/types';
import { invalidateLessons } from '../data/resources/lessons';
import { invalidateSlotInventory } from '../data/resources/slotInventory';

/**
 * Helper: Find default teacher "רז" by name or teacher_id "1"
 * Returns Airtable record ID (starts with "rec")
 */
async function findDefaultTeacher(): Promise<string | null> {
  try {
    const teachersTableId = getTableId('teachers');
    const teacherIdField = getField('teachers', 'teacher_id');
    const fullNameField = getField('teachers', 'full_name');
    
    // Try to find by teacher_id = 1 or "1" first
    // Airtable autonumber fields can be compared as numbers or strings
    const recordsById = await airtableClient.getRecords<{ teacher_id?: string | number; full_name?: string }>(
      teachersTableId,
      {
        filterByFormula: `OR({${teacherIdField}} = 1, {${teacherIdField}} = "1")`,
        maxRecords: 1,
      }
    );
    
    if (recordsById.length > 0) {
      return recordsById[0].id;
    }
    
    // Fallback: try to find by name containing "רז"
    const recordsByName = await airtableClient.getRecords<{ teacher_id?: string | number; full_name?: string }>(
      teachersTableId,
      {
        filterByFormula: `FIND("רז", {${fullNameField}}) > 0`,
        maxRecords: 10,
      }
    );
    
    // Find exact match "רז" or starts with "רז"
    for (const record of recordsByName) {
      const name = record.fields[fullNameField] || '';
      if (name === 'רז' || name.startsWith('רז')) {
        return record.id;
      }
    }
    
    // If no exact match, return first result
    if (recordsByName.length > 0) {
      return recordsByName[0].id;
    }
    
    return null;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[reserveSlotAndCreateLessons] Failed to find default teacher:`, error);
    }
    return null;
  }
}

/**
 * Service orchestrator for booking a lesson from a one-time slot (slot_inventory).
 * Implements server-side logic similar to Make workflow:
 * 1. Load slot_inventory record
 * 2. Extract required fields (date, startTime, endTime, teacherId)
 * 3. Calculate duration from start/end time
 * 4. Create lesson(s) via nexusApi.createLesson
 * 5. Update slot_inventory: status="סגור", link lesson(s), link student(s)
 */
export async function reserveSlotAndCreateLessons(
  slotId: string,
  studentIds: string[]
): Promise<{ lessons: Lesson[]; slot: SlotInventory }> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:reserveSlotAndCreateLessons:entry',message:'reserveSlotAndCreateLessons called',data:{slotId,studentIds,studentCount:studentIds?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  // Validate inputs
  if (!slotId) {
    throw {
      message: 'Missing required field: slotInventoryRecordId',
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }
  if (!studentIds || studentIds.length === 0) {
    throw {
      message: 'Missing required field: studentRecordId(s)',
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }

  // 1) Load slot_inventory record by Airtable ID
  const slotTableId = getTableId('slotInventory');
  const slotRecord = await airtableClient.getRecord<SlotInventoryAirtableFields>(
    slotTableId,
    slotId
  );
  
  const fields = slotRecord.fields;
  
  // 2) Extract required fields from Airtable (using exact field names from schema)
  const dateField = getField('slotInventory', 'תאריך_שיעור');
  const startTimeField = getField('slotInventory', 'שעת_התחלה');
  const endTimeField = getField('slotInventory', 'שעת_סיום');
  const teacherIdField = getField('slotInventory', 'מורה');
  const lessonTypeField = getField('slotInventory', 'סוג_שיעור');
  
  const date = fields[dateField] as string;
  const startTime = fields[startTimeField] as string;
  const endTime = fields[endTimeField] as string;
  const teacherVal = fields[teacherIdField];
  const teacherRecordId = Array.isArray(teacherVal) 
    ? (typeof teacherVal[0] === 'string' ? teacherVal[0] : teacherVal[0]?.id || '')
    : (typeof teacherVal === 'string' ? teacherVal : teacherVal?.id || '');
  const lessonType = fields[lessonTypeField] as string | undefined;

  // 3) Validate required fields with clear errors
  if (!date) {
    throw {
      message: `Missing required field in slot_inventory: ${dateField} (תאריך שיעור)`,
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }
  if (!startTime) {
    throw {
      message: `Missing required field in slot_inventory: ${startTimeField} (שעת התחלה)`,
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }
  if (!endTime) {
    throw {
      message: `Missing required field in slot_inventory: ${endTimeField} (שעת סיום)`,
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }
  // If teacher is missing, use default teacher "רז" (ID "1") as fallback
  let finalTeacherRecordId = teacherRecordId;
  if (!finalTeacherRecordId) {
    if (import.meta.env.DEV) {
      console.log(`[reserveSlotAndCreateLessons] מורה field is missing, looking up default teacher "רז"`);
    }
    const defaultTeacherId = await findDefaultTeacher();
    if (!defaultTeacherId) {
      throw {
        message: `Missing required field in slot_inventory: ${teacherIdField} (מורה), and default teacher "רז" not found`,
        code: 'VALIDATION_ERROR',
        status: 400,
      };
    }
    finalTeacherRecordId = defaultTeacherId;
    if (import.meta.env.DEV) {
      console.log(`[reserveSlotAndCreateLessons] Using default teacher: ${finalTeacherRecordId}`);
    }
  }

  // 4) Compute durationMin = diff(endTime - startTime) in minutes
  const startDateTime = new Date(`${date}T${startTime}:00`);
  const endDateTime = new Date(`${date}T${endTime}:00`);
  
  if (isNaN(startDateTime.getTime())) {
    throw {
      message: `Invalid date/time format: ${date}T${startTime}:00`,
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }
  if (isNaN(endDateTime.getTime())) {
    throw {
      message: `Invalid date/time format: ${date}T${endTime}:00`,
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }
  
  const durationMin = Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000);
  
  if (durationMin <= 0) {
    throw {
      message: `Invalid duration: end time must be after start time. Start: ${startTime}, End: ${endTime}`,
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }

  // 5) Create lesson(s) via nexusApi.createLesson
  // Note: nexusApi.createLesson expects studentId as Airtable record ID (starts with "rec")
  const createdLessons: Lesson[] = [];
  
  for (const studentRecordId of studentIds) {
    // Validate studentId format (should be Airtable record ID)
    if (!studentRecordId || typeof studentRecordId !== 'string' || !studentRecordId.startsWith('rec')) {
      throw {
        message: `Invalid student ID format. Expected Airtable record ID starting with "rec", got: ${JSON.stringify(studentRecordId)}`,
        code: 'VALIDATION_ERROR',
        status: 400,
      };
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:beforeCreateLesson',message:'About to create lesson for student',data:{studentRecordId,date,startTime,durationMin,teacherId:finalTeacherRecordId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    const lesson = await nexusApi.createLesson({
      studentId: studentRecordId,
      date,
      startTime,
      duration: durationMin,
      teacherId: finalTeacherRecordId,
      status: LessonStatus.SCHEDULED,
      source: 'slot_inventory',
      lessonType: lessonType,
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:afterCreateLesson',message:'Lesson created successfully',data:{lessonId:lesson?.id,studentRecordId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    createdLessons.push(lesson);
  }

  // 6) Update slot_inventory:
  //    - סטטוס="סגור"
  //    - Link created lesson(s) in lessons field
  //    - Link student(s) in תלמידים field (optional)
  
  // Prepare update fields for direct Airtable update (includes status and links)
  const updateFields: Partial<SlotInventoryAirtableFields> = {
    'סטטוס': 'סגור', // Status = closed (exact Hebrew value for Airtable Single Select)
  };

  if (import.meta.env.DEV) {
    console.log(`[reserveSlotAndCreateLessons] Preparing to update slot_inventory ${slotId}:`, {
      status: 'סגור',
      lessonsToLink: createdLessons.map(l => l.id),
      studentsToLink: studentIds,
    });
  }

  // If teacher was missing and we used default, also update the מורה field
  if (!teacherRecordId && finalTeacherRecordId) {
    updateFields[teacherIdField as keyof SlotInventoryAirtableFields] = [finalTeacherRecordId] as any;
  }

  // Link lessons (if lessons field exists)
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:252',message:'Before linking lessons',data:{createdLessonsCount:createdLessons.length,createdLessonIds:createdLessons.map(l=>l.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B'})}).catch(()=>{});
  // #endregion
  try {
    const lessonsField = getField('slotInventory', 'lessons');
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:255',message:'Got lessonsField from getField',data:{lessonsField,lessonsFieldType:typeof lessonsField,lessonsFieldExists:!!lessonsField},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (lessonsField) {
      const lessonIds = createdLessons.map(l => l.id);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:258',message:'Adding lessons to updateFields',data:{lessonsField,lessonIds,lessonIdsCount:lessonIds.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      (updateFields as any)[lessonsField] = lessonIds;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:260',message:'After adding lessons to updateFields',data:{updateFieldsKeys:Object.keys(updateFields),lessonsFieldValue:(updateFields as any)[lessonsField]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:262',message:'lessonsField is falsy',data:{lessonsField},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  } catch (fieldError) {
    // Field doesn't exist in fieldMap, skip linking lessons
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:265',message:'Error getting lessonsField',data:{fieldError:fieldError?.message,fieldErrorStack:fieldError?.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (import.meta.env.DEV) {
      console.warn(`[reserveSlotAndCreateLessons] lessons field not found in fieldMap, skipping lesson linking`);
    }
  }

  // Link students (if תלמידים field exists)
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:267',message:'Before linking students',data:{studentIdsCount:studentIds.length,studentIds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  try {
    const studentsField = getField('slotInventory', 'תלמידים');
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:270',message:'Got studentsField from getField',data:{studentsField,studentsFieldType:typeof studentsField,studentsFieldExists:!!studentsField},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (studentsField) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:273',message:'Adding students to updateFields',data:{studentsField,studentIds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      (updateFields as any)[studentsField] = studentIds;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:275',message:'After adding students to updateFields',data:{updateFieldsKeys:Object.keys(updateFields),studentsFieldValue:(updateFields as any)[studentsField]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:277',message:'studentsField is falsy',data:{studentsField},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    }
  } catch (fieldError) {
    // Field doesn't exist in fieldMap, skip linking students
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:280',message:'Error getting studentsField',data:{fieldError:fieldError?.message,fieldErrorStack:fieldError?.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (import.meta.env.DEV) {
      console.warn(`[reserveSlotAndCreateLessons] תלמידים field not found in fieldMap, skipping student linking`);
    }
  }

  // Update slot_inventory record directly via airtableClient (to handle status + links in one call)
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:285',message:'Before updating slot_inventory',data:{slotId,updateFields,updateFieldsKeys:Object.keys(updateFields),hasLessonsField:!!(updateFields as any)[getField('slotInventory','lessons')],hasStudentsField:!!(updateFields as any)[getField('slotInventory','תלמידים')]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D,E'})}).catch(()=>{});
  // #endregion
  try {
    if (import.meta.env.DEV) {
      console.log(`[reserveSlotAndCreateLessons] Updating slot_inventory with fields:`, JSON.stringify(updateFields, null, 2));
    }
    
    await airtableClient.updateRecord<SlotInventoryAirtableFields>(
      slotTableId,
      slotId,
      updateFields,
      { typecast: true } // Enable automatic option creation for Single Select fields
    );
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:293',message:'After updating slot_inventory - success',data:{slotId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    if (import.meta.env.DEV) {
      console.log(`[reserveSlotAndCreateLessons] Successfully updated slot_inventory ${slotId}`);
    }
  } catch (updateError: any) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:297',message:'Error updating slot_inventory',data:{slotId,updateError:updateError?.message,updateErrorStatus:updateError?.status,updateErrorDetails:updateError?.details},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    // If update fails, try updating just status via nexusApi as fallback
    console.error(`[reserveSlotAndCreateLessons] Direct update failed:`, updateError);
    if (import.meta.env.DEV) {
      console.warn(`[reserveSlotAndCreateLessons] Falling back to status-only update via nexusApi`);
    }
    // Fallback: update status only
    await nexusApi.updateSlotInventory(slotId, {
      status: 'closed' as any, // Will be mapped to "סגור" internally
    });
  }
  
  // Fetch updated record to return
  const updatedRecord = await airtableClient.getRecord<SlotInventoryAirtableFields>(
    slotTableId,
    slotId
  );
  
  // Map to SlotInventory type
  const updatedFields = updatedRecord.fields;
  const updatedTeacherVal = updatedFields[teacherIdField];
  const updatedTeacherId = Array.isArray(updatedTeacherVal) 
    ? (typeof updatedTeacherVal[0] === 'string' ? updatedTeacherVal[0] : updatedTeacherVal[0]?.id || '')
    : (typeof updatedTeacherVal === 'string' ? updatedTeacherVal : updatedTeacherVal?.id || '');
  
  const updatedStatus = (updatedFields['סטטוס'] as string) || 'open';
  const normalizedStatus = (updatedStatus === 'סגור' || updatedStatus === 'closed' || updatedStatus === 'booked') 
    ? 'closed' as any 
    : (updatedStatus === 'blocked' ? 'blocked' as any : 'open' as any);
  
  // Check if lessons are linked
  const lessonsField = getField('slotInventory', 'lessons');
  const linkedLessons = updatedFields[lessonsField] || updatedFields.lessons;
  const hasLinkedLessons = Array.isArray(linkedLessons) ? linkedLessons.length > 0 : !!linkedLessons;
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'slotBookingService.ts:326',message:'After fetching updated record - checking lessons field',data:{slotId,lessonsField,linkedLessons,linkedLessonsType:typeof linkedLessons,linkedLessonsIsArray:Array.isArray(linkedLessons),hasLinkedLessons,allUpdatedFieldsKeys:Object.keys(updatedFields),lessonsFieldInFields:!!updatedFields[lessonsField],lessonsInFields:!!updatedFields.lessons},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D,F'})}).catch(()=>{});
  // #endregion
  
  // Extract lesson IDs for the returned slot object
  let lessonIds: string[] = [];
  if (Array.isArray(linkedLessons)) {
    lessonIds = linkedLessons.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
  } else if (linkedLessons) {
    lessonIds = [typeof linkedLessons === 'string' ? linkedLessons : linkedLessons.id].filter(Boolean);
  }
  
  if (import.meta.env.DEV) {
    console.log(`[reserveSlotAndCreateLessons] Updated slot_inventory response:`, {
      id: updatedRecord.id,
      status: updatedStatus,
      normalizedStatus,
      hasLinkedLessons,
      linkedLessons: Array.isArray(linkedLessons) ? linkedLessons : linkedLessons,
      lessonIds,
      students: updatedFields['תלמידים'] || updatedFields[getField('slotInventory', 'תלמידים')],
    });
  }
  
  const updatedSlot: SlotInventory = {
    id: updatedRecord.id,
    teacherId: updatedTeacherId,
    teacherName: '', // Will be populated by caller if needed
    date: updatedFields[dateField] as string,
    startTime: updatedFields[startTimeField] as string,
    endTime: updatedFields[endTimeField] as string,
    status: normalizedStatus,
    lessons: lessonIds, // Include linked lessons for UI filtering
  };

  // Invalidate cache to ensure UI refreshes with latest data
  invalidateLessons();
  
  // Invalidate slot inventory cache with the specific date range
  // This ensures the UI refreshes correctly after reservation
  const slotDate = slotRecord.fields[getField('slotInventory', 'תאריך_שיעור')];
  if (slotDate) {
    // Invalidate for the specific date (and surrounding week for cache key matching)
    const dateObj = new Date(slotDate);
    const weekStart = new Date(dateObj);
    weekStart.setDate(dateObj.getDate() - dateObj.getDay()); // Sunday
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    // Invalidate for the specific week range
    invalidateSlotInventory({
      start: weekStart.toISOString().split('T')[0],
      end: weekEnd.toISOString().split('T')[0],
    });
    
    // Also invalidate all to catch any edge cases (for other components/date ranges)
    invalidateSlotInventory();
  } else {
    // Fallback: invalidate all if date not found
    invalidateSlotInventory();
  }

  if (import.meta.env.DEV) {
    console.log(`[reserveSlotAndCreateLessons] Invalidated cache: lessons:*, slot_inventory:*`);
    console.log(`[reserveSlotAndCreateLessons] Returning:`, {
      lessonsCount: createdLessons.length,
      slotId: updatedSlot.id,
      slotStatus: updatedSlot.status,
      slotLessons: updatedSlot.lessons,
    });
  }

  return {
    lessons: createdLessons,
    slot: updatedSlot,
  };
}
