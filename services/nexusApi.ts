
import { Lesson, Student, Teacher, Subscription, MonthlyBill, LessonStatus, HomeworkLibraryItem, HomeworkAssignment, WeeklySlot, SlotInventory, Entity, EntityPermission, StudentGroup } from '../types';
import { mockData } from './mockApi';
import { AIRTABLE_CONFIG } from '../config/airtable';
import { getChargesReport, createMonthlyCharges, CreateMonthlyChargesResult, recalculateBill, RecalculateBillResult, discoverChargeTableSchema, ChargeTableSchema, getChargesReportKPIs, ChargesReportKPIs } from './billingService';
import { getBillingBreakdown, BillingBreakdown } from './billingDetailsService';
import { airtableClient } from './airtableClient';
import { getAuthToken, notifyAuthExpired } from '../hooks/useAuth';
import { apiUrl } from '../config/api';

// Cache for table schema to avoid redundant discovery calls
let cachedChargeSchema: ChargeTableSchema | null = null;
import { getTableId, getField, isComputedField, filterComputedFields } from '../contracts/fieldMap';
import { getWeeklySlots as getWeeklySlotsService, getSlotInventory as getSlotInventoryService, updateWeeklySlot as updateWeeklySlotService, updateSlotInventory as updateSlotInventoryService, createWeeklySlot as createWeeklySlotService, deleteWeeklySlot as deleteWeeklySlotService, reserveRecurringLesson as reserveRecurringLessonService } from './slotManagementService';
import { openNewWeek as openNewWeekService } from './weeklyRolloverService';
import { triggerCreateLessonScenario } from './makeApi';
import { normalizeSlotStatus, slotStatusToAirtable } from '../utils/slotStatus';

// Backend proxy base path (the server handles Airtable credentials)
const PROXY_BASE_URL = '/api/airtable';

// Airtable API helper functions — routes through backend proxy
async function airtableRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  if (!token) {
    throw {
      message: 'לא מחובר למערכת. יש להתחבר מחדש.',
      code: 'AUTH_REQUIRED',
      status: 401,
    };
  }

  // endpoint looks like: "/tblXXX?filterByFormula=..."
  // We need to build: /api/airtable/tblXXX?filterByFormula=...
  const [tablePath, queryString] = endpoint.split('?');
  const pathParts = tablePath.split('/');
  if (pathParts.length > 1 && pathParts[1]) {
    pathParts[1] = encodeURIComponent(pathParts[1]);
  }
  const encodedPath = pathParts.join('/');
  const encodedEndpoint = queryString ? `${encodedPath}?${queryString}` : encodedPath;

  const url = apiUrl(`${PROXY_BASE_URL}${encodedEndpoint}`);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      // If 401, token might be expired — user needs to re-login
      if (response.status === 401) {
        notifyAuthExpired();
        throw { message: 'פג תוקף ההתחברות', code: 'AUTH_EXPIRED', status: 401 };
      }

      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      const errMsg =
        typeof errorData.error === 'string'
          ? errorData.error
          : errorData.error?.message || `API error: ${response.statusText}`;
      throw {
        message: errMsg,
        code: 'AIRTABLE_ERROR',
        status: response.status,
        details: errorData,
      };
    }

    return response.json() as Promise<T>;
  } catch (err: any) {
    if (err.code === 'AIRTABLE_ERROR' || err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED') {
      throw err;
    }
    throw {
      message: `Failed to connect to server: ${err.message}`,
      code: 'CONNECTION_ERROR',
      status: 0,
    };
  }
}

/**
 * Escape backslash and quotes for Airtable string values in formulas
 */
/**
 * Format time string for Airtable Time field
 * Ensures format is HH:mm (e.g., "18:05" -> "18:05")
 * When used with typecast: true in the API request, Airtable will automatically
 * add new values to Single Select field options if they don't exist
 */
function formatTimeForAirtable(time: string | undefined): string | null {
  if (!time) return null;
  
  // Remove any whitespace
  const trimmed = time.trim();
  
  // If already in HH:mm format, return as-is
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  
  // Try to parse and reformat
  // Handle formats like "18:05:00" or "6:05 PM" etc.
  const timeMatch = trimmed.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2];
    // Ensure 24-hour format
    const hours24 = hours > 23 ? hours % 24 : hours;
    return `${String(hours24).padStart(2, '0')}:${minutes}`;
  }
  
  // If we can't parse it, return null (don't update the field)
  console.warn(`[formatTimeForAirtable] Could not parse time: "${time}"`);
  return null;
}

function escapeAirtableString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Fetch all records from an Airtable table with pagination support
 * Handles offset loops until all records are fetched
 */
async function listAllAirtableRecords<TFields>(
  tableId: string,
  params: Record<string, string | undefined> = {}
): Promise<Array<{ id: string; fields: TFields }>> {
  const allRecords: Array<{ id: string; fields: TFields }> = [];
  let offset: string | undefined;

  do {
    // Build query string from params, excluding undefined values
    const queryParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        queryParams.append(key, value);
      }
    });
    
    // Add offset if we have one from previous page
    if (offset) {
      queryParams.append('offset', offset);
    }

    const endpoint = `/${tableId}?${queryParams.toString()}`;
    const response = await airtableRequest<{
      records: Array<{ id: string; fields: TFields }>;
      offset?: string;
    }>(endpoint);

    allRecords.push(...response.records);
    offset = response.offset;
  } while (offset);

  return allRecords;
}

// Map Airtable record to Lesson
function mapAirtableToLesson(record: any): Lesson {
  const fields = record.fields || {};
  
  const lessonDetailsField = getField('lessons', 'פרטי_השיעור' as any);
  
  // Map status from Airtable to LessonStatus enum
  const statusMap: Record<string, LessonStatus> = {
    'מתוכנן': LessonStatus.SCHEDULED,
    'אישר הגעה': LessonStatus.CONFIRMED,
    'בוצע': LessonStatus.COMPLETED,
    'בוטל': LessonStatus.CANCELLED,
    'בוטל ע"י מנהל': LessonStatus.CANCELLED_BY_ADMIN,
  };

  // Extract date and time from datetime fields
  const startDatetimeField = getField('lessons', 'start_datetime');
  const endDatetimeField = getField('lessons', 'end_datetime');
  const lessonDateField = getField('lessons', 'lesson_date');
  const startDatetime = fields[startDatetimeField] || '';
  const endDatetime = fields[endDatetimeField] || '';
  const lessonDate = fields[lessonDateField] || '';
  
  // Parse datetime strings to extract date and time
  let date = '';
  let startTime = '';
  let duration = 60;
  
  if (startDatetime) {
    const startDate = new Date(startDatetime);
    // FIX: Airtable returns UTC datetimes (with Z), but we want to display local time
    // If the datetime string ends with Z (UTC), extract UTC hours/minutes and convert to local
    // If it doesn't have Z, treat it as local time already
    const isUTC = startDatetime.endsWith('Z') || startDatetime.includes('+') || startDatetime.includes('-', 10);
    
    if (isUTC) {
      // Airtable returned UTC - extract UTC time and convert to local for display
      date = startDate.toISOString().split('T')[0];
      // Use UTC hours/minutes but convert to local timezone for display
      const utcHours = startDate.getUTCHours();
      const utcMinutes = startDate.getUTCMinutes();
      // Format as local time (the Date object already converted UTC to local)
      startTime = String(startDate.getHours()).padStart(2, '0') + ':' + String(startDate.getMinutes()).padStart(2, '0');
    } else {
      // No timezone indicator - treat as local time
      date = startDate.toISOString().split('T')[0];
      startTime = String(startDate.getHours()).padStart(2, '0') + ':' + String(startDate.getMinutes()).padStart(2, '0');
    }
    
    if (endDatetime) {
      const endDate = new Date(endDatetime);
      duration = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60)); // duration in minutes
      }
  } else if (lessonDate) {
    date = typeof lessonDate === 'string' ? lessonDate : lessonDate.split('T')[0];
  }
  
  // Handle student name - could be from linked record or direct field
  const studentName = fields['Student_Name'] || fields['Student_Name_Lookup'] || 
                     (fields['Student']?.[0]?.name) || 
                     fields['student'] || '';

  // Map 'פרטי השיעור' field - try multiple possible field names
  const lessonDetails = fields[lessonDetailsField] || 
                       fields['פרטי השיעור'] || 
                       fields['Notes'] || 
                       fields['notes'] || 
                       '';
  

  const statusField = getField('lessons', 'status');
  const priceField = getField('lessons', 'price');
  const price = fields[priceField] !== undefined && fields[priceField] !== null 
    ? (typeof fields[priceField] === 'number' ? fields[priceField] : parseFloat(fields[priceField])) 
    : undefined;
  
  // Normalize status: Airtable Single Select may return values with trailing space (e.g. "בוטל ")
  const rawStatus = fields[statusField];
  const statusKey = typeof rawStatus === 'string' ? rawStatus.trim() : String(rawStatus || '').trim();
  const mappedStatus = statusMap[statusKey] || LessonStatus.SCHEDULED;
  
  // Extract all student IDs from full_name linked record field
  const fullNameField = getField('lessons', 'full_name');
  const fullNameValue = fields[fullNameField];
  let allStudentIds: string[] = [];
  if (Array.isArray(fullNameValue) && fullNameValue.length > 0) {
    allStudentIds = fullNameValue
      .map((item: any) =>
        typeof item === 'string' && item.startsWith('rec')
          ? item
          : item?.id && item.id.startsWith('rec') ? item.id : ''
      )
      .filter(Boolean);
  } else if (typeof fullNameValue === 'string' && fullNameValue.startsWith('rec')) {
    allStudentIds = [fullNameValue];
  }
  const studentIdFromFullName = allStudentIds[0] || '';
  
  // Extract teacherId from teacher_id linked record (Airtable returns array of rec IDs)
  const teacherIdField = getField('lessons', 'teacher_id');
  const teacherIdRaw = fields[teacherIdField];
  const teacherId = Array.isArray(teacherIdRaw) && teacherIdRaw.length > 0
    ? (typeof teacherIdRaw[0] === 'string' ? teacherIdRaw[0] : teacherIdRaw[0]?.id || '')
    : (typeof teacherIdRaw === 'string' ? teacherIdRaw : '');

  // Map lesson_type from Hebrew to English (Airtable: "פרטי","זוגי","קבוצתי" -> "private","pair","group")
  const lessonTypeField = getField('lessons', 'lesson_type');
  const lessonTypeRaw = (fields[lessonTypeField] || '').trim();
  const lessonTypeMap: Record<string, string> = {
    'פרטי': 'private',
    'זוגי': 'pair',
    'קבוצתי': 'group',
  };
  const lessonType = lessonTypeMap[lessonTypeRaw] || lessonTypeRaw || 'private';

  const primaryStudentId = studentIdFromFullName || 
              fields['Student_ID'] || 
              fields['Student']?.[0]?.id || 
              '';
  const mappedLesson = {
    id: record.id,
    studentId: primaryStudentId,
    studentIds: allStudentIds.length > 0 ? allStudentIds : (primaryStudentId ? [primaryStudentId] : []),
    studentName: studentName,
    teacherId: teacherId,
    teacherName: fields['Teacher_Name'] || fields['Teacher']?.[0]?.name || '',
    date: date,
    startTime: startTime,
    duration: duration,
    status: mappedStatus,
    subject: fields['Subject'] || fields['subject'] || 'מתמטיקה',
    isChargeable: fields['Is_Chargeable'] !== false,
    chargeReason: fields['Charge_Reason'] || fields['charge_reason'],
    isPrivate: lessonType === 'private',
    lessonType: lessonType as 'private' | 'pair' | 'group',
    notes: lessonDetails, // Use 'פרטי השיעור' as primary notes field
    paymentStatus: fields['Payment_Status'] || fields['payment_status'],
    attendanceConfirmed: fields['Attendance_Confirmed'] || false,
    price: price,
  };
  
  
  return mappedLesson;
}

// Map Airtable record to Student
function mapAirtableToStudent(record: any): Student {
  const fields = record.fields || {};
  const fullNameField = getField('students', 'full_name');
  const phoneField = getField('students', 'phone_number');
  const parentPhoneField = getField('students', 'parent_phone');
  const parentNameField = getField('students', 'parent_name');
  const gradeLevelField = getField('students', 'grade_level');
  const subjectFocusField = getField('students', 'subject_focus');
  const levelField = getField('students', 'level');
  const weeklyLessonsLimitField = getField('students', 'weekly_lessons_limit');
  const paymentStatusField = getField('students', 'payment_status');
  const isActiveField = getField('students', 'is_active');
  const registrationDateField = getField('students', 'registration_date');
  const lastActivityField = getField('students', 'last_activity');
  const totalWithVatField = getField('students', 'כולל_מעמ_ומנויים'); // כולל מע"מ ומנויים - formula field
  
  // DEBUG: Log balance field info for first few students
  const rawBalance = fields[totalWithVatField];
  const studentName = fields[fullNameField];
  
  return {
    id: record.id,
    name: fields[fullNameField] || '',
    parentName: fields[parentNameField] || fields['Parent_Name'] || '',
    parentPhone: fields[parentPhoneField] || '',
    email: fields['Email'] || fields['email'] || '',
    phone: fields[phoneField] || '',
    grade: fields[gradeLevelField] || fields['Grade'] || '',
    level: fields[levelField] || '',
    subjectFocus: fields[subjectFocusField] || '',
    weeklyLessonsLimit: fields[weeklyLessonsLimitField] || 0,
    paymentStatus: fields[paymentStatusField] || '',
    registrationDate: fields[registrationDateField] || '',
    lastActivity: fields[lastActivityField] || '',
    status: (() => {
      const isActive = fields[isActiveField];
      if (isActive === true || isActive === 1) return 'active' as const;
      const payStatus = (fields[paymentStatusField] || '').toString().trim();
      if (payStatus === 'הקפאה') return 'on_hold' as const;
      return 'inactive' as const;
    })(),
    subscriptionType: fields['Subscription_Type'] || fields['subscription_type'] || '',
    balance: parseFloat(fields[totalWithVatField] || '0') || 0, // סכום כולל מע״מ ומנויים
    notes: fields['Notes'] || fields['notes'],
  };
}

// Map Lesson to Airtable fields (only for updates - only status, start_datetime, end_datetime)
function mapLessonToAirtable(lesson: Partial<Lesson>): any {
  const fields: any = {};
  const statusField = getField('lessons', 'status');
  const startDatetimeField = getField('lessons', 'start_datetime');
  const endDatetimeField = getField('lessons', 'end_datetime');
  
  // Only map the fields that are allowed for updates: status, start_datetime, end_datetime
  
  // Map status - send the clean value, typecast handles matching to existing options
  if (lesson.status !== undefined) {
    fields[statusField] = String(lesson.status).trim();
  }
  
  // Convert date + startTime to start_datetime (ISO format)
  // FIX: Convert local time to UTC for Airtable (same as createLesson)
  if (lesson.date !== undefined && lesson.startTime !== undefined) {
    // Parse local time and convert to UTC ISO string
    const localStartDatetime = `${lesson.date}T${lesson.startTime}:00`;
    const startDate = new Date(localStartDatetime);
    fields[startDatetimeField] = startDate.toISOString(); // UTC ISO string
    
    // Calculate end_datetime from start_datetime + duration
    if (lesson.duration !== undefined) {
      const endDate = new Date(startDate.getTime() + (lesson.duration * 60 * 1000));
      // Format as ISO string for Airtable (UTC)
      fields[endDatetimeField] = endDate.toISOString();
    }
  } else if (lesson.startTime !== undefined && lesson.date) {
    // Fallback: if we have date and time separately
    const localStartDatetime = `${lesson.date}T${lesson.startTime}:00`;
    const startDate = new Date(localStartDatetime);
    fields[startDatetimeField] = startDate.toISOString(); // UTC ISO string
    
    if (lesson.duration !== undefined) {
      const endDate = new Date(startDate.getTime() + (lesson.duration * 60 * 1000));
      fields[endDatetimeField] = endDate.toISOString(); // UTC ISO string
    }
  }

  // Price - allow updating for private and pair/group lessons
  if (lesson.price !== undefined) {
    const priceField = getField('lessons', 'price');
    fields[priceField] = Math.round(lesson.price * 100) / 100;
  }

  // Teacher link - when provided (use same format as createLesson)
  if (lesson.teacherId !== undefined && lesson.teacherId && lesson.teacherId.startsWith('rec')) {
    const teacherFieldName = getField('lessons', 'teacher_id');
    fields[teacherFieldName] = [lesson.teacherId];
  }

  // Lesson type - map English to Hebrew for Airtable (same as createLesson)
  if (lesson.lessonType !== undefined && lesson.lessonType) {
    const lessonTypeField = getField('lessons', 'lesson_type');
    const typeMap: Record<string, string> = {
      'private': 'פרטי',
      'pair': 'זוגי',
      'group': 'קבוצתי',
    };
    const hebrewType = typeMap[lesson.lessonType] || lesson.lessonType;
    fields[lessonTypeField] = hebrewType;
  }

  // Duration - when provided
  if (lesson.duration !== undefined) {
    const durationField = getField('lessons', 'duration');
    fields[durationField] = lesson.duration;
  }

  // Notes: 'פרטי השיעור' is a computed/formula field in Airtable – skip writing to it

  // Student link (same field and format as createLesson) - only when provided so we don't overwrite on status-only updates (e.g. cancel)
  if (lesson.studentIds && Array.isArray(lesson.studentIds) && lesson.studentIds.length > 0) {
    const validIds = lesson.studentIds.filter((id): id is string => Boolean(id && typeof id === 'string' && id.startsWith('rec')));
    if (validIds.length > 0) {
      const studentFieldName = getField('lessons', 'full_name');
      fields[studentFieldName] = validIds;
    }
  } else if (lesson.studentId && typeof lesson.studentId === 'string' && lesson.studentId.startsWith('rec')) {
    const studentFieldName = getField('lessons', 'full_name');
    fields[studentFieldName] = [lesson.studentId];
  }
  
  return { fields };
}

