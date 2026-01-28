import { airtableClient } from './airtableClient';
import { getTableId, getField } from '../contracts/fieldMap';
import { nexusApi } from './nexusApi';
import {
  Lesson,
  SlotInventory,
  LessonStatus,
  BookLessonFromSlotPayload,
} from '../types';
import { SlotInventoryAirtableFields } from '../contracts/types';

/**
 * Service orchestrator for booking a lesson from a one-time slot (slot_inventory).
 *
 * Responsibilities:
 * - Derive teacher/student metadata from slot_inventory if not provided explicitly.
 * - Build a valid Lesson payload and delegate creation to nexusApi.createLesson (including all validations/mappings).
 * - After successful lesson creation, update the slot_inventory record to closed + optionally link the lesson.
 */
export async function bookLessonFromSlot(
  slotId: string,
  payload: BookLessonFromSlotPayload
): Promise<{ lesson: Lesson; slot: SlotInventory }> {
  if (!slotId) {
    throw {
      message: 'חסר מזהה חלון (slotId) לביצוע קביעת שיעור.',
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }

  if (!payload.date || !payload.startTime || !payload.endTime) {
    throw {
      message: 'אנא מלא/י תאריך, שעת התחלה ושעת סיום לפני שמירת החלון.',
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }

  // 1) Fetch slot_inventory record to derive teacher/student if needed
  const slotTableId = getTableId('slotInventory');
  let slotRecord: { id: string; fields: SlotInventoryAirtableFields };
  try {
    slotRecord = await airtableClient.getRecord<SlotInventoryAirtableFields>(
      slotTableId,
      slotId
    );
  } catch (error) {
    console.error('[bookLessonFromSlot] Failed to fetch slot_inventory record', {
      slotId,
      error,
    });
    throw {
      message: 'לא ניתן לטעון את פרטי החלון. נסה/י שוב או פנה/י לתמיכה.',
      code: 'SLOT_FETCH_FAILED',
      status: 500,
      details: { slotId, error },
    };
  }

  const fields = slotRecord.fields || {};

  // Derive teacherId from slot_inventory ("מורה" linked record)
  const teacherField = getField('slotInventory', 'מורה');
  const teacherVal = (fields as Record<string, unknown>)[teacherField];
  const teacherId =
    Array.isArray(teacherVal) && teacherVal.length > 0
      ? typeof teacherVal[0] === 'string'
        ? teacherVal[0]
        : (teacherVal[0] as { id?: string })?.id || ''
      : typeof teacherVal === 'string'
      ? teacherVal
      : (teacherVal as { id?: string } | undefined)?.id || '';

  // Derive studentId either from payload or from slot_inventory ("תלמידים" linked record)
  let studentId = payload.studentId;
  if (!studentId) {
    const studentsField = getField('slotInventory', 'תלמידים' as any);
    const studentsVal = (fields as Record<string, unknown>)[studentsField];
    if (Array.isArray(studentsVal) && studentsVal.length > 0) {
      const first = studentsVal[0] as any;
      studentId =
        typeof first === 'string'
          ? first
          : (first as { id?: string })?.id || undefined;
    } else if (typeof studentsVal === 'string') {
      studentId = studentsVal;
    }
  }

  if (!studentId) {
    throw {
      message:
        'לא ניתן לקבוע שיעור מהחלון הזה כי הוא אינו משויך לתלמיד. אנא חבר/י תלמיד לחלון ואז נסה/י שוב.',
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }

  // 2) Calculate lesson duration (in minutes) from start/end times
  const [startHours, startMinutes] = payload.startTime.split(':').map(Number);
  const [endHours, endMinutes] = payload.endTime.split(':').map(Number);
  const startTotal = startHours * 60 + startMinutes;
  const endTotal = endHours * 60 + endMinutes;
  const duration = endTotal - startTotal;

  if (!Number.isFinite(duration) || duration <= 0) {
    throw {
      message:
        'משך השיעור שחושב מהשעות שהוזנו אינו תקף. ודא/י ששעת הסיום מאוחרת משעת ההתחלה.',
      code: 'VALIDATION_ERROR',
      status: 400,
    };
  }

  // 3) Build payload for nexusApi.createLesson (reuse existing mapping/validation)
  const lessonPayload = {
    studentId,
    date: payload.date,
    startTime: payload.startTime,
    duration,
    teacherId: teacherId || undefined,
    status: LessonStatus.SCHEDULED,
    lessonType: payload.lessonType,
    notes: payload.notes,
  } as Partial<Lesson>;

  let createdLesson: Lesson;
  try {
    createdLesson = await nexusApi.createLesson(lessonPayload);
  } catch (error) {
    console.error(
      '[bookLessonFromSlot] Failed to create lesson from slot',
      {
        slotId,
        payload,
        error,
      }
    );
    // Bubble up the original error so parseApiError can show the correct message
    throw error;
  }

  // 4) Update slot_inventory record: set status to closed (booked) and link new lesson
  let updatedSlot: SlotInventory;
  try {
    updatedSlot = await nexusApi.updateSlotInventory(
      slotId,
      {
        date: payload.date,
        startTime: payload.startTime,
        endTime: payload.endTime,
        // Use existing status value for a closed/booked slot.
        status: 'booked',
        // Will be mapped internally to the 'lessons' linked field if available.
        linkedLessonId: createdLesson.id,
      } as Partial<SlotInventory> & { linkedLessonId?: string }
    );
  } catch (error) {
    console.error(
      '[bookLessonFromSlot] Lesson created but failed to update slot_inventory',
      {
        slotId,
        lessonId: createdLesson.id,
        error,
      }
    );
    // Surface a clear error for the UI while preserving context
    throw {
      message:
        'השיעור נוצר בהצלחה, אבל לא הצלחנו לסגור את החלון ביומן. אנא דווח/י לצוות התמיכה.',
      code: 'SLOT_UPDATE_FAILED',
      status: 500,
      details: {
        slotId,
        lessonId: createdLesson.id,
        originalError: error,
      },
    };
  }

  return {
    lesson: createdLesson,
    slot: updatedSlot,
  };
}