async function handleResponse<T>(response: Response, url: string): Promise<T> {
  // Log the response details for debugging
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  
  
  // Get response text first to check what we're actually receiving
  const responseText = await response.text();
  
  if (!response.ok) {
    let errorMessage = 'שגיאת שרת לא ידועה';
    let errorCode = 'SERVER_ERROR';
    if (isJson) {
      try {
        const errorData = JSON.parse(responseText);
        errorMessage = errorData.message || errorMessage;
        errorCode = errorData.code || errorCode;
      } catch (e) {
        console.error(`[API] ${url} - Failed to parse error JSON:`, e);
        errorMessage = response.statusText || errorMessage;
      }
    } else {
      // If we got HTML instead of JSON, the endpoint doesn't exist
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<!doctype')) {
        console.error(`[API] ${url} - Received HTML instead of JSON. Endpoint likely doesn't exist.`);
        errorMessage = 'API endpoint not found - returning HTML instead of JSON';
        errorCode = 'ENDPOINT_NOT_FOUND';
      } else {
        errorMessage = response.statusText || errorMessage;
      }
    }
    throw { message: errorMessage, code: errorCode, status: response.status };
  }
  
  // Check if response is actually JSON before parsing
  if (!isJson) {
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<!doctype')) {
      console.error(`[API] ${url} - Received HTML instead of JSON. Endpoint likely doesn't exist.`);
      throw { 
        message: 'API endpoint not found - received HTML instead of JSON', 
        code: 'ENDPOINT_NOT_FOUND', 
        status: response.status 
      };
    }
    throw { 
      message: `Expected JSON but received ${contentType}`, 
      code: 'INVALID_CONTENT_TYPE', 
      status: response.status 
    };
  }
  
  try {
    return JSON.parse(responseText) as T;
  } catch (e) {
    console.error(`[API] ${url} - Failed to parse JSON:`, e);
    console.error(`[API] ${url} - Full response:`, responseText);
    throw { 
      message: 'Failed to parse JSON response', 
      code: 'JSON_PARSE_ERROR', 
      status: response.status 
    };
  }
}

export const parseApiError = (err: any): string => {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  return 'אירעה שגיאה בלתי צפויה';
};

async function withFallback<T>(apiCall: () => Promise<T>, fallbackData: T | (() => Promise<T>)): Promise<T> {
  try {
    return await apiCall();
  } catch (err: any) {
    console.warn(`[API] API call failed, using fallback data:`, err);
    if (err.status === 404 || err.code === 'ENDPOINT_NOT_FOUND' || err.message?.includes('Failed to fetch') || err.message?.includes('HTML instead of JSON')) {
      return typeof fallbackData === 'function' ? (fallbackData as any)() : fallbackData;
    }
    throw err;
  }
}


/**
 * Map Airtable weekly slot record to WeeklySlot type
 */
function mapAirtableToWeeklySlot(record: any, teachersMap: Map<string, string>): WeeklySlot {
  const fields = record.fields || {};
  const teacherIdField = getField('weeklySlot', 'teacher_id');
  const dayOfWeekField = getField('weeklySlot', 'day_of_week');
  const startTimeField = getField('weeklySlot', 'start_time');
  const endTimeField = getField('weeklySlot', 'end_time');
  const typeField = getField('weeklySlot', 'type');
  const fixedField = getField('weeklySlot', 'קבוע' as any);
  const reservedForField = getField('weeklySlot', 'reserved_for');
  const durationMinField = getField('weeklySlot', 'duration_min');
  
  // Extract teacher ID from linked record (array of record IDs)
  const teacherIdValue = fields[teacherIdField];
  const teacherId = Array.isArray(teacherIdValue) 
    ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
    : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
  
  // Extract day of week (can be string "0"-"6" or number 0-6)
  const dayOfWeekValue = fields[dayOfWeekField];
  const dayOfWeek = typeof dayOfWeekValue === 'string' 
    ? parseInt(dayOfWeekValue, 10) 
    : (dayOfWeekValue || 0);
  
  // Extract reserved_for (linked record to students)
  const reservedForValue = fields[reservedForField];
  const reservedFor = reservedForValue
    ? (Array.isArray(reservedForValue) 
        ? (typeof reservedForValue[0] === 'string' ? reservedForValue[0] : reservedForValue[0]?.id || undefined)
        : (typeof reservedForValue === 'string' ? reservedForValue : reservedForValue?.id || undefined))
    : undefined;
  
  // Extract fixed status (checkbox - can be boolean, 0/1, or undefined)
  const isFixed = fields[fixedField] === true || fields[fixedField] === 1;
  
  // Extract type - NO FALLBACK, use actual value from Airtable
  // Type values in Airtable are in Hebrew: "פרטי", "זוגי", "קבוצתי"
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
  
  return {
    id: record.id,
    teacherId: teacherId || '',
    teacherName: teachersMap.get(teacherId || '') || '',
    dayOfWeek: dayOfWeek,
    startTime: fields[startTimeField] || '',
    endTime: fields[endTimeField] || '',
    type: type || 'private', // Only fallback to 'private' if completely missing
    status: 'active', // Default to active (can be enhanced later if status field exists)
    isFixed: isFixed,
    reservedFor: reservedFor,
    durationMin: fields[durationMinField],
  };
}

/**
 * Map Airtable slot inventory record to SlotInventory type
 */
function mapAirtableToSlotInventory(record: any, teachersMap: Map<string, string>): SlotInventory {
  const fields = record.fields || {};
    // Use the 'מורה' Linked Record field instead of 'מזהה מורה' text field
    // 'מורה' is the proper Linked Record field that contains valid record IDs
    const teacherIdField = getField('slotInventory', 'מורה');
  const dateField = getField('slotInventory', 'תאריך_שיעור');
  const startTimeField = getField('slotInventory', 'שעת_התחלה');
  const endTimeField = getField('slotInventory', 'שעת_סיום');
  const statusField = getField('slotInventory', 'סטטוס');
  
  // Extract teacher ID from linked record (array of record IDs)
  const teacherIdValue = fields[teacherIdField];
  const teacherId = Array.isArray(teacherIdValue) 
    ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
    : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
  
  // Extract status
  const rawStatusValue = fields[statusField] || 'open';
  // Normalize status value: trim whitespace and handle both Hebrew and English
  const statusValue = typeof rawStatusValue === 'string' ? rawStatusValue.trim() : String(rawStatusValue).trim();
  // Map status values (Hebrew and English) to internal enum for consistency
  // Hebrew: "פתוח" → 'open', "סגור" → 'booked' (for this function's return type)
  // English: "open" → 'open', "closed"/"booked" → 'booked'
  const status = (
    statusValue === 'פתוח' || statusValue === 'open'
      ? 'open'
      : statusValue === 'סגור' || statusValue === 'closed' || statusValue === 'booked'
      ? 'booked'
      : statusValue === 'blocked'
      ? 'blocked'
      : 'open' // Default to 'open' for unknown values
  ) as 'open' | 'booked' | 'blocked';
  
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
    date: fields[dateField] || '',
    startTime: fields[startTimeField] || '',
    endTime: fields[endTimeField] || '',
    status: status,
    lessons: lessonIds, // Include linked lessons for filtering
  };
}

/**
 * Get teachers map for name lookup
 */
async function getTeachersMap(): Promise<Map<string, string>> {
  try {
    const teachersTableId = getTableId('teachers');
    const records = await listAllAirtableRecords<{ Name?: string; Teacher_Name?: string; full_name?: string }>(
      teachersTableId,
      { pageSize: '100' }
    );
    const map = new Map<string, string>();
    records.forEach(record => {
      const name = record.fields.Name || record.fields.Teacher_Name || record.fields.full_name || '';
      map.set(record.id, name);
    });
    return map;
  } catch (error) {
    console.warn('[nexusApi] Failed to fetch teachers, using empty map:', error);
    return new Map();
  }
}

/**
 * Convert teacherId (number or record ID) to Airtable record ID
 * If teacherId is already a record ID (starts with 'rec'), return it as-is
 * If teacherId is a number (e.g., "1"), look up the teacher by teacher_id field and return record ID
 */
async function resolveTeacherRecordId(teacherId: string | undefined): Promise<string | undefined> {
  if (!teacherId) {
    return undefined;
  }
  
  // If already a record ID, return as-is
  if (teacherId.startsWith('rec')) {
    return teacherId;
  }
  
  // Otherwise, try to find teacher by teacher_id field
  try {
    const { airtableClient } = await import('./airtableClient');
    const teachersTableId = getTableId('teachers');
    const teacherIdField = getField('teachers', 'teacher_id');
    
    // Try to find by teacher_id (can be number or string)
    const records = await airtableClient.getRecords<{ teacher_id?: string | number }>(
      teachersTableId,
      {
        filterByFormula: `OR({${teacherIdField}} = ${teacherId}, {${teacherIdField}} = "${teacherId}")`,
        maxRecords: 1,
      }
    );
    
    if (records.length > 0) {
      return records[0].id;
    }
    
    // If not found, return undefined (will check all teachers)
    return undefined;
  } catch (error) {
    console.warn(`[resolveTeacherRecordId] Failed to resolve teacherId "${teacherId}":`, error);
    return undefined;
  }
}

export const nexusApi = {
  getTeachers: async (): Promise<Teacher[]> => {
    // Fetch from Airtable - no fallback
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const params = new URLSearchParams({
      pageSize: '100',
    });
    const teachersTableId = getTableId('teachers');
    
    const response = await airtableRequest<{ records: any[] }>(`/${teachersTableId}?${params}`);
    
    const teachers = response.records.map((record: any) => {
      const fields = record.fields || {};
      
      // Use the same logic as getTeachersMap - try multiple field names
      // This matches the exact logic in getTeachersMap (line 567)
      const name = fields['Name'] || fields['Teacher_Name'] || fields['full_name'] || '';
      
      return {
        id: record.id,
        name: name,
        specialties: fields['Specialties'] || fields['specialties'] || [],
      };
    });
    
    return teachers;
  },

  getStudents: async (offsetToken?: string): Promise<{ students: Student[]; nextOffset?: string }> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const params = new URLSearchParams({ pageSize: '100' });
    if (offsetToken) {
      params.set('offset', offsetToken);
    }
    const studentsTableId = getTableId('students');
    const response = await airtableRequest<{ records: any[]; offset?: string }>(`/${studentsTableId}?${params}`);
    const students = response.records.map(mapAirtableToStudent);
    return { students, nextOffset: response.offset };
  },

  updateStudent: async (id: string, updates: Partial<Student>): Promise<Student> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const airtableFields: any = { fields: {} };
    
    if (updates.name !== undefined && updates.name !== '') {
      airtableFields.fields[getField('students', 'full_name')] = updates.name;
    }
    if (updates.phone !== undefined && updates.phone !== '') {
      airtableFields.fields[getField('students', 'phone_number')] = updates.phone;
    }
    if (updates.parentName !== undefined) {
      airtableFields.fields[getField('students', 'parent_name')] = updates.parentName || null;
    }
    if (updates.parentPhone !== undefined) {
      airtableFields.fields[getField('students', 'parent_phone')] = updates.parentPhone || null;
    }
    // Handle grade_level - Single select field (יא, יב, י, ו, ט, ח, ז)
    if (updates.grade !== undefined) {
      // Empty string or null should be sent as null for single select fields
      airtableFields.fields[getField('students', 'grade_level')] = 
        (updates.grade === '' || updates.grade === null || updates.grade === undefined) 
          ? null 
          : updates.grade;
    }
    
    // Handle subject_focus - Multiple select field (מתמטיקה, פיזיקה, אנגלית)
    if (updates.subjectFocus !== undefined) {
      if (updates.subjectFocus === '' || updates.subjectFocus === null || updates.subjectFocus === undefined) {
        airtableFields.fields[getField('students', 'subject_focus')] = null;
      } else if (Array.isArray(updates.subjectFocus)) {
        // Already an array - filter empty values and send
        const validSubjects = updates.subjectFocus.filter(s => s && s.trim());
        airtableFields.fields[getField('students', 'subject_focus')] = validSubjects.length > 0 ? validSubjects : null;
      } else if (typeof updates.subjectFocus === 'string') {
        // Comma-separated string - split and filter
        const subjects = updates.subjectFocus.split(',').map(s => s.trim()).filter(Boolean);
        airtableFields.fields[getField('students', 'subject_focus')] = subjects.length > 0 ? subjects : null;
      } else {
        // Fallback to null for unexpected types
        airtableFields.fields[getField('students', 'subject_focus')] = null;
      }
    }
    
    // Handle level - Single select field (3, 5, 4)
    if (updates.level !== undefined) {
      // Empty string or null should be sent as null for single select fields
      // Convert to string if it's a number (Airtable expects string for select fields)
      const levelValue = updates.level === '' || updates.level === null || updates.level === undefined
        ? null
        : String(updates.level);
      airtableFields.fields[getField('students', 'level')] = levelValue;
    }
    if (updates.weeklyLessonsLimit !== undefined) {
      airtableFields.fields[getField('students', 'weekly_lessons_limit')] = updates.weeklyLessonsLimit;
    }
    // Handle payment_status - Single select field (משלם, מקדמה, חייב)
    if (updates.paymentStatus !== undefined) {
      // Empty string or null should be sent as null for single select fields
      airtableFields.fields[getField('students', 'payment_status')] = 
        (updates.paymentStatus === '' || updates.paymentStatus === null || updates.paymentStatus === undefined)
          ? null
          : updates.paymentStatus;
    }
    if (updates.notes !== undefined) {
      airtableFields.fields[getField('students', 'notes' as any)] = updates.notes || null;
    }
    // Note: Email field doesn't exist in Airtable students table, so we skip it
    // if (updates.email !== undefined) {
    //   airtableFields.fields[getField('students', 'email' as any)] = updates.email || null;
    // }
    
    if (updates.status !== undefined) {
      airtableFields.fields[getField('students', 'is_active')] = updates.status === 'active';
      if (updates.status === 'on_hold') {
        airtableFields.fields[getField('students', 'payment_status')] = 'הקפאה';
      } else if (updates.status === 'active' && updates.paymentStatus === undefined) {
        // Clear הקפאה when reactivating, unless paymentStatus is explicitly set
        const currentPayment = airtableFields.fields[getField('students', 'payment_status')];
        if (currentPayment === undefined) {
          airtableFields.fields[getField('students', 'payment_status')] = null;
        }
      }
    }


    const studentsTableId = getTableId('students');
    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${studentsTableId}/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(airtableFields),
      }
    );

    return mapAirtableToStudent({ id: response.id || id, fields: response.fields });
  },

  createStudent: async (student: Partial<Student>): Promise<Student> => {
    
    if (!getAuthToken()) {
      console.error('[createStudent] Not authenticated');
      throw new Error('Authentication required. Please log in.');
    }

    // Validate required fields
    if (!student.name || !student.phone) {
      console.error('[createStudent] Missing required fields - name:', student.name, 'phone:', student.phone);
      throw { 
        message: 'חובה למלא שם וטלפון', 
        code: 'VALIDATION_ERROR', 
        status: 400 
      };
    }


    // Build Airtable fields
    const airtableFields: any = { fields: {} };
    
    // Required fields
    airtableFields.fields[getField('students', 'full_name')] = student.name;
    airtableFields.fields[getField('students', 'phone_number')] = student.phone;
    
    // Optional fields
    if (student.parentName) {
      airtableFields.fields[getField('students', 'parent_name')] = student.parentName;
    }
    if (student.parentPhone) {
      airtableFields.fields[getField('students', 'parent_phone')] = student.parentPhone;
    }
    // Note: Email field removed - doesn't exist in Airtable students table
    if (student.grade) {
      airtableFields.fields[getField('students', 'grade_level')] = student.grade;
    }
    if (student.subjectFocus) {
      // Handle multiple select - can be comma-separated string or array
      const subjects = typeof student.subjectFocus === 'string' 
        ? student.subjectFocus.split(',').map(s => s.trim()).filter(Boolean)
        : student.subjectFocus;
      airtableFields.fields[getField('students', 'subject_focus')] = subjects;
    }
    if (student.level) {
      airtableFields.fields[getField('students', 'level')] = student.level;
    }
    if (student.weeklyLessonsLimit !== undefined) {
      airtableFields.fields[getField('students', 'weekly_lessons_limit')] = student.weeklyLessonsLimit;
    }
    if (student.paymentStatus) {
      airtableFields.fields[getField('students', 'payment_status')] = student.paymentStatus;
    }
    if (student.notes) {
      airtableFields.fields[getField('students', 'notes' as any)] = student.notes;
    }
    
    // Default values for new students
    airtableFields.fields[getField('students', 'is_active')] = true;
    airtableFields.fields[getField('students', 'registration_date')] = new Date().toISOString().split('T')[0];

    // Create record in Airtable
    const studentsTableId = getTableId('students');
    
    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${studentsTableId}`,
      {
        method: 'POST',
        body: JSON.stringify(airtableFields),
      }
    );

    return mapAirtableToStudent({ id: response.id, fields: response.fields });
  },

  getLessons: async (start: string, end: string, teacherId?: string): Promise<Lesson[]> => {
    // Fetch from Airtable - no fallback
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const lessonsTableId = getTableId('lessons');
    const startDatetimeField = getField('lessons', 'start_datetime');
    const statusField = getField('lessons', 'status');

    // Filter by date range (inclusive of start and end day) with pagination
    const startDate = start.split('T')[0];
    const endDateStr = end.split('T')[0];
    const endDateExclusive = new Date(endDateStr + 'T00:00:00.000Z');
    endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() + 1);
    const endDateExclusiveStr = endDateExclusive.toISOString().split('T')[0];

    let filterFormula = `AND(
      IS_AFTER({${startDatetimeField}}, '${startDate}'),
      IS_BEFORE({${startDatetimeField}}, '${endDateExclusiveStr}')
    )`;
    if (teacherId && teacherId !== 'all') {
      const teacherField = getField('lessons', 'teacher_id');
      filterFormula = `AND(${filterFormula}, {${teacherField}} = '${teacherId}')`;
    }

    const params: Record<string, string> = {
      filterByFormula: filterFormula,
      pageSize: '100',
      'sort[0][field]': startDatetimeField,
      'sort[0][direction]': 'asc',
    };

    const records = await listAllAirtableRecords<Record<string, unknown>>(lessonsTableId, params);

    if (records.length === 0) {
      console.warn(`[DEBUG] Airtable returned 0 records for table ${lessonsTableId} in range`);
      return [];
    }

    
    const lessons = records.map((r: any) => mapAirtableToLesson(r));
    // Exclude cancelled lessons so they don't appear in calendar or affect overlap logic
    const lessonsFiltered = lessons.filter(l => l.status !== LessonStatus.CANCELLED && l.status !== LessonStatus.CANCELLED_BY_ADMIN);

    // Store raw records in a map for modal access
    const rawRecordsMap = new Map<string, any>();
    records.forEach((record: any) => {
      rawRecordsMap.set(record.id, record);
    });
    
    // Return lessons with rawRecords attached (for backward compatibility)
    (lessonsFiltered as any).rawRecords = rawRecordsMap;
    
    return lessonsFiltered;
  },

  getWeeklySlots: async (): Promise<WeeklySlot[]> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const tableId = AIRTABLE_CONFIG.tables.weekly_slot;
    const teachersMap = await getTeachersMap();
    
    // Fetch all records with pagination, sorted by day_num (or day_of_week) asc, start_time asc
    const dayNumField = getField('weeklySlot', 'day_num');
    const dayOfWeekField = getField('weeklySlot', 'day_of_week');
    const startTimeField = getField('weeklySlot', 'start_time');
    // Prefer day_num for sorting, fallback to day_of_week
    const sortField = dayNumField;
    const records = await listAllAirtableRecords(tableId, {
      pageSize: '100',
      'sort[0][field]': sortField,
      'sort[0][direction]': 'asc',
      'sort[1][field]': startTimeField,
      'sort[1][direction]': 'asc',
    });
    
    // Map Airtable records to WeeklySlot objects
    const slots = records.map(record => {
      const fields = record.fields || {};
      
      // Extract teacher_id (linked record array)
      const teacherIdField = getField('weeklySlot', 'teacher_id');
      const teacherIdValue = fields[teacherIdField];
      const teacherId = Array.isArray(teacherIdValue) 
        ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
        : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
      
      // Extract day_num (new normalized field: 1-7 where 1=Sunday, 7=Saturday)
      // Fallback to day_of_week if day_num is not available
      // Normalize to number 0-6 (0=Sunday, 6=Saturday) for internal use
      const dayNumField = getField('weeklySlot', 'day_num');
      const dayNumValue = fields[dayNumField];
      const dayOfWeekValue = fields[dayOfWeekField];
      
      let dayOfWeek: number;
      
      // Prefer day_num over day_of_week
      const rawValue = dayNumValue !== null && dayNumValue !== undefined && dayNumValue !== '' 
        ? dayNumValue 
        : dayOfWeekValue;
      
      // Log raw value for debugging (first 5 records only)
      const recordIndex = records.indexOf(record);
      
      if (rawValue === null || rawValue === undefined || rawValue === '') {
        dayOfWeek = 0; // Default to Sunday
        if (import.meta.env.DEV && recordIndex < 5) {
          console.warn(`[DEBUG getWeeklySlots] Record ${record.id} - day_num/day_of_week is null/undefined/empty, defaulting to 0 (Sunday)`);
        }
      } else if (typeof rawValue === 'string') {
        // Trim whitespace and parse
        const trimmed = rawValue.trim();
        const parsed = parseInt(trimmed, 10);
        // day_num is 1-7 (1=Sunday), convert to 0-6 (0=Sunday)
        // day_of_week might be 0-6, so handle both
        if (!isNaN(parsed)) {
          // If value is 1-7, it's day_num format, convert to 0-6
          if (parsed >= 1 && parsed <= 7) {
            dayOfWeek = parsed - 1; // 1->0, 2->1, ..., 7->6
          } else {
            // Already in 0-6 format
            dayOfWeek = Math.max(0, Math.min(6, parsed));
          }
        } else {
          dayOfWeek = 0;
        }
      } else if (typeof rawValue === 'number') {
        // day_num is 1-7 (1=Sunday), convert to 0-6 (0=Sunday)
        // day_of_week might be 0-6, so handle both
        const num = Math.floor(rawValue);
        if (num >= 1 && num <= 7) {
          dayOfWeek = num - 1; // 1->0, 2->1, ..., 7->6
        } else {
          // Already in 0-6 format
          dayOfWeek = Math.max(0, Math.min(6, num));
        }
      } else {
        dayOfWeek = 0; // Default to Sunday if invalid type
        if (import.meta.env.DEV && recordIndex < 5) {
          console.warn(`[DEBUG getWeeklySlots] Record ${record.id} - Invalid day_num/day_of_week type: ${typeof rawValue}, defaulting to 0`);
        }
      }
      
      // Extract reserved_for (linked record) - can be single or multiple
      const reservedForField = getField('weeklySlot', 'reserved_for');
      const reservedForValue = fields[reservedForField];
      
      // Extract reservedForIds array
      let reservedForIds: string[] = [];
      if (reservedForValue) {
        if (Array.isArray(reservedForValue)) {
          reservedForIds = reservedForValue
            .map(item => typeof item === 'string' ? item : (item?.id || ''))
            .filter(id => id && id.startsWith('rec'));
        } else if (typeof reservedForValue === 'string' && reservedForValue.startsWith('rec')) {
          reservedForIds = [reservedForValue];
        } else if (reservedForValue?.id && reservedForValue.id.startsWith('rec')) {
          reservedForIds = [reservedForValue.id];
        }
      }
      
      // Backward compatibility: single reservedFor
      const reservedFor = reservedForIds.length > 0 ? reservedForIds[0] : undefined;
      
      // Extract lookup field "full_name (from reserved_for)" - try multiple possible field names
      let reservedForNames: string[] = [];
      const lookupFieldNames = [
        'full_name (from reserved_for)',
        'full_name (from reserved_for)',
        'Full Name (from reserved_for)',
        'שם מלא (from reserved_for)',
      ];
      
      for (const lookupFieldName of lookupFieldNames) {
        const lookupValue = fields[lookupFieldName];
        if (lookupValue) {
          if (Array.isArray(lookupValue)) {
            reservedForNames = lookupValue
              .map(item => {
                if (typeof item === 'string') return item.trim();
                if (item && typeof item === 'object' && 'name' in item) return String(item.name).trim();
                return '';
              })
              .filter(name => name.length > 0);
          } else if (typeof lookupValue === 'string') {
            reservedForNames = [lookupValue.trim()].filter(name => name.length > 0);
          }
          if (reservedForNames.length > 0) break;
        }
      }
      
      // Extract קבוע (fixed checkbox)
      const fixedField = getField('weeklySlot', 'קבוע' as any);
      const isFixed = fields[fixedField] === true || fields[fixedField] === 1;
      
      // Extract overlap_with (linked record)
      const overlapWithField = getField('weeklySlot', 'overlap_with');
      const overlapWithValue = fields[overlapWithField];
      const overlapWith = overlapWithValue
        ? (Array.isArray(overlapWithValue) 
            ? (typeof overlapWithValue[0] === 'string' ? overlapWithValue[0] : overlapWithValue[0]?.id || undefined)
            : (typeof overlapWithValue === 'string' ? overlapWithValue : overlapWithValue?.id || undefined))
        : undefined;
      
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
      
      
      return {
        id: record.id,
        dayOfWeek: dayOfWeek,
        startTime: fields[startTimeField] || '',
        endTime: fields[getField('weeklySlot', 'end_time')] || '',
        teacherId: teacherId || '',
        teacherName: teachersMap.get(teacherId || '') || '',
        type: type || 'private', // Only fallback to 'private' if completely missing
        durationMin: fields[getField('weeklySlot', 'duration_min')],
        isFixed: isFixed,
        reservedFor: reservedFor, // Backward compatibility
        reservedForIds: reservedForIds.length > 0 ? reservedForIds : undefined,
        reservedForNames: reservedForNames.length > 0 ? reservedForNames : undefined,
        isReserved: fields[getField('weeklySlot', 'is_reserved')] === true || fields[getField('weeklySlot', 'is_reserved')] === 1,
        hasOverlap: fields[getField('weeklySlot', 'has_overlap')] === true || fields[getField('weeklySlot', 'has_overlap')] === 1,
        overlapWith: overlapWith,
        overlapDetails: fields[getField('weeklySlot', 'overlap_details')],
        capacity: fields[getField('weeklySlot', 'קיבולת' as any)],
        status: 'active', // Default to active
      } as WeeklySlot & { isReserved?: boolean; hasOverlap?: boolean; overlapWith?: string; overlapDetails?: string; capacity?: number };
    });
    
    // Filter out invalid slots (missing required fields)
    // NOTE: We allow slots without teacherId/teacherName to still render (show teacherId as fallback)
    
    const validSlots = slots.filter(slot => {
      // Only filter out slots missing critical time fields
      // Allow slots without teacherId (will show teacherId or "Unknown" in UI)
      const passesStartTime = slot.startTime && slot.startTime !== '';
      const passesEndTime = slot.endTime && slot.endTime !== '';
      
      if (!passesStartTime || !passesEndTime) {
        if (import.meta.env.DEV) {
          console.warn(`[DEBUG getWeeklySlots] Filtering out slot ${slot.id} - missing start_time or end_time`, {
            startTime: slot.startTime,
            endTime: slot.endTime,
          });
        }
        return false;
      }
      return true;
    });
    
    // Group by dayOfWeek for logging
    if (import.meta.env.DEV) {
      const perDayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      validSlots.forEach(slot => {
        // dayOfWeek should already be normalized to number 0-6
        const day = typeof slot.dayOfWeek === 'number' 
          ? Math.floor(slot.dayOfWeek) 
          : (typeof slot.dayOfWeek === 'string' 
              ? parseInt(slot.dayOfWeek.trim(), 10) 
              : 0);
        if (!isNaN(day) && day >= 0 && day <= 6) {
          perDayCounts[day] = (perDayCounts[day] || 0) + 1;
        }
      });
      
      // Warn if all slots are in the same day
      const nonZeroDays = Object.values(perDayCounts).filter(count => count > 0).length;
      if (nonZeroDays === 1 && validSlots.length > 0) {
        const dayWithSlots = Object.entries(perDayCounts).find(([_, count]) => count > 0)?.[0];
        console.error(`[DEBUG getWeeklySlots] ERROR: All ${validSlots.length} slots are in day ${dayWithSlots}!`);
        console.error(`[DEBUG getWeeklySlots] This means all records in Airtable have day_of_week = ${dayWithSlots} or the field is missing/empty.`);
        console.error(`[DEBUG getWeeklySlots] Please check the day_of_week field values in Airtable table ${tableId}.`);
      }
    }
    
    return validSlots as WeeklySlot[];
  },

  getSlotInventory: async (start: string, end: string, teacherId?: string): Promise<SlotInventory[]> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const tableId = AIRTABLE_CONFIG.tables.slot_inventory;
    const teachersMap = await getTeachersMap();
    const dateField = getField('slotInventory', 'תאריך_שיעור'); // Returns 'תאריך שיעור'
    // Use the 'מורה' Linked Record field instead of 'מזהה מורה' text field
    // 'מורה' is the proper Linked Record field that contains valid record IDs
    const teacherIdField = getField('slotInventory', 'מורה');
    const startTimeField = getField('slotInventory', 'שעת_התחלה'); // Returns 'שעת התחלה'
    
    // Build filter formula using direct date comparison (YYYY-MM-DD format)
    // Airtable date fields can be compared directly with date strings
    const startDate = start.split('T')[0]; // Extract date part if datetime
    const endDate = end.split('T')[0]; // Extract date part if datetime
    let filterFormula = `AND({${dateField}} >= "${startDate}", {${dateField}} <= "${endDate}")`;
    
    // Add teacher filter if provided using FIND with ARRAYJOIN
    if (teacherId) {
      const escapedTeacherId = escapeAirtableString(teacherId);
      filterFormula = `AND(${filterFormula}, FIND("${escapedTeacherId}", ARRAYJOIN({${teacherIdField}})) > 0)`;
    }
    
    // Fetch all records with pagination, sorted by date then start time
    const params: Record<string, string | undefined> = {
      filterByFormula: filterFormula,
      pageSize: '100',
      'sort[0][field]': dateField,
      'sort[0][direction]': 'asc',
      'sort[1][field]': startTimeField,
      'sort[1][direction]': 'asc',
    };
    const records = await listAllAirtableRecords(tableId, params);
    
    // PART 1: DEV logging to PROVE duplicates source
    if (import.meta.env?.DEV) {
      const recordIds = records.map(r => r.id);
      const uniqueIds = new Set(recordIds);
      const duplicateById = recordIds.length !== uniqueIds.size;
      
      
      if (duplicateById) {
        const duplicates = recordIds.filter((id, idx) => recordIds.indexOf(id) !== idx);
        console.warn(`  ⚠️ DUPLICATE record.id detected: ${duplicates.length} duplicates`);
        console.warn(`  Duplicate IDs:`, duplicates.slice(0, 10));
      }
      
      // Check duplicates by natural_key
      const naturalKeys = records.map(r => r.fields?.natural_key || '');
      const naturalKeyMap = new Map<string, string[]>();
      naturalKeys.forEach((key, idx) => {
        if (key) {
          if (!naturalKeyMap.has(key)) {
            naturalKeyMap.set(key, []);
          }
          naturalKeyMap.get(key)!.push(records[idx].id);
        }
      });
      const duplicateByNaturalKey = Array.from(naturalKeyMap.entries())
        .filter(([_, ids]) => ids.length > 1);
      
      if (duplicateByNaturalKey.length > 0) {
        console.warn(`  ⚠️ DUPLICATE natural_key detected: ${duplicateByNaturalKey.length} keys with duplicates`);
        duplicateByNaturalKey.slice(0, 5).forEach(([key, ids]) => {
          console.warn(`    natural_key "${key}": ${ids.length} records (${ids.slice(0, 3).join(', ')}...)`);
        });
      }
      
      // Check duplicates by composite key
      const compositeKeys = records.map(r => {
        const fields = r.fields || {};
        const date = fields[dateField] || '';
        const startTime = fields[startTimeField] || '';
        const endTime = fields[getField('slotInventory', 'שעת_סיום')] || '';
        const teacherIdValue = fields[teacherIdField];
        const extractedTeacherId = Array.isArray(teacherIdValue) 
          ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
          : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
        return `${date}|${startTime}|${endTime}|${extractedTeacherId || 'none'}`;
      });
      const compositeKeyMap = new Map<string, string[]>();
      compositeKeys.forEach((key, idx) => {
        if (!compositeKeyMap.has(key)) {
          compositeKeyMap.set(key, []);
        }
        compositeKeyMap.get(key)!.push(records[idx].id);
      });
      const duplicateByCompositeKey = Array.from(compositeKeyMap.entries())
        .filter(([_, ids]) => ids.length > 1);
      
      if (duplicateByCompositeKey.length > 0) {
        console.warn(`  ⚠️ DUPLICATE composite key detected: ${duplicateByCompositeKey.length} keys with duplicates`);
        duplicateByCompositeKey.slice(0, 5).forEach(([key, ids]) => {
          console.warn(`    composite "${key}": ${ids.length} records (${ids.slice(0, 3).join(', ')}...)`);
        });
      }
    }
    
    // Keep records as-is for now (will dedupe in Part 2)
    const deduplicatedRecords = records;
    
    // Map Airtable records to SlotInventory objects (before dedupe)
    const mappedInventory = deduplicatedRecords.map(record => {
      const fields = record.fields || {};
      
      // Extract teacher ID from linked record array
      const teacherIdValue = fields[teacherIdField];
      let extractedTeacherId = Array.isArray(teacherIdValue) 
        ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
        : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
      
      // Validate that extracted teacherId looks like a valid Airtable record ID
      // Airtable record IDs start with "rec" and are typically 17 characters
      if (extractedTeacherId && !extractedTeacherId.startsWith('rec') && extractedTeacherId.length > 0) {
        // Log warning but don't fail - might be valid in some edge cases, but this is unusual
        if (import.meta.env.DEV) {
          console.warn(`[getSlotInventory] teacherId "${extractedTeacherId}" doesn't look like a record ID (expected "rec...")`);
        }
      }
      
      // Extract source weekly slot (נוצר מתוך)
      const sourceField = getField('slotInventory', 'נוצר_מתוך'); // Returns 'נוצר מתוך'
      const sourceValue = fields[sourceField];
      const sourceWeeklySlot = sourceValue
        ? (Array.isArray(sourceValue) 
            ? (typeof sourceValue[0] === 'string' ? sourceValue[0] : sourceValue[0]?.id || undefined)
            : (typeof sourceValue === 'string' ? sourceValue : sourceValue?.id || undefined))
        : undefined;
      
      const statusField = getField('slotInventory', 'סטטוס');
      const status = normalizeSlotStatus(fields[statusField]);
      
      const occupied = fields[getField('slotInventory', 'תפוסה_נוכחית' as any)] as number || 0;
      const capacity = fields[getField('slotInventory', 'קיבולת_כוללת' as any)] as number || 1;

      // Extract student IDs from linked record field
      const studentField = getField('slotInventory', 'תלמידים' as any);
      const studentVal = fields[studentField];
      let studentIds: string[] = [];
      if (Array.isArray(studentVal)) {
        studentIds = studentVal.map((s: any) => typeof s === 'string' ? s : s.id).filter(Boolean);
      }

      // Extract lesson IDs from linked record field (for filtering slots with lessons)
      const lessonsField = getField('slotInventory', 'lessons');
      const lessonsVal = fields[lessonsField] || fields.lessons;
      let lessonIds: string[] = [];
      if (Array.isArray(lessonsVal)) {
        lessonIds = lessonsVal.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
      } else if (lessonsVal) {
        // Handle single linked record (shouldn't happen but be safe)
        lessonIds = [typeof lessonsVal === 'string' ? lessonsVal : lessonsVal.id].filter(Boolean);
      }

      return {
        id: record.id,
        naturalKey: fields.natural_key || '',
        teacherId: extractedTeacherId || '',
        teacherName: teachersMap.get(extractedTeacherId || '') || '',
        lessonDate: fields[dateField] || '',
        date: fields[dateField] || '', // Alias for compatibility
        startTime: fields[startTimeField] || '',
        endTime: fields[getField('slotInventory', 'שעת_סיום')] || '',
        lessonType: fields[getField('slotInventory', 'סוג_שיעור')],
        sourceWeeklySlot: sourceWeeklySlot,
        status: status,
        occupied,
        capacityOptional: capacity,
        students: studentIds,
        lessons: lessonIds, // Include linked lessons for filtering
        startDT: fields.StartDT,
        endDT: fields.EndDT,
        isFull: fields.is_full === true || fields.is_full === 1,
        isBlock: fields.is_block === true || fields.is_block === 1,
        isLocked: fields.is_locked === true || fields.is_locked === 1,
      } as SlotInventory & { 
        naturalKey?: string; 
        lessonDate?: string; 
        lessonType?: string; 
        sourceWeeklySlot?: string; 
        startDT?: string; 
        endDT?: string; 
        isFull?: boolean; 
        isBlock?: boolean; 
        isLocked?: boolean;
      };
    });
    
    // PART 2: Deterministic deduplication by natural_key or composite key
    // Status priority: blocked > closed > open > canceled
    const statusPriority: Record<string, number> = {
      'blocked': 4,
      'closed': 3,
      'open': 2,
      'canceled': 1,
    };
    
    // Helper: normalize natural key to canonical pipe-separated format
    // Handles legacy underscore-separated keys: teacherId_YYYY-MM-DD_HH:mm -> teacherId|YYYY-MM-DD|HH:mm
    const normalizeNK = (key: string): string => {
      if (!key) return key;
      if (key.includes('|')) return key;
      const lastUnderscore = key.lastIndexOf('_');
      if (lastUnderscore === -1) return key;
      const startTime = key.substring(lastUnderscore + 1);
      const rest = key.substring(0, lastUnderscore);
      const secondLastUnderscore = rest.lastIndexOf('_');
      if (secondLastUnderscore === -1) return key;
      const dateStr = rest.substring(secondLastUnderscore + 1);
      const teacherId = rest.substring(0, secondLastUnderscore);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && /^\d{2}:\d{2}$/.test(startTime)) {
        return `${teacherId}|${dateStr}|${startTime}`;
      }
      return key;
    };
    
    // Helper to get dedupe key for a slot
    const getDedupeKey = (slot: SlotInventory & { naturalKey?: string }): string => {
      if (slot.naturalKey && slot.naturalKey.trim() !== '') {
        return `natural_key:${normalizeNK(slot.naturalKey)}`;
      }
      const teacherId = slot.teacherId || 'none';
      return `composite:${slot.date}|${slot.startTime}|${slot.endTime}|${teacherId}`;
    };
    
    // Helper to select winner between two slots
    const selectWinner = (
      slot1: SlotInventory & { naturalKey?: string; lessons?: string[]; students?: string[] },
      slot2: SlotInventory & { naturalKey?: string; lessons?: string[]; students?: string[] }
    ): SlotInventory & { naturalKey?: string } => {
      // 1. Prefer by status priority
      const priority1 = statusPriority[slot1.status] || 0;
      const priority2 = statusPriority[slot2.status] || 0;
      if (priority1 !== priority2) {
        return priority1 > priority2 ? slot1 : slot2;
      }
      
      // 2. If same status, prefer record with linked lessons or students
      const hasLinks1 = (slot1.lessons && slot1.lessons.length > 0) || (slot1.students && slot1.students.length > 0);
      const hasLinks2 = (slot2.lessons && slot2.lessons.length > 0) || (slot2.students && slot2.students.length > 0);
      if (hasLinks1 !== hasLinks2) {
        return hasLinks1 ? slot1 : slot2;
      }
      
      // 3. If still tie, prefer most recently created (by id lexicographically - Airtable IDs are time-ordered)
      return slot1.id > slot2.id ? slot1 : slot2;
    };
    
    // Dedupe by key
    const dedupeMap = new Map<string, SlotInventory & { naturalKey?: string }>();
    const beforeCount = mappedInventory.length;
    
    for (const slot of mappedInventory) {
      const key = getDedupeKey(slot);
      const existing = dedupeMap.get(key);
      
      if (!existing) {
        dedupeMap.set(key, slot);
      } else {
        // Select winner deterministically
        const winner = selectWinner(existing, slot);
        dedupeMap.set(key, winner);
        
      }
    }
    
    const deduplicatedInventory = Array.from(dedupeMap.values());
    const afterCount = deduplicatedInventory.length;
    
    
    // Sort deterministically: by date, then startTime
    deduplicatedInventory.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.startTime.localeCompare(b.startTime);
    });
    
    return deduplicatedInventory as SlotInventory[];
  },

  updateWeeklySlot: async (id: string, updates: Partial<WeeklySlot>): Promise<WeeklySlot> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }
    return updateWeeklySlotService(id, updates);
  },

  updateSlotInventory: async (id: string, updates: Partial<SlotInventory>): Promise<SlotInventory> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const tableId = AIRTABLE_CONFIG.tables.slot_inventory;
    const teachersMap = await getTeachersMap();
    const fields: any = {};
    
    // Use the 'מורה' Linked Record field instead of 'מזהה מורה' text field
    // 'מורה' is the proper Linked Record field that contains valid record IDs
    const teacherIdField = getField('slotInventory', 'מורה');
    
    // Map updates to Airtable field names (using getField for consistency)
    if ((updates as any).naturalKey !== undefined) {
      fields.natural_key = (updates as any).naturalKey;
    }
    if (updates.teacherId !== undefined) {
      // "מורה" must be an array of recordIds (wrap single value)
      // Ensure teacherId is a clean string value, not a stringified array
      let teacherIdValue: string;
      if (Array.isArray(updates.teacherId)) {
        teacherIdValue = typeof updates.teacherId[0] === 'string' ? updates.teacherId[0] : String(updates.teacherId[0]);
        } else if (typeof updates.teacherId === 'string') {
        // If it's already a string, use it directly (but check if it's a stringified array)
        const trimmed = updates.teacherId.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          // It's a stringified array, try to parse it
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) && parsed.length > 0) {
              // Extract the first element and ensure it's a string
              teacherIdValue = typeof parsed[0] === 'string' ? parsed[0] : String(parsed[0] || '');
            } else {
              teacherIdValue = String(parsed || '');
            }
            } catch (parseError) {
            // If parsing fails, try to extract the value manually
            // Remove brackets and quotes, then trim
            teacherIdValue = trimmed.replace(/^\[|\]$/g, '').replace(/"/g, '').replace(/'/g, '').trim();
            }
        } else {
          teacherIdValue = trimmed;
          }
      } else {
        teacherIdValue = String(updates.teacherId);
        }
      
      // Validate that we have a non-empty teacherId
      if (!teacherIdValue || teacherIdValue.trim() === '') {
        throw new Error('teacherId cannot be empty');
      }
      
      // Ensure we're setting an array with a clean string value
      const trimmedTeacherId = teacherIdValue.trim();
      
      // Verify that teacherIdValue looks like a valid Airtable record ID (starts with 'rec')
      if (!trimmedTeacherId.startsWith('rec') && trimmedTeacherId.length > 0) {
        // Check if it exists in teachersMap (maybe it's a valid but short ID?)
        if (!teachersMap.has(trimmedTeacherId)) {
          throw new Error(
            `Invalid teacherId: "${trimmedTeacherId}" is not a valid Airtable record ID. ` +
            `Expected format: "rec..." (17 characters). ` +
            `Please check the slot_inventory record in Airtable - the "מורה" field should contain a linked record ID.`
          );
        }
        // If it exists in teachersMap, it might be valid - but still log a warning
        if (import.meta.env.DEV) {
          console.warn(`[updateSlotInventory] teacherId "${trimmedTeacherId}" doesn't look like a record ID but exists in teachersMap`);
        }
      }
      
      fields[teacherIdField] = [trimmedTeacherId];
      
    }
    if (updates.date !== undefined || (updates as any).lessonDate !== undefined) {
      fields[getField('slotInventory', 'תאריך_שיעור')] = updates.date || (updates as any).lessonDate;
    }
    if (updates.startTime !== undefined) {
      // Format time as HH:mm for Airtable Time field
      // If the field is Single Select, ensure the value exists in options
      const startTimeField = getField('slotInventory', 'שעת_התחלה');
      const formattedStartTime = formatTimeForAirtable(updates.startTime);
      if (formattedStartTime) {
        fields[startTimeField] = formattedStartTime;
      }
    }
    if (updates.endTime !== undefined) {
      // Format time as HH:mm for Airtable Time field
      // If the field is Single Select, ensure the value exists in options
      const endTimeField = getField('slotInventory', 'שעת_סיום');
      const formattedEndTime = formatTimeForAirtable(updates.endTime);
      if (formattedEndTime) {
        fields[endTimeField] = formattedEndTime;
      }
    }
    if ((updates as any).lessonType !== undefined) {
      fields[getField('slotInventory', 'סוג_שיעור')] = (updates as any).lessonType;
    }
    if (updates.status !== undefined) {
      let statusValue = slotStatusToAirtable(updates.status as string);
      
      if (normalizeSlotStatus(statusValue) === 'open') {
        try {
          // Fetch current slot to get date/time/teacher if not in updates
          const currentSlot = await (async () => {
            const currentRecord = await airtableRequest<{ id: string; fields: any }>(`/${tableId}/${id}`);
            const currentFields = currentRecord.fields || {};
            const currentTeacherIdValue = currentFields[teacherIdField];
            const currentTeacherId = Array.isArray(currentTeacherIdValue) 
              ? (typeof currentTeacherIdValue[0] === 'string' ? currentTeacherIdValue[0] : currentTeacherIdValue[0]?.id || '')
              : (typeof currentTeacherIdValue === 'string' ? currentTeacherIdValue : currentTeacherIdValue?.id || '');
            
            return {
              teacherId: currentTeacherId,
              date: currentFields[getField('slotInventory', 'תאריך_שיעור')] || '',
              startTime: currentFields[getField('slotInventory', 'שעת_התחלה')] || '',
              endTime: currentFields[getField('slotInventory', 'שעת_סיום')] || '',
            };
          })();

          const slotTeacherId = updates.teacherId || currentSlot.teacherId;
          const slotDate = updates.date || currentSlot.date;
          const slotStartTime = updates.startTime || currentSlot.startTime;
          const slotEndTime = updates.endTime || currentSlot.endTime;

          if (slotTeacherId && slotDate && slotStartTime && slotEndTime) {
            const { preventSlotOpeningIfLessonsOverlap } = await import('./conflictValidationService');
            const { canOpen, conflictingLessons } = await preventSlotOpeningIfLessonsOverlap(
              slotTeacherId,
              slotDate,
              slotStartTime,
              slotEndTime,
              id
            );

            // NOTE: Changed from blocking to warning-only
            // Previously this would throw CONFLICT_ERROR and prevent opening.
            // Now we allow opening with a warning - slots and lessons are independent entities.
            // The UI (Availability.tsx) already shows warnings for overlapping lessons.
            if (!canOpen && import.meta.env.DEV) {
              console.warn(`[updateSlotInventory] Opening slot ${id} with ${conflictingLessons.length} overlapping lesson(s). ` +
                `Slot will be opened anyway - slots and lessons are independent.`);
            }
            // Allow opening - statusValue remains 'פתוח'
          }
        } catch (checkError: any) {
          // Log but don't fail the update - lesson overlap check is now advisory only
          console.warn(`[updateSlotInventory] Failed to check for lesson overlaps:`, checkError);
        }
      }
      
      fields[getField('slotInventory', 'סטטוס')] = statusValue;
    }
    if ((updates as any).isLocked !== undefined) {
      fields.is_locked = (updates as any).isLocked ? 1 : 0;
    }
    
    // AUTO-RECOMPUTE natural_key when key-forming fields change (startTime, date, teacherId)
    // This prevents stale natural_keys after edits, which would cause duplicate records on next sync/rollover
    const keyFieldsChanging = updates.startTime !== undefined || updates.date !== undefined || (updates as any).lessonDate !== undefined || updates.teacherId !== undefined;
    const hasExplicitNaturalKey = (updates as any).naturalKey !== undefined;
    
    if (keyFieldsChanging && !hasExplicitNaturalKey) {
      try {
        // Fetch current record to get non-changing components
        const currentRecord = await airtableRequest<{ id: string; fields: any }>(`/${tableId}/${id}`);
        const currentFields = currentRecord.fields || {};
        const currentTeacherIdVal = currentFields[teacherIdField];
        const currentTeacherId = Array.isArray(currentTeacherIdVal)
          ? (typeof currentTeacherIdVal[0] === 'string' ? currentTeacherIdVal[0] : currentTeacherIdVal[0]?.id || '')
          : (typeof currentTeacherIdVal === 'string' ? currentTeacherIdVal : currentTeacherIdVal?.id || '');
        const currentDate = currentFields[getField('slotInventory', 'תאריך_שיעור')] || '';
        const currentStartTime = currentFields[getField('slotInventory', 'שעת_התחלה')] || '';
        
        // Use updated values where provided, fall back to current
        const finalTeacherId = updates.teacherId || currentTeacherId;
        const finalDate = updates.date || (updates as any).lessonDate || currentDate;
        const finalStartTime = updates.startTime || currentStartTime;
        
        if (finalTeacherId && finalDate && finalStartTime) {
          const { generateNaturalKeyFromStrings } = await import('./dateUtils');
          const newNaturalKey = generateNaturalKeyFromStrings(finalTeacherId, finalDate, finalStartTime);
          fields.natural_key = newNaturalKey;
          
        }
      } catch (nkError: any) {
        // Don't fail the update if natural_key recomputation fails - log and continue
        console.warn(`[updateSlotInventory] Failed to recompute natural_key:`, nkError);
      }
    }
    
    // Update record in Airtable
    // Use typecast: true to allow Airtable to automatically add new options to Single Select fields
    // This enables adding new time values like "18:05" to the select field options
    const requestBody = { 
      fields,
      typecast: true // Enable automatic option creation for Single Select fields
    };
    const requestBodyString = JSON.stringify(requestBody);
    
    let response: { id: string; fields: any };
    try {
      response = await airtableRequest<{ id: string; fields: any }>(
        `/${tableId}/${id}`,
        {
          method: 'PATCH',
          body: requestBodyString,
        }
      );
    } catch (error: any) {
      // Handle "Insufficient permissions to create new select option" error
      if (error?.message?.includes('Insufficient permissions to create new select option')) {
        const errorMsg = error.message;
        // Extract the field name and value from the error
        const match = errorMsg.match(/select option "([^"]+)"/);
        const problematicValue = match ? match[1] : 'unknown';
        
        // Remove the problematic field from the update and retry
        console.warn(`[updateSlotInventory] Cannot create new select option "${problematicValue}". Removing from update.`);
        
        // Check which field might be causing the issue
        const startTimeField = getField('slotInventory', 'שעת_התחלה');
        const endTimeField = getField('slotInventory', 'שעת_סיום');
        
        if (fields[startTimeField] === problematicValue) {
          delete fields[startTimeField];
          console.warn(`[updateSlotInventory] Removed "${startTimeField}" from update due to insufficient permissions.`);
        }
        if (fields[endTimeField] === problematicValue) {
          delete fields[endTimeField];
          console.warn(`[updateSlotInventory] Removed "${endTimeField}" from update due to insufficient permissions.`);
        }
        
        // Retry without the problematic field, but still with typecast enabled
        if (Object.keys(fields).length > 0) {
          const retryBody = { 
            fields,
            typecast: true // Enable automatic option creation for Single Select fields
          };
          const retryBodyString = JSON.stringify(retryBody);
          response = await airtableRequest<{ id: string; fields: any }>(
            `/${tableId}/${id}`,
            {
              method: 'PATCH',
              body: retryBodyString,
            }
          );
        } else {
          throw new Error(
            `Cannot update slot: The time value "${problematicValue}" is not available in the Airtable select options. ` +
            `Please contact an administrator to add this time option to the field, or use a different time value.`
          );
        }
      } else {
        throw error;
      }
    }
    // Map response back to SlotInventory
    const responseFields = response.fields || {};
    const teacherIdValue = responseFields[teacherIdField];
    const teacherId = Array.isArray(teacherIdValue) 
      ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
      : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
    
    const dateField = getField('slotInventory', 'תאריך_שיעור');
    const statusField = getField('slotInventory', 'סטטוס');
    const status = normalizeSlotStatus(responseFields[statusField]);
    
    // Extract lesson IDs from linked record field
    const lessonsField = getField('slotInventory', 'lessons');
    const lessonsVal = responseFields[lessonsField] || responseFields.lessons;
    let lessonIds: string[] = [];
    if (Array.isArray(lessonsVal)) {
      lessonIds = lessonsVal.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
    } else if (lessonsVal) {
      lessonIds = [typeof lessonsVal === 'string' ? lessonsVal : lessonsVal.id].filter(Boolean);
    }
    
    const updatedInventory: SlotInventory = {
      id: response.id || id,
      teacherId: teacherId || '',
      teacherName: teachersMap.get(teacherId || '') || '',
      date: responseFields[dateField] || '',
      startTime: responseFields[getField('slotInventory', 'שעת_התחלה')] || '',
      endTime: responseFields[getField('slotInventory', 'שעת_סיום')] || '',
      status: status,
      lessons: lessonIds, // Include linked lessons for filtering
    };
    
    return updatedInventory;
  },

  /**
   * Create a new one-time slot inventory record (exception/ad-hoc availability).
   * Used when manually creating availability outside the weekly template system.
   */
  createSlotInventory: async (params: {
    teacherId: string;
    date: string; // YYYY-MM-DD
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    type?: 'private' | 'group' | 'pair';
    status?: string; // Default: 'open'
  }): Promise<SlotInventory> => {
    if (!params.teacherId || !params.date || !params.startTime || !params.endTime) {
      throw { message: 'Missing required fields: teacherId, date, startTime, endTime', code: 'VALIDATION_ERROR', status: 400 };
    }
    
    const { createSlotInventory: createSlotInventorySvc } = await import('./slotManagementService');
    const { generateNaturalKeyFromStrings } = await import('./dateUtils');
    
    const naturalKey = generateNaturalKeyFromStrings(params.teacherId, params.date, params.startTime);
    
    // Map English type to Hebrew for Airtable
    const typeMap: Record<string, string> = {
      'private': 'פרטי',
      'pair': 'זוגי',
      'group': 'קבוצתי',
    };
    
    return createSlotInventorySvc({
      natural_key: naturalKey,
      teacherId: params.teacherId,
      date: new Date(params.date + 'T00:00:00'),
      startTime: params.startTime,
      endTime: params.endTime,
      type: params.type ? (typeMap[params.type] || params.type) : undefined,
      status: params.status || 'open',
    });
  },

  deleteSlotInventory: async (id: string): Promise<void> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const tableId = AIRTABLE_CONFIG.tables.slot_inventory;
    
    // Delete record from Airtable
    await airtableRequest<{ id: string; deleted: boolean }>(
      `/${tableId}/${id}`,
      {
        method: 'DELETE',
      }
    );
    
  },

  createWeeklySlot: async (slot: Partial<WeeklySlot>): Promise<WeeklySlot> => {
    if (!slot.teacherId || slot.dayOfWeek === undefined || !slot.startTime || !slot.endTime || !slot.type) {
      throw { message: 'Missing required fields: teacherId, dayOfWeek, startTime, endTime, type', code: 'VALIDATION_ERROR', status: 400 };
    }
    return createWeeklySlotService({
      teacherId: slot.teacherId,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      type: slot.type,
      isFixed: slot.isFixed,
      isReserved: (slot as any).isReserved,
      reservedFor: slot.reservedFor,
      reservedForIds: slot.reservedForIds,
      durationMin: slot.durationMin,
    });
  },

  /**
   * Reserve a recurring lesson: create/update weekly_slot and create lesson(s) for the target date.
   * Resolves teacherId to Airtable record ID if it is a number (e.g. "1" for רז).
   */
  reserveRecurringLesson: async (params: {
    teacherId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    type: 'private' | 'group' | 'pair';
    reservedForIds: string[];
    durationMin?: number;
    targetDate?: Date;
    weeklySlotId?: string;
  }): Promise<{ weeklySlot: WeeklySlot; lessonIds: string[] }> => {
    const resolvedTeacherId = await resolveTeacherRecordId(params.teacherId) ?? params.teacherId;
    return reserveRecurringLessonService({ ...params, teacherId: resolvedTeacherId });
  },

  deleteWeeklySlot: async (id: string): Promise<void> => {
    return deleteWeeklySlotService(id);
  },

  /**
   * Open a week - create slot inventory and fixed lessons from weekly_slot templates
   * @param weekStart - The start date of the week (Sunday)
   * @returns Object with counts of created slots and lessons
   */
  openWeekSlots: async (weekStart: Date): Promise<{
    slotInventoryCount: number;
    fixedLessonsCount: number;
  }> => {
    return openNewWeekService(weekStart);
  },

  getHomeworkLibrary: async (): Promise<HomeworkLibraryItem[]> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const homeworkTableId = getTableId('homework');
    const params = new URLSearchParams({ pageSize: '100' });
    const response = await airtableRequest<{ records: any[] }>(`/${homeworkTableId}?${params}`);
    return response.records.map((record: any) => {
      const f = record.fields || {};
      const attachments = f['\u05DE\u05E1\u05DE\u05DB\u05D9\u05DD'];
      return {
        id: record.id,
        topic: f['topic'] || '',
        description: f['description'] || '',
        status: f['status'] || '',
        level: f['\u05E8\u05DE\u05D4'] || '',
        grade: f['\u05DB\u05D9\u05EA\u05D4'] || '',
        subTopic: f['\u05EA\u05EA \u05E0\u05D5\u05E9\u05D0'] || '',
        attachments: Array.isArray(attachments)
          ? attachments.map((a: any) => ({ id: a.id, url: a.url, filename: a.filename }))
          : undefined,
      };
    });
  },

  getHomeworkAssignments: async (): Promise<HomeworkAssignment[]> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const assignmentsTableId = getTableId('homeworkAssignments');
    const sortParams = 'sort%5B0%5D%5Bfield%5D=due_date&sort%5B0%5D%5Bdirection%5D=desc';
    const statusMap: Record<string, 'assigned' | 'done' | 'reviewed'> = {
      '\u05D4\u05D5\u05E7\u05E6\u05D4': 'assigned',
      '\u05D4\u05D5\u05D2\u05E9': 'done',
      '\u05E0\u05D1\u05D3\u05E7': 'reviewed',
    };

    const all: HomeworkAssignment[] = [];
    let offsetToken: string | undefined;

    do {
      const offsetParam = offsetToken ? `&offset=${encodeURIComponent(offsetToken)}` : '';
      const response = await airtableRequest<{ records: any[]; offset?: string }>(
        `/${assignmentsTableId}?pageSize=100&${sortParams}${offsetParam}`
      );

      for (const record of response.records) {
        const f = record.fields || {};
        const rawStudentId = f['student_id'];
        const studentId = Array.isArray(rawStudentId) ? rawStudentId[0] || '' : rawStudentId || '';
        all.push({
          id: record.id,
          homeworkId: f['homework_id'] || 0,
          studentId,
          studentName: f['student_name'] || '',
          homeworkTitle: f['homework_title'] || '',
          dueDate: f['due_date'] || '',
          assignedDate: f['assigned_date'] || '',
          status: statusMap[f['status']] || 'assigned',
          notes: f['notes'] || '',
        });
      }

      offsetToken = response.offset;
    } while (offsetToken);

    return all;
  },

  assignHomework: async (payload: Partial<HomeworkAssignment>): Promise<HomeworkAssignment> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const assignmentsTableId = getTableId('homeworkAssignments');
    const today = new Date().toISOString().split('T')[0];
    // student_id may be a linked-record field (expects array) or plain text
    const studentIdValue = payload.studentId?.startsWith('rec')
      ? [payload.studentId]
      : payload.studentId || '';
    const response = await airtableRequest<{ id: string; fields: any }>(`/${assignmentsTableId}`, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          homework_id: payload.homeworkId || 0,
          student_id: studentIdValue,
          student_name: payload.studentName || '',
          homework_title: payload.homeworkTitle || '',
          due_date: payload.dueDate || '',
          assigned_date: today,
          status: '\u05D4\u05D5\u05E7\u05E6\u05D4',
          notes: payload.notes || '',
        },
      }),
    });
    const rawId = response.fields['student_id'];
    return {
      id: response.id,
      homeworkId: response.fields['homework_id'] || payload.homeworkId || 0,
      studentId: Array.isArray(rawId) ? rawId[0] || '' : rawId || payload.studentId || '',
      studentName: response.fields['student_name'] || payload.studentName || '',
      homeworkTitle: response.fields['homework_title'] || payload.homeworkTitle || '',
      dueDate: response.fields['due_date'] || payload.dueDate || '',
      assignedDate: response.fields['assigned_date'] || today,
      status: 'assigned',
      notes: response.fields['notes'] || '',
    };
  },

  createHomeworkLibraryItem: async (item: Partial<HomeworkLibraryItem>): Promise<HomeworkLibraryItem> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }
    const homeworkTableId = getTableId('homework');
    const fields: Record<string, any> = {};
    if (item.topic) fields['topic'] = item.topic;
    if (item.description) fields['description'] = item.description;
    if (item.status) fields['status'] = item.status;
    if (item.level) fields['\u05E8\u05DE\u05D4'] = item.level;
    if (item.grade) fields['\u05DB\u05D9\u05EA\u05D4'] = item.grade;
    if (item.subTopic) fields['\u05EA\u05EA \u05E0\u05D5\u05E9\u05D0'] = item.subTopic;
    if (item.attachments && item.attachments.length > 0) {
      fields['\u05DE\u05E1\u05DE\u05DB\u05D9\u05DD'] = item.attachments.map(a => ({ url: a.url }));
    }
    const response = await airtableRequest<{ id: string; fields: any }>(`/${homeworkTableId}`, {
      method: 'POST',
      body: JSON.stringify({ fields, typecast: true }),
    });
    const f = response.fields || {};
    const attachments = f['\u05DE\u05E1\u05DE\u05DB\u05D9\u05DD'];
    return {
      id: response.id,
      topic: f['topic'] || '',
      description: f['description'] || '',
      status: f['status'] || '',
      level: f['\u05E8\u05DE\u05D4'] || '',
      grade: f['\u05DB\u05D9\u05EA\u05D4'] || '',
      subTopic: f['\u05EA\u05EA \u05E0\u05D5\u05E9\u05D0'] || '',
      attachments: Array.isArray(attachments)
        ? attachments.map((a: any) => ({ id: a.id, url: a.url, filename: a.filename }))
        : undefined,
    };
  },

  updateHomeworkLibraryItem: async (id: string, item: Partial<HomeworkLibraryItem>): Promise<HomeworkLibraryItem> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }
    const homeworkTableId = getTableId('homework');
    const fields: Record<string, any> = {};
    if (item.topic !== undefined) fields['topic'] = item.topic;
    if (item.description !== undefined) fields['description'] = item.description;
    if (item.status !== undefined) fields['status'] = item.status;
    if (item.level !== undefined) fields['\u05E8\u05DE\u05D4'] = item.level;
    if (item.grade !== undefined) fields['\u05DB\u05D9\u05EA\u05D4'] = item.grade;
    if (item.subTopic !== undefined) fields['\u05EA\u05EA \u05E0\u05D5\u05E9\u05D0'] = item.subTopic;
    if (item.attachments !== undefined) {
      // For existing attachments, send their Airtable ID to keep them.
      // For new attachments, send the URL so Airtable downloads them.
      fields['\u05DE\u05E1\u05DE\u05DB\u05D9\u05DD'] = item.attachments.map(a =>
        a.id ? { id: a.id } : { url: a.url }
      );
    }
    const response = await airtableRequest<{ id: string; fields: any }>(`/${homeworkTableId}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    });
    const f = response.fields || {};
    const attachments = f['\u05DE\u05E1\u05DE\u05DB\u05D9\u05DD'];
    return {
      id: response.id,
      topic: f['topic'] || '',
      description: f['description'] || '',
      status: f['status'] || '',
      level: f['\u05E8\u05DE\u05D4'] || '',
      grade: f['\u05DB\u05D9\u05EA\u05D4'] || '',
      subTopic: f['\u05EA\u05EA \u05E0\u05D5\u05E9\u05D0'] || '',
      attachments: Array.isArray(attachments)
        ? attachments.map((a: any) => ({ id: a.id, url: a.url, filename: a.filename }))
        : undefined,
    };
  },

  deleteHomeworkLibraryItem: async (id: string): Promise<void> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }
    const homeworkTableId = getTableId('homework');
    await airtableRequest(`/${homeworkTableId}/${id}`, {
      method: 'DELETE',
    });
  },

  uploadTmpFile: async (file: File): Promise<{ url: string; fileId: string }> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }
    const token = getAuthToken();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const response = await fetch(apiUrl('/api/tmp-upload'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        data: base64,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Upload failed: ${errText}`);
    }
    return response.json();
  },

  updateLesson: async (id: string, updates: Partial<Lesson>): Promise<Lesson> => {
    // Update in Airtable - no fallback
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    // NOTE: Slot conflict checking removed from updateLesson
    // Reason: If lesson was created from slot_inventory, the slot is already closed.
    // If lesson was created manually, there's no relationship to slots.
    // This prevents the bidirectional coupling issue where editing lessons
    // could unexpectedly close open slots or be blocked by them.
    // Slot management is handled separately via slot_inventory UI.

    const airtableFields = mapLessonToAirtable(updates);
    const lessonsTableId = getTableId('lessons');
    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${lessonsTableId}/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ ...airtableFields, typecast: true }),
      }
    );
    // Airtable returns { id, fields } on PATCH
    const updatedLesson = mapAirtableToLesson({ id: response.id || id, fields: response.fields });
    return updatedLesson;
  },

  getBillingKPIs: async (month: string): Promise<ChargesReportKPIs> => {
    try {
      const kpis = await getChargesReportKPIs(airtableClient, month);
      return kpis;
    } catch (error) {
      console.error('[nexusApi] Error fetching billing KPIs:', error);
      throw error;
    }
  },

  /** Cancellations KPIs for dashboard: total, late (<24h), late %, revenue from charged cancellations */
  getCancellationsKPIs: async (month: string): Promise<{
    totalCancellations: number;
    lateCancellations: number;
    latePercent: number;
    revenueFromLate: number;
  }> => {
    if (!getAuthToken()) {
      return { totalCancellations: 0, lateCancellations: 0, latePercent: 0, revenueFromLate: 0 };
    }
    try {
      const tableId = getTableId('cancellations');
      const billingMonthField = getField('cancellations', 'billing_month');
      const isLt24Field = getField('cancellations', 'is_lt_24h');
      const isChargedField = getField('cancellations', 'is_charged');
      const chargeField = getField('cancellations', 'charge');
      const filter = `{${billingMonthField}} = "${month}"`;
      const records = await airtableClient.listRecords<Record<string, unknown>>(tableId, {
        filterByFormula: filter,
        maxRecords: 5000,
      });
      let late = 0;
      let revenueFromLate = 0;
      for (const r of records) {
        const f = r.fields || {};
        const isLate = f[isLt24Field] === 1 || f[isLt24Field] === '1' || f[isLt24Field] === true;
        if (isLate) late++;
        const charged = f[isChargedField] === true || f[isChargedField] === 1;
        if (charged) revenueFromLate += Number(f[chargeField]) || 0;
      }
      const total = records.length;
      return {
        totalCancellations: total,
        lateCancellations: late,
        latePercent: total ? Math.round((late / total) * 1000) / 10 : 0,
        revenueFromLate: Math.round(revenueFromLate * 100) / 100,
      };
    } catch (err) {
      console.warn('[nexusApi.getCancellationsKPIs]', err);
      return { totalCancellations: 0, lateCancellations: 0, latePercent: 0, revenueFromLate: 0 };
    }
  },

  getMonthlyBills: async (
    month: string,
    options?: { statusFilter?: 'all' | 'draft' | 'sent' | 'paid' | 'link_sent'; searchQuery?: string }
  ): Promise<MonthlyBill[]> => {
    try {
      // Pass status filter directly to API (no mapping needed - getChargesReport supports all values)
      const apiStatusFilter: 'all' | 'draft' | 'sent' | 'paid' | 'link_sent' = options?.statusFilter || 'all';
      
      
      // Use the new charges report service with filters
      const report = await getChargesReport(airtableClient, {
        billingMonth: month,
        statusFilter: apiStatusFilter,
        searchQuery: options?.searchQuery,
      });
      
      
      // Update cached schema if not already set (discovery already happened inside getChargesReport)
      if (!cachedChargeSchema) {
        const schemaResult = await discoverChargeTableSchema(airtableClient);
        if (!Array.isArray(schemaResult)) {
          cachedChargeSchema = schemaResult;
        }
      }
      
      // Build student name and parent info map
      const studentIds = new Set<string>();
      for (const row of report.rows) {
        if (row.studentRecordId) {
          studentIds.add(row.studentRecordId);
        } else if (typeof row.displayName === 'string' && row.displayName.startsWith('rec')) {
          studentIds.add(row.displayName);
        }
      }

      const studentNameMap = new Map<string, { name: string; parentName?: string; parentPhone?: string }>();
      if (studentIds.size > 0 && getAuthToken()) {
        const studentsTableId = getTableId('students');
        const allIds = Array.from(studentIds);
        const chunkSize = 50; 

        for (let i = 0; i < allIds.length; i += chunkSize) {
          const chunk = allIds.slice(i, i + chunkSize);
          const filterByFormula = `OR(${chunk.map(id => `RECORD_ID() = "${id}"`).join(',')})`;
          const params = new URLSearchParams({
            filterByFormula,
            pageSize: String(chunk.length),
            maxRecords: String(chunk.length),
          });

          const response = await airtableRequest<{ records: any[] }>(`/${studentsTableId}?${params}`);
          for (const rec of response.records) {
            const fields = rec.fields || {};
            const name = fields[getField('students', 'full_name')] || fields['full_name'];
            const parentName = fields[getField('students', 'parent_name')] || fields['parent_name'];
            const parentPhone = fields[getField('students', 'parent_phone')] || fields['parent_phone'];

            if (name && typeof name === 'string') {
              studentNameMap.set(rec.id, { 
                name, 
                parentName: typeof parentName === 'string' ? parentName : undefined,
                parentPhone: typeof parentPhone === 'string' ? parentPhone : undefined
              });
            }
          }
        }
      }

      // Map ChargeReportRow to MonthlyBill format
      return report.rows.map(row => {
        // Map derivedStatus to MonthlyBill status
        let status: MonthlyBill['status'] = 'draft';
        if (row.derivedStatus === 'שולם') {
          status = 'paid';
        } else if (row.derivedStatus === 'נשלח') {
          status = 'link_sent';
        } else {
          status = 'draft';
        }
        
        const resolvedStudentId = row.studentRecordId || (typeof row.displayName === 'string' && row.displayName.startsWith('rec') ? row.displayName : '');
        const studentInfo = resolvedStudentId ? studentNameMap.get(resolvedStudentId) : undefined;
        let studentName = studentInfo?.name || row.displayName;

        if (!studentName || (studentName.startsWith('rec') && studentName.length > 3)) {
          studentName = 'לא צוין';
        }

        // Calculate amounts correctly
        const adjustmentAmount = typeof row.manualAdjustmentAmount === 'number' ? row.manualAdjustmentAmount : 0;
        const cancellationsAmount = typeof row.cancellationsAmount === 'number' ? row.cancellationsAmount : 0;
        let subscriptionsAmount = typeof row.subscriptionsAmount === 'number' ? row.subscriptionsAmount : 0;
        let lessonsAmount = typeof row.lessonsAmount === 'number' ? row.lessonsAmount : 0;
        let totalAmount = typeof row.totalAmount === 'number' ? row.totalAmount : 0;

        // Only fill total when missing (total from total_amount; include all components per subscription logic)
        if (totalAmount === 0 && (subscriptionsAmount !== 0 || lessonsAmount !== 0 || cancellationsAmount !== 0)) {
          totalAmount = lessonsAmount + subscriptionsAmount + cancellationsAmount + adjustmentAmount;
        }

        // Build line items
        const lineItems: BillLineItem[] = [];
        if (subscriptionsAmount !== 0) {
          lineItems.push({
            id: `${row.chargeRecordId}_subscription`,
            description: `דמי מנוי חודשיים (${row.subscriptionsCount || 0} מנויים)`,
            amount: subscriptionsAmount,
            type: 'subscription',
          });
        }
        if (lessonsAmount !== 0 || (row.lessonsCount && row.lessonsCount > 0)) {
          lineItems.push({
            id: `${row.chargeRecordId}_lessons_summary`,
            description: `שיעורים שבוצעו (${row.lessonsCount || 0} שיעורים)`,
            amount: lessonsAmount,
            type: 'lesson',
          });
        }
        if (adjustmentAmount !== 0) {
          lineItems.push({
            id: `${row.chargeRecordId}_adjustment`,
            description: row.manualAdjustmentReason || 'התאמה ידנית',
            amount: adjustmentAmount,
            type: 'adjustment',
            date: row.manualAdjustmentDate,
          });
        }

        return {
          id: row.chargeRecordId,
          studentId: row.studentRecordId,
          studentName,
          parentName: studentInfo?.parentName,
          parentPhone: studentInfo?.parentPhone,
          month: month,
          lessonsAmount,
          lessonsCount: row.lessonsCount,
          subscriptionsAmount,
          cancellationsAmount: row.cancellationsAmount,
          adjustmentAmount,
          totalAmount,
          status,
          approved: row.flags.approved,
          linkSent: row.flags.linkSent,
          paid: row.flags.paid,
          manualAdjustmentAmount: row.manualAdjustmentAmount,
          manualAdjustmentReason: row.manualAdjustmentReason,
          manualAdjustmentDate: row.manualAdjustmentDate,
          lineItems,
        };
      });
    } catch (error: any) {
      console.error('[nexusApi] Error fetching monthly bills:', error);
      
      // Handle 403 errors (table access/permission issues)
      if (error.status === 403 || error.code === 'AIRTABLE_TABLE_ACCESS_ERROR') {
        console.error('[nexusApi] Table access error:', error.details);
        const tableId = error.details?.tableId || 'unknown';
        alert(
          `שגיאת גישה לטבלת חיובים:\n\n` +
          `טבלה ID: ${tableId}\n` +
          `שגיאה: ${error.message}\n\n` +
          `אנא בדוק:\n` +
          `1. האם טבלת "חיובים" קיימת ב-Airtable\n` +
          `2. האם מפתח ה-API יכול לגשת לטבלה זו\n` +
          `3. האם ה-Table ID ב-config/airtable.ts נכון`
        );
        // Return empty array instead of mock data for 403 errors
        return [];
      }
      
      // Fallback to mock data if there's an error
      if (error.MISSING_FIELDS) {
        console.error('[nexusApi] Missing fields error:', error.MISSING_FIELDS);
        alert(`שגיאה: שדות חסרים בטבלת חיובים. אנא בדוק את התצורה.\n\n${JSON.stringify(error.MISSING_FIELDS, null, 2)}`);
      }
      // Return empty array or fallback to mock
      return mockData.getMonthlyBills(month);
    }
  },

  getBillingBreakdown: async (studentId: string, month: string): Promise<BillingBreakdown> => {
    return getBillingBreakdown(airtableClient, studentId, month);
  },

  updateBillStatus: async (billId: string, fields: { approved?: boolean; linkSent?: boolean; paid?: boolean }): Promise<void> => {
    const billingTableId = getTableId('monthlyBills');
    
    const performUpdate = async (approvedField: string, linkSentField: string, paidField: string) => {
      const airtableFields: Record<string, any> = {};
      if (fields.approved !== undefined) airtableFields[approvedField] = fields.approved;
      if (fields.linkSent !== undefined) airtableFields[linkSentField] = fields.linkSent;
      if (fields.paid !== undefined) airtableFields[paidField] = fields.paid;


      return await airtableClient.updateRecord(billingTableId, billId, airtableFields, { typecast: true });
    };

    try {

      // Try multiple known variations of field names if discovery is not reliable
      const approvedVariations = ['מאושר לחיוב', 'מאושר_לחיוב', 'Approved', 'מאושר'];
      const linkSentVariations = ['נשלח קישור', 'נשלח_קישור', 'Link Sent', 'נשלח'];
      const paidVariations = ['שולם', 'Paid', 'שולם?'];

      // 1. If we have a cached schema from a previous successful discovery, use it
      if (cachedChargeSchema) {
        try {
          await performUpdate(cachedChargeSchema.approvedField, cachedChargeSchema.linkSentField, cachedChargeSchema.paidField);
          return;
        } catch (e) {
          console.warn('[nexusApi] Cached schema failed, clearing cache and trying fallbacks');
          cachedChargeSchema = null;
        }
      }

      // 2. Try discovery
      const discoveryResult = await discoverChargeTableSchema(airtableClient);
      if (!Array.isArray(discoveryResult)) {
        try {
          await performUpdate(discoveryResult.approvedField, discoveryResult.linkSentField, discoveryResult.paidField);
          cachedChargeSchema = discoveryResult;
          return;
        } catch (e) {
          console.warn('[nexusApi] Discovery result failed, trying hardcoded defaults');
        }
      }

      // 3. Last resort: Try hardcoded defaults from config
      const defaultApproved = AIRTABLE_CONFIG.fields.billingApproved || 'מאושר לחיוב';
      const defaultLinkSent = AIRTABLE_CONFIG.fields.billingLinkSent || 'נשלח קישור';
      const defaultPaid = AIRTABLE_CONFIG.fields.billingPaid || 'שולם';

      await performUpdate(defaultApproved, defaultLinkSent, defaultPaid);


    } catch (error: any) {
      console.error('[nexusApi.updateBillStatus] Final update failure:', {
        billId,
        fields,
        message: error.message,
        details: error.details
      });
      throw error;
    }
  },

  approveAndSendBill: (id: string): Promise<void> => {
    // Mock action only
    console.warn('Mock: Approve and send billed (UI only)');
    return Promise.resolve();
  },

  markBillPaid: (id: string): Promise<void> => {
    // Mock action only
    console.warn('Mock: Mark paid billed (UI only)');
    return Promise.resolve();
  },

  // Map Airtable record to Subscription
  mapAirtableToSubscription: (record: any): Subscription => {
    const fields = record.fields || {};
    // Try multiple possible field name variations (snake_case, camelCase, with/without underscores)
    const getField = (variations: string[]) => {
      for (const name of variations) {
        if (fields[name] !== undefined && fields[name] !== null && fields[name] !== '') {
          return fields[name];
        }
      }
      return '';
    };
    
    // Handle linked record (student_id) - can be array of IDs or array of objects
    const studentIdField = fields['student_id'] || fields['Student_ID'] || fields['studentId'] || fields['StudentId'];
    const studentId = Array.isArray(studentIdField) 
      ? (typeof studentIdField[0] === 'string' ? studentIdField[0] : studentIdField[0]?.id || '')
      : (studentIdField || '');

    return {
      id: record.id,
      studentId: studentId,
      fullName: getField(['full_name', 'Full_Name', 'fullName', 'FullName']) || '',
      subscriptionStartDate: getField(['subscription_start_date', 'Subscription_Start_Date', 'subscriptionStartDate', 'SubscriptionStartDate']) || '',
      subscriptionEndDate: getField(['subscription_end_date', 'Subscription_End_Date', 'subscriptionEndDate', 'SubscriptionEndDate']) || '',
      monthlyAmount: getField(['monthly_amount', 'Monthly_Amount', 'monthlyAmount', 'MonthlyAmount']) || '',
      subscriptionType: getField(['subscription_type', 'Subscription_Type', 'subscriptionType', 'SubscriptionType']) || '',
      pauseSubscription: fields['pause_subscription'] || fields['Pause_Subscription'] || fields['pauseSubscription'] || fields['PauseSubscription'] || false,
      pauseDate: getField(['pause_date', 'Pause_Date', 'pauseDate', 'PauseDate']) || '',
    };
  },

  getSubscriptions: async (): Promise<Subscription[]> => {
    // Fetch from Airtable
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const params = new URLSearchParams({
      pageSize: '100',
    });
    const subscriptionsTableId = getTableId('subscriptions');
    const response = await airtableRequest<{ records: any[] }>(`/${subscriptionsTableId}?${params}`);
    const subscriptions = response.records.map((record: any) => nexusApi.mapAirtableToSubscription(record));
    return subscriptions;
  },

  createSubscription: async (subscription: Partial<Subscription>): Promise<Subscription> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    if (!subscription.studentId) {
      throw { message: 'Missing required field: studentId', code: 'VALIDATION_ERROR', status: 400 };
    }

    const airtableFields: any = {
      fields: {},
    };

    // Add student link
    if (subscription.studentId) {
      airtableFields.fields['student_id'] = [subscription.studentId];
    }

    // Add optional fields
    if (subscription.subscriptionStartDate) {
      airtableFields.fields['subscription_start_date'] = subscription.subscriptionStartDate;
    }
    if (subscription.subscriptionEndDate) {
      airtableFields.fields['subscription_end_date'] = subscription.subscriptionEndDate;
    }
    if (subscription.monthlyAmount) {
      airtableFields.fields['monthly_amount'] = subscription.monthlyAmount;
    }
    if (subscription.subscriptionType) {
      airtableFields.fields['subscription_type'] = subscription.subscriptionType;
    }
    if (subscription.pauseSubscription !== undefined) {
      airtableFields.fields['pause_subscription'] = subscription.pauseSubscription;
    }
    if (subscription.pauseDate) {
      airtableFields.fields['pause_date'] = subscription.pauseDate;
    }

    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${AIRTABLE_CONFIG.tables.subscriptions}`,
      {
        method: 'POST',
        body: JSON.stringify(airtableFields),
      }
    );

    const newSubscription = nexusApi.mapAirtableToSubscription({ id: response.id, fields: response.fields });
    return newSubscription;
  },

  updateSubscription: async (id: string, updates: Partial<Subscription>): Promise<Subscription> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const airtableFields: any = {
      fields: {},
    };

    // Add student link if provided
    if (updates.studentId) {
      airtableFields.fields['student_id'] = [updates.studentId];
    }

    // Add optional fields
    if (updates.subscriptionStartDate !== undefined) {
      airtableFields.fields['subscription_start_date'] = updates.subscriptionStartDate || null;
    }
    if (updates.subscriptionEndDate !== undefined) {
      airtableFields.fields['subscription_end_date'] = updates.subscriptionEndDate || null;
    }
    if (updates.monthlyAmount !== undefined) {
      airtableFields.fields['monthly_amount'] = updates.monthlyAmount || null;
    }
    if (updates.subscriptionType !== undefined) {
      airtableFields.fields['subscription_type'] = updates.subscriptionType || null;
    }
    if (updates.pauseSubscription !== undefined) {
      airtableFields.fields['pause_subscription'] = updates.pauseSubscription || false;
    }
    if (updates.pauseDate !== undefined) {
      airtableFields.fields['pause_date'] = updates.pauseDate || null;
    }

    const subscriptionsTableId = getTableId('subscriptions');
    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${subscriptionsTableId}/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(airtableFields),
      }
    );

    const updatedSubscription = nexusApi.mapAirtableToSubscription({ id: response.id || id, fields: response.fields });
    return updatedSubscription;
  },

  pauseSubscription: async (id: string): Promise<Subscription> => {
    return nexusApi.updateSubscription(id, {
      pauseSubscription: true,
      pauseDate: new Date().toISOString().split('T')[0],
    });
  },

  resumeSubscription: async (id: string): Promise<Subscription> => {
    return nexusApi.updateSubscription(id, {
      pauseSubscription: false,
      pauseDate: null,
    });
  },

  searchStudents: async (query: string, limit: number = 15): Promise<Student[]> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    if (query.length < 2) {
      return [];
    }

    const searchQuery = query.trim().toLowerCase();
    const isActiveField = getField('students', 'is_active');
    const fullNameField = getField('students', 'full_name');
    const phoneField = getField('students', 'phone_number');

    // Try formula-based search first
    try {
      const filterFormula = `AND(
        {${isActiveField}}=TRUE(),
        OR(
          SEARCH(LOWER("${searchQuery}"), LOWER({${fullNameField}}&"")),
          SEARCH(LOWER("${searchQuery}"), LOWER({${phoneField}}&""))
        )
      )`;

      const params = new URLSearchParams({
        filterByFormula: filterFormula,
        pageSize: String(limit),
        maxRecords: String(limit),
      });
      params.append('sort[0][field]', fullNameField);
      params.append('sort[0][direction]', 'asc');

      const studentsTableId = getTableId('students');
      const response = await airtableRequest<{ records: any[] }>(`/${studentsTableId}?${params}`);
      const students = response.records.map(mapAirtableToStudent);

      if (students.length > 0) {
        return students;
      }
    } catch (formulaError: any) {
      console.warn('[searchStudents] Formula search failed, falling back to local filter:', formulaError);
    }

    // Fallback: fetch first page and filter locally
    try {
      const params = new URLSearchParams({ pageSize: '100' });
      const studentsTableId = getTableId('students');
      const response = await airtableRequest<{ records: any[] }>(`/${studentsTableId}?${params}`);
      const allStudents = response.records.map(mapAirtableToStudent);

      return allStudents
        .filter(student => {
          if (student.status === 'inactive') return false;
          const nameMatch = student.name?.toLowerCase().includes(searchQuery);
          const phoneMatch = student.phone?.toLowerCase().includes(searchQuery);
          return nameMatch || phoneMatch;
        })
        .slice(0, limit)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
    } catch (fallbackError: any) {
      console.error('[searchStudents] Fallback also failed:', fallbackError);
      return [];
    }
  },

  getStudentByRecordId: async (recordId: string): Promise<Student | null> => {
    if (!recordId || !recordId.startsWith('rec')) return null;
    
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    try {
      const studentsTableId = getTableId('students');
      const response = await airtableRequest<{ id: string; fields: any }>(`/${studentsTableId}/${recordId}`);
      
      
      return mapAirtableToStudent(response);
    } catch (err: any) {
      if (import.meta.env.DEV) {
        console.error('[nexusApi.getStudentByRecordId] Failed to fetch student:', recordId, err);
      }
      return null;
    }
  },

  // Check for lesson conflicts (overlaps)
  checkLessonConflicts: async (
    startDatetime: string,
    endDatetime: string,
    studentId?: string,
    teacherId?: string,
    excludeLessonId?: string
  ): Promise<Lesson[]> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    // Build filter formula for overlapping lessons
    // Overlap condition: existing_start < new_end AND existing_end > new_start
    // Exclude cancelled lessons
    const statusField = getField('lessons', 'status');
    const startDatetimeField = getField('lessons', 'start_datetime');
    const endDatetimeField = getField('lessons', 'end_datetime');
    const studentField = getField('lessons', 'full_name'); // Linked record to students
    const teacherField = getField('lessons', 'teacher_id'); // Linked record to teachers
    
    let filterFormula = `AND(
      {${statusField}} != 'בוטל',
      {${startDatetimeField}} < '${endDatetime}',
      {${endDatetimeField}} > '${startDatetime}'
    )`;

    // Note: Airtable linked record filtering in formulas can be complex
    // We'll filter by student/teacher client-side after fetching for accuracy

    const params = new URLSearchParams({
      filterByFormula: filterFormula,
      pageSize: '100',
    });

    const lessonsTableId = getTableId('lessons');
    const response = await airtableRequest<{ records: any[] }>(`/${lessonsTableId}?${params}`);
    
    // Filter client-side:
    // 1. Exclude the current lesson if updating
    // 2. Filter by student if provided (check if studentId is in the linked record array)
    // 3. Filter by teacher if provided
    let filteredRecords = response.records;
    
    if (excludeLessonId) {
      filteredRecords = filteredRecords.filter(r => r.id !== excludeLessonId);
    }
    
    if (studentId) {
      filteredRecords = filteredRecords.filter(record => {
        const studentFieldValue = record.fields?.[studentField];
        if (Array.isArray(studentFieldValue)) {
          // Check if any linked record ID matches
          const matches = studentFieldValue.some((link: any) => {
            const linkId = typeof link === 'string' ? link : link.id;
            return linkId === studentId;
          });
          return matches;
        }
        return false;
      });
      }
    
    if (teacherId) {
      filteredRecords = filteredRecords.filter(record => {
        const teacherFieldValue = record.fields?.[teacherField];
        if (Array.isArray(teacherFieldValue)) {
          return teacherFieldValue.some((link: any) => 
            (typeof link === 'string' ? link : link.id) === teacherId
          );
        }
        return false;
      });
    }
    
    const conflicts = filteredRecords.map(mapAirtableToLesson);
    return conflicts;
  },

  // Create a new lesson with server-side validation
  createLesson: async (lesson: Partial<Lesson>): Promise<Lesson> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    // Validate required fields
    if (!lesson.date || !lesson.startTime || !lesson.duration || !lesson.studentId) {
      throw { message: 'Missing required fields: date, startTime, duration, studentId', code: 'VALIDATION_ERROR', status: 400 };
    }

    // Pre-flight validation: Verify studentId exists in Students table
    // This helps catch issues before sending to Airtable
    try {
      const studentCheckParams = new URLSearchParams({
        filterByFormula: `RECORD_ID() = '${lesson.studentId}'`,
        maxRecords: '1',
      });
      const studentsTableId = getTableId('students');
      const studentCheck = await airtableRequest<{ records: any[] }>(
        `/${studentsTableId}?${studentCheckParams}`
      );
      if (!studentCheck.records || studentCheck.records.length === 0) {
        console.warn(`[DEBUG createLesson] WARNING - Student ID ${lesson.studentId} not found in Students table`);
      } else {
      }
    } catch (verifyError) {
      console.warn(`[DEBUG createLesson] Could not verify student ID (non-blocking):`, verifyError);
    }

    // PART B: Validate studentId with strict guard
    // Extract student ID (handle array case)
    let studentRecordId: string;
    if (Array.isArray(lesson.studentId)) {
      studentRecordId = lesson.studentId[0];
    } else {
      studentRecordId = lesson.studentId;
    }
    
    // Strict validation: must be a valid Airtable record ID
    if (!studentRecordId || typeof studentRecordId !== 'string' || !studentRecordId.startsWith('rec')) {
      const errorMessage = `Invalid student ID format. Expected Airtable record ID starting with "rec", got: ${JSON.stringify(lesson.studentId)}`;
      console.error(`[DEBUG createLesson] PART B - ${errorMessage}`);
      throw { 
        message: errorMessage,
        code: 'VALIDATION_ERROR', 
        status: 400 
      };
    }
    

    // PART C: Calculate start_datetime and end_datetime
    // FIX: Airtable interprets datetimes without timezone as UTC
    // So we need to send UTC times to Airtable, not local times
    // User inputs local time (e.g., 08:00 Israel time), we convert to UTC for Airtable
    
    // Parse the local time input as local time
    const localStartDatetime = `${lesson.date}T${lesson.startTime}:00`;
    const localStartDate = new Date(localStartDatetime);
    
    if (isNaN(localStartDate.getTime())) {
      throw {
        message: `Invalid date/time format: ${localStartDatetime}`,
        code: 'VALIDATION_ERROR',
        status: 400
      };
    }
    
    // Convert local time to UTC for Airtable (Airtable stores as UTC)
    const startDatetime = localStartDate.toISOString(); // Full ISO string with Z (UTC)
    
    // Calculate end time in UTC
    const endDate = new Date(localStartDate.getTime() + (lesson.duration * 60 * 1000));
    const endDatetime = endDate.toISOString(); // Full ISO string with Z (UTC)
    
    // Validation: Ensure end > start
    const startTimeMs = localStartDate.getTime();
    const endTimeMs = endDate.getTime();
    if (endTimeMs <= startTimeMs) {
      throw {
        message: `Invalid duration: end time must be after start time. Start: ${startDatetime}, End: ${endDatetime}`,
        code: 'VALIDATION_ERROR',
        status: 400
      };
    }
    

    // Server-side conflict check (call the function directly, not through nexusApi to avoid circular reference)
    const conflicts = await (async () => {
      if (!getAuthToken()) {
        throw new Error('Authentication required. Please log in.');
      }

      // Build filter formula for overlapping lessons
      // Overlap condition: existing_start < new_end AND existing_end > new_start
      // Exclude cancelled lessons
      const statusField = getField('lessons', 'status');
      const startDatetimeField = getField('lessons', 'start_datetime');
      const endDatetimeField = getField('lessons', 'end_datetime');
      const studentField = getField('lessons', 'full_name'); // Linked record to students
      const teacherField = getField('lessons', 'teacher_id'); // Linked record to teachers
      
      let filterFormula = `AND(
        {${statusField}} != 'בוטל',
        {${startDatetimeField}} < '${endDatetime}',
        {${endDatetimeField}} > '${startDatetime}'
      )`;

      // Note: Airtable linked record filtering in formulas uses the field name directly
      // The filter will be applied client-side for accuracy (see below)
      // We don't add student/teacher filters to the formula here to keep it simple

      const params = new URLSearchParams({
        filterByFormula: filterFormula,
        pageSize: '100',
      });

      const lessonsTableId = getTableId('lessons');
      const response = await airtableRequest<{ records: any[] }>(`/${lessonsTableId}?${params}`);
      
      // Filter client-side by student and teacher if provided
      let filteredRecords = response.records;
      
      if (lesson.studentId) {
        filteredRecords = filteredRecords.filter(record => {
          const studentFieldValue = record.fields?.[studentField];
          if (Array.isArray(studentFieldValue)) {
            // Check if any linked record ID matches
            const matches = studentFieldValue.some((link: any) => {
              const linkId = typeof link === 'string' ? link : link.id;
              return linkId === lesson.studentId;
            });
            return matches;
          }
          return false;
        });
        }
      
      if (lesson.teacherId) {
        filteredRecords = filteredRecords.filter(record => {
          const teacherFieldValue = record.fields?.[teacherField];
          if (Array.isArray(teacherFieldValue)) {
            return teacherFieldValue.some((link: any) => 
              (typeof link === 'string' ? link : link.id) === lesson.teacherId
            );
          }
          return false;
        });
      }
      
      const mappedConflicts = filteredRecords.map(mapAirtableToLesson);
      
      return mappedConflicts;
    })();

    if (conflicts.length > 0) {
      // Build detailed conflict message
      const conflictDetails = conflicts.map(c => 
        `${c.studentName || 'ללא שם'} - ${c.date} ${c.startTime} (${c.duration || 60} דקות)`
      ).join(', ');
      
      const conflictError: any = {
        message: `לא ניתן לקבוע שיעורים חופפים. שיעור זה חופף עם ${conflicts.length} שיעור${conflicts.length > 1 ? 'ים' : ''} קיים${conflicts.length > 1 ? 'ים' : ''}: ${conflictDetails}`,
        code: 'CONFLICT_ERROR',
        status: 409,
        conflicts: conflicts,
      };
      throw conflictError;
    }

    // PREVENT DUPLICATES: Check for overlapping open slots BEFORE creating lesson
    // This prevents duplicate windows (open slot + lesson for same time)
    // Check even if teacherId is missing - we'll check all slots for that date/time
    // IMPORTANT: Skip this check when lesson is created from slot_inventory booking
    // (source === 'slot_inventory'), because slotBookingService already handles slot closure
    // This allows manual lesson creation without affecting slot_inventory
    const isFromSlotBooking = (lesson as any).source === 'slot_inventory';
    if (lesson.date && lesson.startTime && !isFromSlotBooking) {
      try {
        // Resolve teacherId: convert number (e.g., "1") to record ID if needed
        const resolvedTeacherId = await resolveTeacherRecordId(lesson.teacherId);
        const { validateConflicts } = await import('./conflictValidationService');
        const validationResult = await validateConflicts({
          teacherId: resolvedTeacherId, // undefined means check all teachers
          date: lesson.date,
          startTime: lesson.startTime,
          endTime: lesson.duration || 60, // duration in minutes
        });

        // If there are overlapping open slots, prevent lesson creation
        if (validationResult.conflicts.openSlots.length > 0) {
          const slotDetails = validationResult.conflicts.openSlots.map(s => 
            `${s.date} ${s.startTime}-${s.endTime}`
          ).join(', ');
          
          const conflictError: any = {
            message: `לא ניתן לקבוע שיעור - יש חלון פתוח חופף בזמן זה: ${slotDetails}. אנא סגור את החלון הפתוח תחילה או בחר זמן אחר.`,
            code: 'CONFLICT_ERROR',
            status: 409,
            conflicts: {
              lessons: [],
              openSlots: validationResult.conflicts.openSlots,
            },
          };
          throw conflictError;
        }

        // Auto-close overlapping open slots (should be empty after check above, but keep for safety)
        const { autoCloseOverlappingSlots } = await import('./conflictValidationService');
        const closedSlots = await autoCloseOverlappingSlots(
          lesson.teacherId,
          lesson.date,
          lesson.startTime,
          lesson.duration || 60
        );
      } catch (conflictError: any) {
        // Re-throw conflict errors (they should prevent lesson creation)
        if (conflictError.code === 'CONFLICT_ERROR') {
          throw conflictError;
        }
        // Log but don't fail lesson creation if other errors occur
        console.warn(`[createLesson] Failed to check/close overlapping slots:`, conflictError);
      }
    }

    // Prepare Airtable fields - ONLY use mapped fields from fieldMap
    const airtableFields: any = { fields: {} };

    // Required fields (always present)
    const startDatetimeField = getField('lessons', 'start_datetime');
    const endDatetimeField = getField('lessons', 'end_datetime');
    const statusField = getField('lessons', 'status');
    const lessonDateField = getField('lessons', 'lesson_date');
    
    airtableFields.fields[startDatetimeField] = startDatetime;
    airtableFields.fields[endDatetimeField] = endDatetime;
    
    // Try to get existing status values from Airtable to find valid option
    // First, fetch one existing lesson to see what status values are valid
    let validStatusValue: string | undefined;
    try {
      const lessonsTableId = getTableId('lessons');
      const sampleParams = new URLSearchParams({ maxRecords: '1' });
      const sampleResponse = await airtableRequest<{ records: any[] }>(`/${lessonsTableId}?${sampleParams}`);
      if (sampleResponse.records && sampleResponse.records.length > 0) {
        const sampleStatus = sampleResponse.records[0].fields?.[statusField];
        validStatusValue = sampleStatus;
      }
    } catch (sampleError) {
      console.warn(`[DEBUG createLesson] Could not fetch sample lesson to check status values:`, sampleError);
    }
    
    // Airtable Single Select options in this base use trailing space (e.g. "מתוכנן "). Send exact value to match existing option.
    const statusValue = (lesson.status != null && String(lesson.status)) || 'מתוכנן ';
    let finalStatusValue = (validStatusValue != null && String(validStatusValue)) || statusValue;
    // Normalize: sampled value may come back as "מתוכנן" (no space); base option is "מתוכנן " (with space)
    if (finalStatusValue.trim() === 'מתוכנן') finalStatusValue = 'מתוכנן ';
    airtableFields.fields[statusField] = finalStatusValue;
    airtableFields.fields[lessonDateField] = lesson.date;

    // PART B: Add student link using the correct writable field name
    // studentRecordId was already validated above
    // Note: According to the report, the field is 'full_name' (linked record to students)
    const studentFieldName = getField('lessons', 'full_name');
    
    // Support multiple students if studentIds array is provided
    let studentIdsToLink: string[] = [studentRecordId];
    if (lesson.studentIds && Array.isArray(lesson.studentIds) && lesson.studentIds.length > 0) {
      // Validate all student IDs
      const validStudentIds = lesson.studentIds.filter(id => 
        id && typeof id === 'string' && id.startsWith('rec')
      );
      if (validStudentIds.length > 0) {
        studentIdsToLink = validStudentIds;
      }
    }
    
    // Write to the mapped field name (discovered from getLessons logs)
    // Format: array of record ID strings for linked record fields
    airtableFields.fields[studentFieldName] = studentIdsToLink;

    // Add source if available
    try {
      const sourceField = getField('lessons', 'source');
      if (lesson.source) {
        airtableFields.fields[sourceField] = lesson.source;
      }
    } catch (e) {
      console.warn(`[nexusApi] source field not found in mapping, skipping`);
    }

    // Link to weekly_slot when lesson is created from a recurring/fixed template
    const weeklySlotId = lesson.weeklySlotId ?? (lesson as any).weeklySlotId;
    if (weeklySlotId && typeof weeklySlotId === 'string' && weeklySlotId.startsWith('rec')) {
      try {
        const slotFieldName = getField('lessons', 'slot');
        airtableFields.fields[slotFieldName] = [weeklySlotId];
      } catch (e) {
        console.warn(`[nexusApi] slot field not found in mapping, skipping weeklySlotId`);
      }
    }

    // Teacher link - OPTIONAL
    // Note: According to the report, the field is 'teacher_id' (linked record to teachers)
    if (lesson.teacherId) {
      if (lesson.teacherId.startsWith('rec')) {
        const teacherFieldName = getField('lessons', 'teacher_id');
        airtableFields.fields[teacherFieldName] = [lesson.teacherId];
      } else {
        console.warn(`[DEBUG createLesson] Invalid teacher ID format: ${lesson.teacherId}`);
      }
    }

    // Notes: 'פרטי השיעור' is a computed/formula field in Airtable – skip writing to it

    // Price - for private: per-lesson amount; for pair/group: total amount (each student charged half when no subscription)
    const priceField = getField('lessons', 'price');
    if (lesson.lessonType === 'private' || lesson.isPrivate) {
      const calculatedPrice = lesson.price !== undefined 
        ? lesson.price 
        : ((lesson.duration || 60) / 60) * 175;
      airtableFields.fields[priceField] = Math.round(calculatedPrice * 100) / 100;
    } else if (lesson.lessonType === 'pair') {
      const pairTotalPrice = lesson.price !== undefined ? lesson.price : 225;
      airtableFields.fields[priceField] = Math.round(pairTotalPrice * 100) / 100;
    }
    // Group (קבוצתי): fixed 120 per student at billing time - do not write price

    // Subject field - REMOVED (not in config, will cause "Unknown field name" error)
    // DO NOT add lesson.subject - field name must be discovered from existing records first
    // Once discovered, add to config as lessonSubject: 'actual_field_name', then uncomment:
    // if (lesson.subject) {
    //   addFieldIfMapped('lessonSubject', lesson.subject, airtableFields);
    // }

    // Lesson type - map English to Hebrew for Airtable (options in this base are without trailing space: "פרטי", "זוגי", "קבוצתי")
    if (lesson.lessonType) {
      const lessonTypeField = getField('lessons', 'lesson_type');
      const typeMap: Record<string, string> = {
        'private': 'פרטי',
        'pair': 'זוגי',
        'group': 'קבוצתי',
      };
      const hebrewType = typeMap[lesson.lessonType] || lesson.lessonType;
      airtableFields.fields[lessonTypeField] = hebrewType;
    }


    // Create the lesson in Airtable using STRICT field mapping (no fallbacks)
    // All field names must be defined in fieldMap
    try {
      const lessonsTableId = getTableId('lessons');
      
      const response = await airtableRequest<{ id: string; fields: any }>(
        `/${lessonsTableId}`,
        {
          method: 'POST',
          body: JSON.stringify({ ...airtableFields, typecast: true }),
        }
      );
      
      
      // Map response to Lesson
      const newLesson = mapAirtableToLesson({ id: response.id, fields: response.fields });
      
      
      // STEP 6: Trigger Make.com scenario to create calendar event
      // This is non-blocking - we don't fail the lesson creation if Make fails
      try {
        const makeResult = await triggerCreateLessonScenario({
          lessonId: response.id,
          studentId: studentRecordId,
          teacherId: lesson.teacherId,
          date: lesson.date,
          startTime: lesson.startTime,
          duration: lesson.duration,
          lessonType: lesson.lessonType,
        });
        
        if (makeResult.success) {
        } else {
          console.warn(`[DEBUG createLesson] STEP 6 - Make.com scenario failed (non-blocking):`, makeResult.error);
        }
      } catch (makeError) {
        // Log but don't fail - the lesson was already created in Airtable
        console.warn(`[DEBUG createLesson] STEP 6 - Make.com trigger failed (non-blocking):`, makeError);
      }
      
      return newLesson;
    } catch (error: any) {
      console.error(`[DEBUG createLesson] STEP 5 - ERROR creating lesson:`, error);
      console.error(`[DEBUG createLesson] STEP 5 - Error message:`, error.message);
      console.error(`[DEBUG createLesson] STEP 5 - Error details:`, error.details);
      console.error(`[DEBUG createLesson] STEP 5 - Payload that failed:`, JSON.stringify(airtableFields, null, 2));
      console.error(`[DEBUG createLesson] STEP 5 - Field names in payload:`, Object.keys(airtableFields.fields));
      console.error(`[DEBUG createLesson] STEP 5 - If error mentions "Unknown field name", check getLessons logs to discover correct field names`);
      
      throw error;
    }
  },

  createMonthlyCharges: async (billingMonth: string): Promise<CreateMonthlyChargesResult> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }
    
    return await createMonthlyCharges(airtableClient, billingMonth);
  },

  recalculateBill: async (studentId: string, billingMonth: string): Promise<RecalculateBillResult> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }
    return await recalculateBill(airtableClient, studentId, billingMonth);
  },

  updateBillAdjustment: async (billId: string, adjustment: { amount: number; reason: string }): Promise<void> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const billingTableId = getTableId('monthlyBills');
    const amountField = getField('monthlyBills', 'manual_adjustment_amount');
    const reasonField = getField('monthlyBills', 'manual_adjustment_reason');
    const dateField = getField('monthlyBills', 'manual_adjustment_date');

    try {
      // Get current bill to calculate new total
      const currentBill = await airtableClient.getRecord(billingTableId, billId);
      const currentFields = currentBill.fields as any;
      
      const lessonsAmount = currentFields[getField('monthlyBills', 'lessons_amount')] || 0;
      const subscriptionsAmount = currentFields[getField('monthlyBills', 'subscriptions_amount')] || 0;
      const cancellationsAmount = currentFields[getField('monthlyBills', 'cancellations_amount')] || 0;
      const newTotal = lessonsAmount + subscriptionsAmount + cancellationsAmount + adjustment.amount;

      const updateFields: any = {
        [amountField]: adjustment.amount,
        [reasonField]: adjustment.reason || '',
        [dateField]: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
        [getField('monthlyBills', 'total_amount')]: newTotal,
      };

      await airtableClient.updateRecord(billingTableId, billId, updateFields);

    } catch (error: any) {
      console.error('[nexusApi.updateBillAdjustment] Failed to update adjustment:', error);
      throw {
        message: `Failed to update bill adjustment: ${error.message || 'Unknown error'}`,
        code: 'UPDATE_ADJUSTMENT_ERROR',
        status: error.status || 500,
        details: error,
      };
    }
  },

  deleteBill: async (billId: string): Promise<void> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const billingTableId = getTableId('monthlyBills');

    try {
      await airtableClient.deleteRecord(billingTableId, billId);

    } catch (error: any) {
      console.error('[nexusApi.deleteBill] Failed to delete bill:', error);
      throw {
        message: `Failed to delete bill: ${error.message || 'Unknown error'}`,
        code: 'DELETE_BILL_ERROR',
        status: error.status || 500,
        details: error,
      };
    }
  },

  // Entity (Bot Users) API functions
  // Field mapping from Airtable:
  // - ext_id: auto-generated record ID (primary)
  // - role: permission type (parent, admin, student, teacher)
  // - full_name: full name
  // - phone_normalized: phone number
  // - email: email address
  // - הערות: notes
  getEntities: async (): Promise<Entity[]> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const entitiesTableId = AIRTABLE_CONFIG.tables.entities;
    
    const records = await listAllAirtableRecords<any>(entitiesTableId, {
      pageSize: '100',
    });

    const entities: Entity[] = records.map((record: any) => {
      const fields = record.fields || {};
      
      // Map role from Airtable to our EntityPermission type
      const rawRole = fields['role'] || 'student';
      
      return {
        id: record.id,
        name: fields['full_name'] || '',
        phone: fields['phone_normalized'] || '',
        permission: rawRole as EntityPermission,
        email: fields['email'] || undefined,
        notes: fields['הערות'] || undefined,
        createdAt: undefined, // Not available in schema
        updatedAt: undefined, // Not available in schema
      };
    });

    return entities;
  },

  createEntity: async (data: Partial<Entity>): Promise<Entity> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const entitiesTableId = AIRTABLE_CONFIG.tables.entities;

    const airtableFields: any = {
      typecast: true,
      fields: {
        full_name: data.name || '',
        phone_normalized: data.phone || '',
        role: data.permission || 'student',
      },
    };

    try {
      const response = await airtableRequest<{ id: string; fields: any }>(
        `/${entitiesTableId}`,
        {
          method: 'POST',
          body: JSON.stringify(airtableFields),
        }
      );

      const newEntity: Entity = {
        id: response.id,
        name: response.fields.full_name || data.name || '',
        phone: response.fields.phone_normalized || data.phone || '',
        permission: (response.fields.role || data.permission || 'student') as EntityPermission,
      };

      return newEntity;
    } catch (error: any) {
      console.error('[nexusApi.createEntity] Failed to create entity:', error);
      throw {
        message: `Failed to create entity: ${error.message || 'Unknown error'}`,
        code: 'CREATE_ENTITY_ERROR',
        status: error.status || 500,
        details: error,
      };
    }
  },

  updateEntity: async (entityId: string, data: Partial<Entity>): Promise<Entity> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const entitiesTableId = AIRTABLE_CONFIG.tables.entities;

    const updateFields: any = {};
    if (data.phone !== undefined) updateFields.phone_normalized = data.phone;
    if (data.permission !== undefined) updateFields.role = data.permission;
    // name is typically not editable, but include if needed
    if (data.name !== undefined) updateFields.full_name = data.name;

    try {
      const response = await airtableRequest<{ id: string; fields: any }>(
        `/${entitiesTableId}/${entityId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ fields: updateFields, typecast: true }),
        }
      );

      const updatedEntity: Entity = {
        id: response.id,
        name: response.fields.full_name || '',
        phone: response.fields.phone_normalized || '',
        permission: (response.fields.role || 'student') as EntityPermission,
      };

      return updatedEntity;
    } catch (error: any) {
      console.error('[nexusApi.updateEntity] Failed to update entity:', error);
      throw {
        message: `Failed to update entity: ${error.message || 'Unknown error'}`,
        code: 'UPDATE_ENTITY_ERROR',
        status: error.status || 500,
        details: error,
      };
    }
  },

  deleteEntity: async (entityId: string): Promise<void> => {
    if (!getAuthToken()) {
      throw new Error('Authentication required. Please log in.');
    }

    const entitiesTableId = AIRTABLE_CONFIG.tables.entities;

    try {
      await airtableRequest<{ id: string; deleted: boolean }>(
        `/${entitiesTableId}/${entityId}`,
        { method: 'DELETE' }
      );

    } catch (error: any) {
      console.error('[nexusApi.deleteEntity] Failed to delete entity:', error);
      throw {
        message: `Failed to delete entity: ${error.message || 'Unknown error'}`,
        code: 'DELETE_ENTITY_ERROR',
        status: error.status || 500,
        details: error,
      };
    }
  },

  // =========================================================================
  // Student Groups CRUD
  // =========================================================================

  fetchGroups: async (): Promise<StudentGroup[]> => {
    if (!getAuthToken()) {
      throw { message: 'Authentication required', code: 'AUTH_REQUIRED', status: 401 };
    }
    const tableId = getTableId('studentGroups');
    const params = new URLSearchParams({ pageSize: '100' });
    const response = await airtableRequest<{ records: any[] }>(`/${tableId}?${params}`);
    return response.records.map((record: any) => {
      const f = record.fields || {};
      const studentIds = f.students || [];
      return {
        id: record.id,
        name: f.group_name || '',
        studentIds: Array.isArray(studentIds) ? studentIds : studentIds ? [studentIds] : [],
        studentNames: Array.isArray(f.student_names) ? f.student_names : f.student_names ? [f.student_names] : [],
        studentCount: f.student_count ?? (Array.isArray(studentIds) ? studentIds.length : 0),
        status: f.status || 'active',
      } as StudentGroup;
    });
  },

  fetchGroup: async (id: string): Promise<StudentGroup> => {
    if (!getAuthToken()) {
      throw { message: 'Authentication required', code: 'AUTH_REQUIRED', status: 401 };
    }
    const tableId = getTableId('studentGroups');
    const response = await airtableRequest<{ id: string; fields: any }>(`/${tableId}/${id}`);
    const f = response.fields || {};
    const studentIds = f.students || [];
    return {
      id: response.id,
      name: f.group_name || '',
      studentIds: Array.isArray(studentIds) ? studentIds : studentIds ? [studentIds] : [],
      studentNames: Array.isArray(f.student_names) ? f.student_names : f.student_names ? [f.student_names] : [],
      studentCount: f.student_count ?? (Array.isArray(studentIds) ? studentIds.length : 0),
      status: f.status || 'active',
    };
  },

  createGroup: async (group: { name: string; studentIds: string[]; status: 'active' | 'paused' }): Promise<StudentGroup> => {
    if (!getAuthToken()) {
      throw { message: 'Authentication required', code: 'AUTH_REQUIRED', status: 401 };
    }
    const tableId = getTableId('studentGroups');
    const fields: Record<string, any> = {
      group_name: group.name,
      status: group.status,
    };
    if (group.studentIds.length > 0) {
      fields.students = group.studentIds;
    }
    const response = await airtableRequest<{ id: string; fields: any }>(`/${tableId}`, {
      method: 'POST',
      body: JSON.stringify({ fields, typecast: true }),
    });
    const f = response.fields || {};
    const studentIds = f.students || [];
    return {
      id: response.id,
      name: f.group_name || group.name,
      studentIds: Array.isArray(studentIds) ? studentIds : studentIds ? [studentIds] : [],
      studentNames: Array.isArray(f.student_names) ? f.student_names : [],
      studentCount: f.student_count ?? group.studentIds.length,
      status: f.status || group.status,
    };
  },

  updateGroup: async (id: string, updates: { name?: string; studentIds?: string[]; status?: 'active' | 'paused' }): Promise<StudentGroup> => {
    if (!getAuthToken()) {
      throw { message: 'Authentication required', code: 'AUTH_REQUIRED', status: 401 };
    }
    const tableId = getTableId('studentGroups');
    const fields: Record<string, any> = {};
    if (updates.name !== undefined) fields.group_name = updates.name;
    if (updates.status !== undefined) fields.status = updates.status;
    if (updates.studentIds !== undefined) fields.students = updates.studentIds;

    const response = await airtableRequest<{ id: string; fields: any }>(`/${tableId}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    });
    const f = response.fields || {};
    const studentIds = f.students || [];
    return {
      id: response.id,
      name: f.group_name || '',
      studentIds: Array.isArray(studentIds) ? studentIds : studentIds ? [studentIds] : [],
      studentNames: Array.isArray(f.student_names) ? f.student_names : [],
      studentCount: f.student_count ?? (Array.isArray(studentIds) ? studentIds.length : 0),
      status: f.status || 'active',
    };
  },

  deleteGroup: async (id: string): Promise<void> => {
    if (!getAuthToken()) {
      throw { message: 'Authentication required', code: 'AUTH_REQUIRED', status: 401 };
    }
    const tableId = getTableId('studentGroups');
    await airtableRequest<{ id: string; deleted: boolean }>(`/${tableId}/${id}`, {
      method: 'DELETE',
    });
  },
};

