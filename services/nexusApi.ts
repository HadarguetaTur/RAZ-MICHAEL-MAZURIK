
import { Lesson, Student, Teacher, Subscription, MonthlyBill, LessonStatus, HomeworkLibraryItem, HomeworkAssignment, WeeklySlot, SlotInventory, Entity, EntityPermission } from '../types';
import { mockData } from './mockApi';
import { AIRTABLE_CONFIG } from '../config/airtable';
import { getChargesReport, createMonthlyCharges, CreateMonthlyChargesResult, discoverChargeTableSchema, ChargeTableSchema, getChargesReportKPIs, ChargesReportKPIs } from './billingService';
import { airtableClient } from './airtableClient';

// Cache for table schema to avoid redundant discovery calls
let cachedChargeSchema: ChargeTableSchema | null = null;
import { getTableId, getField, isComputedField, filterComputedFields } from '../contracts/fieldMap';
import { getWeeklySlots as getWeeklySlotsService, getSlotInventory as getSlotInventoryService, updateWeeklySlot as updateWeeklySlotService, updateSlotInventory as updateSlotInventoryService, createWeeklySlot as createWeeklySlotService, deleteWeeklySlot as deleteWeeklySlotService } from './slotManagementService';
import { openNewWeek as openNewWeekService } from './weeklyRolloverService';
import { triggerCreateLessonScenario } from './makeApi';

// Use Vite's import.meta.env for client-side environment variables
const API_BASE_URL = 'https://api.airtable.com/v0';
const AIRTABLE_API_KEY = import.meta.env.VITE_AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || '';

console.log(`[API] API_BASE_URL configured as: ${API_BASE_URL}`);
console.log(`[Airtable] Base ID: ${AIRTABLE_BASE_ID ? 'Configured' : 'Not configured'}`);
console.log(`[Airtable] API Key: ${AIRTABLE_API_KEY ? 'Configured' : 'Not configured'}`);

// Airtable API helper functions
async function airtableRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error('Airtable API Key or Base ID not configured. Please set VITE_AIRTABLE_API_KEY and VITE_AIRTABLE_BASE_ID in .env.local');
  }

  // Encode table IDs for safety (even though they're alphanumeric)
  // Split endpoint to encode table ID but preserve query parameters
  const [tablePath, queryString] = endpoint.split('?');
  const pathParts = tablePath.split('/');
  if (pathParts.length > 1 && pathParts[1]) {
    // Encode the table ID (second segment)
    pathParts[1] = encodeURIComponent(pathParts[1]);
  }
  const encodedPath = pathParts.join('/');
  const encodedEndpoint = queryString ? `${encodedPath}?${queryString}` : encodedPath;
  
  const url = `${API_BASE_URL}/${encodeURIComponent(AIRTABLE_BASE_ID)}${encodedEndpoint}`;
  console.log(`[Airtable] ${options.method || 'GET'} ${url}`);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      console.error(`[Airtable] Error ${response.status}:`, errorData);
      throw {
        message: errorData.error?.message || `Airtable API error: ${response.statusText}`,
        code: 'AIRTABLE_ERROR',
        status: response.status,
        details: errorData,
      };
    }

    return response.json() as Promise<T>;
  } catch (err: any) {
    if (err.code === 'AIRTABLE_ERROR') {
      throw err;
    }
    // Network or other errors
    throw {
      message: `Failed to connect to Airtable: ${err.message}`,
      code: 'AIRTABLE_CONNECTION_ERROR',
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
  
  console.log(`[DEBUG] Mapping record ${record.id}, fields keys:`, Object.keys(fields));
  const lessonDetailsField = getField('lessons', 'פרטי_השיעור' as any);
  console.log(`[DEBUG] Looking for 'פרטי השיעור' field:`, fields[lessonDetailsField]);
  console.log(`[DEBUG] All field names in record:`, Object.keys(fields));
  
  // Map status from Airtable to LessonStatus enum
  const statusMap: Record<string, LessonStatus> = {
    'מתוכנן': LessonStatus.SCHEDULED,
    'אישר הגעה': LessonStatus.COMPLETED, // Map 'אישר הגעה' to COMPLETED
    'בוצע': LessonStatus.COMPLETED, // Map 'בוצע' to COMPLETED
    'הסתיים': LessonStatus.COMPLETED,
    'בוטל': LessonStatus.CANCELLED,
    'ממתין': LessonStatus.PENDING,
    'לא הופיע': LessonStatus.NOSHOW,
    'ממתין לאישור ביטול': LessonStatus.PENDING_CANCEL,
  };

  // Extract date and time from datetime fields
  const startDatetimeField = getField('lessons', 'start_datetime');
  const endDatetimeField = getField('lessons', 'end_datetime');
  const lessonDateField = getField('lessons', 'lesson_date');
  const startDatetime = fields[startDatetimeField] || '';
  const endDatetime = fields[endDatetimeField] || '';
  const lessonDate = fields[lessonDateField] || '';
  
  console.log(`[DEBUG] start_datetime raw value:`, startDatetime, `(type: ${typeof startDatetime})`);
  console.log(`[DEBUG] end_datetime raw value:`, endDatetime);
  console.log(`[DEBUG] lesson_date raw value:`, lessonDate);
  
  // Parse datetime strings to extract date and time
  let date = '';
  let startTime = '';
  let duration = 60;
  
  if (startDatetime) {
    console.log(`[DEBUG] Parsing startDatetime: ${startDatetime}`);
    const startDate = new Date(startDatetime);
    console.log(`[DEBUG] Parsed Date object:`, startDate);
    console.log(`[DEBUG] Date isValid:`, !isNaN(startDate.getTime()));
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
    
    console.log(`[DEBUG] Extracted date: ${date}, startTime: ${startTime}`);
    if (endDatetime) {
      const endDate = new Date(endDatetime);
      duration = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60)); // duration in minutes
      console.log(`[DEBUG] Calculated duration: ${duration} minutes`);
      }
  } else if (lessonDate) {
    date = typeof lessonDate === 'string' ? lessonDate : lessonDate.split('T')[0];
    console.log(`[DEBUG] Using lessonDate fallback: ${date}`);
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
  
  console.log(`[DEBUG] Mapped lessonDetails:`, lessonDetails);

  const statusField = getField('lessons', 'status');
  const priceField = getField('lessons', 'price');
  const price = fields[priceField] !== undefined && fields[priceField] !== null 
    ? (typeof fields[priceField] === 'number' ? fields[priceField] : parseFloat(fields[priceField])) 
    : undefined;
  
  // Extract studentId from full_name field (primary) or fallback fields
  const fullNameField = getField('lessons', 'full_name');
  let studentIdFromFullName = '';
  const fullNameValue = fields[fullNameField];
  if (Array.isArray(fullNameValue) && fullNameValue.length > 0) {
    // Linked record array - extract ID
    const firstItem = fullNameValue[0];
    studentIdFromFullName = typeof firstItem === 'string' && firstItem.startsWith('rec')
      ? firstItem
      : (firstItem?.id && firstItem.id.startsWith('rec') ? firstItem.id : '');
  } else if (typeof fullNameValue === 'string' && fullNameValue.startsWith('rec')) {
    // Single record ID string
    studentIdFromFullName = fullNameValue;
  }
  
  const mappedLesson = {
    id: record.id,
    studentId: studentIdFromFullName || 
              fields['Student_ID'] || 
              fields['Student']?.[0]?.id || 
              '',
    studentName: studentName,
    teacherId: fields['Teacher_ID'] || fields['Teacher']?.[0]?.id || '',
    teacherName: fields['Teacher_Name'] || fields['Teacher']?.[0]?.name || '',
    date: date,
    startTime: startTime,
    duration: duration,
    status: statusMap[fields[statusField]] || LessonStatus.SCHEDULED,
    subject: fields['Subject'] || fields['subject'] || 'מתמטיקה',
    isChargeable: fields['Is_Chargeable'] !== false,
    chargeReason: fields['Charge_Reason'] || fields['charge_reason'],
    isPrivate: fields['Is_Private'] !== false,
    lessonType: fields['Lesson_Type'] || fields['lesson_type'] || 'private',
    notes: lessonDetails, // Use 'פרטי השיעור' as primary notes field
    paymentStatus: fields['Payment_Status'] || fields['payment_status'],
    attendanceConfirmed: fields['Attendance_Confirmed'] || false,
    price: price,
  };
  
  console.log(`[DEBUG] Mapped lesson:`, mappedLesson);
  
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
  console.log(`[DEBUG Student Balance] ${studentName}: field="${totalWithVatField}", raw="${rawBalance}", type=${typeof rawBalance}`);
  
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
    status: (fields['Status'] || (fields[isActiveField] ? 'active' : 'inactive')) as 'active' | 'on_hold' | 'inactive',
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
  
  // Map status
  if (lesson.status !== undefined) {
    fields[statusField] = lesson.status;
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
  
  return { fields };
}

async function handleResponse<T>(response: Response, url: string): Promise<T> {
  // Log the response details for debugging
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  
  console.log(`[API] ${url} - Status: ${response.status}, Content-Type: ${contentType}`);
  
  // Get response text first to check what we're actually receiving
  const responseText = await response.text();
  console.log(`[API] ${url} - Response preview (first 200 chars):`, responseText.substring(0, 200));
  
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
      console.log(`[API] Using fallback data for failed request`);
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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
    
    console.log(`[Airtable] Fetched ${teachers.length} teachers`);
    return teachers;
  },

  getStudents: async (page: number = 1): Promise<Student[]> => {
    // Fetch from Airtable - no fallback
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    const params = new URLSearchParams({
      pageSize: '100',
      ...(page > 1 && { offset: String((page - 1) * 100) }),
    });
    const studentsTableId = getTableId('students');
    const response = await airtableRequest<{ records: any[] }>(`/${studentsTableId}?${params}`);
    const students = response.records.map(mapAirtableToStudent);
    console.log(`[Airtable] Fetched ${students.length} students`);
    return students;
  },

  updateStudent: async (id: string, updates: Partial<Student>): Promise<Student> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    const airtableFields: any = { fields: {} };
    
    if (updates.name !== undefined) airtableFields.fields[getField('students', 'full_name')] = updates.name;
    if (updates.phone !== undefined) airtableFields.fields[getField('students', 'phone_number')] = updates.phone;
    if (updates.parentName !== undefined) airtableFields.fields[getField('students', 'parent_name')] = updates.parentName;
    if (updates.parentPhone !== undefined) airtableFields.fields[getField('students', 'parent_phone')] = updates.parentPhone;
    if (updates.grade !== undefined) airtableFields.fields[getField('students', 'grade_level')] = updates.grade;
    if (updates.subjectFocus !== undefined) airtableFields.fields[getField('students', 'subject_focus')] = updates.subjectFocus;
    if (updates.level !== undefined) airtableFields.fields[getField('students', 'level')] = updates.level;
    if (updates.weeklyLessonsLimit !== undefined) airtableFields.fields[getField('students', 'weekly_lessons_limit')] = updates.weeklyLessonsLimit;
    if (updates.paymentStatus !== undefined) airtableFields.fields[getField('students', 'payment_status')] = updates.paymentStatus;
    if (updates.notes !== undefined) airtableFields.fields[getField('students', 'notes' as any)] = updates.notes;
    if (updates.email !== undefined) airtableFields.fields[getField('students', 'email' as any)] = updates.email;
    
    if (updates.status !== undefined) {
      airtableFields.fields[getField('students', 'is_active')] = updates.status === 'active';
      // Also update 'Status' field if it exists (Airtable often has both)
      airtableFields.fields['Status'] = updates.status;
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
    console.log('[createStudent] Entry - received student data:', student);
    
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      console.error('[createStudent] Missing API Key or Base ID');
      throw new Error('Airtable API Key or Base ID not configured');
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

    console.log('[createStudent] Creating new student:', student.name);

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
    console.log('[createStudent] Table ID:', studentsTableId);
    console.log('[createStudent] Request body:', JSON.stringify(airtableFields, null, 2));
    
    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${studentsTableId}`,
      {
        method: 'POST',
        body: JSON.stringify(airtableFields),
      }
    );

    console.log('[createStudent] Successfully created student:', response.id);
    console.log('[createStudent] Response fields:', response.fields);
    return mapAirtableToStudent({ id: response.id, fields: response.fields });
  },

  getLessons: async (start: string, end: string, teacherId?: string): Promise<Lesson[]> => {
    // Fetch from Airtable - no fallback
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    console.log(`[DEBUG] getLessons called with start=${start}, end=${end}, teacherId=${teacherId}`);
    const lessonsTableId = getTableId('lessons');
    console.log(`[DEBUG] Table ID: ${lessonsTableId}`);
    console.log(`[DEBUG] Base ID: ${AIRTABLE_BASE_ID}`);

    // TEMPORARY: Fetch all records without filtering (for debugging)
    // Build Airtable filter formula
    // Show ALL records where status is 'מתוכנן', 'אישר הגעה', or 'בוצע'
    // Format dates as YYYY-MM-DD for Airtable
    const startDate = start.split('T')[0];
    const endDate = end.split('T')[0];
    
    // TEMPORARILY COMMENTED OUT - Fetch all records for debugging
    // Filter by date range and status (no topic filtering)
    // let filterFormula = `AND(
    //   IS_AFTER({${startDatetimeField}}, '${startDate}'),
    //   IS_BEFORE({${startDatetimeField}}, '${endDate}'),
    //   OR(
    //     {${statusField}} = 'מתוכנן',
    //     {${statusField}} = 'אישר הגעה',
    //     {${statusField}} = 'בוצע'
    //   )
    // )`;
    
    // if (teacherId) {
    //   filterFormula = `AND(${filterFormula}, {Teacher} = '${teacherId}')`;
    // }
    
    const params = new URLSearchParams({
      // TEMPORARILY REMOVED: filterByFormula: filterFormula,
      pageSize: '100', // Fetch all records (up to 100 per page)
    });
    // Add sort parameter separately
    const startDatetimeField = getField('lessons', 'start_datetime');
    params.append('sort[0][field]', startDatetimeField);
    params.append('sort[0][direction]', 'asc');
    
    const endpoint = `/${lessonsTableId}?${params}`;
    const fullUrl = `${API_BASE_URL}/${AIRTABLE_BASE_ID}${endpoint}`;
    console.log(`[DEBUG] Full URL being called: ${fullUrl}`);
    console.log(`[DEBUG] Endpoint: ${endpoint}`);
    console.log(`[DEBUG] Params: ${params.toString()}`);
    
    const response = await airtableRequest<{ records: any[] }>(endpoint);
    
    // Log raw response
    console.log(`[DEBUG] Raw Airtable response:`, JSON.stringify(response, null, 2));
    console.log(`[DEBUG] Number of records in response: ${response.records?.length || 0}`);
    
    if (!response.records || response.records.length === 0) {
      console.warn(`[DEBUG] Airtable returned 0 records for table ${lessonsTableId}`);
      console.warn(`[DEBUG] Response structure:`, response);
      return [];
    }
    
    // Log first record details
    if (response.records.length > 0) {
      const firstRecord = response.records[0];
      const lessonDetailsField = getField('lessons', 'פרטי_השיעור' as any);
      const statusField = getField('lessons', 'status');
      const existingStatusValue = firstRecord.fields?.[statusField];
      
      // Collect all unique status values from all records
      const allStatusValues = [...new Set(response.records.map((r: any) => r.fields?.[statusField]).filter((v: any) => v))];
      
      console.log(`[DEBUG] First record ID: ${firstRecord.id}`);
      console.log(`[DEBUG] First record fields:`, JSON.stringify(firstRecord.fields, null, 2));
      console.log(`[DEBUG] First record start_datetime value:`, firstRecord.fields?.[startDatetimeField]);
      console.log(`[DEBUG] First record 'פרטי השיעור' value:`, firstRecord.fields?.[lessonDetailsField]);
      console.log(`[DEBUG] First record status value:`, existingStatusValue);
      console.log(`[DEBUG] All unique status values in existing lessons:`, allStatusValues);
      
      // PART A: Identify the writable student linked record field
      const allFieldNames = Object.keys(firstRecord.fields || {});
      const studentRelatedFields = allFieldNames.filter(k => 
        k.toLowerCase().includes('student') || 
        k.includes('תלמיד') ||
        k.toLowerCase().includes('student_id')
      );
      
      console.log(`[DEBUG getLessons] PART A - Identifying writable Student linked record field:`);
      console.log(`[DEBUG getLessons] PART A - All field names:`, allFieldNames);
      console.log(`[DEBUG getLessons] PART A - Student-related fields:`, studentRelatedFields);
      
      // Check each student-related field to determine if it's a writable linked record
      studentRelatedFields.forEach(fieldName => {
        const fieldValue = firstRecord.fields[fieldName];
        const isArray = Array.isArray(fieldValue);
        const firstItem = isArray && fieldValue.length > 0 ? fieldValue[0] : null;
        const firstItemIsString = typeof firstItem === 'string';
        const firstItemIsObject = typeof firstItem === 'object' && firstItem !== null;
        const hasRecId = firstItemIsString && firstItem.startsWith('rec') || 
                        (firstItemIsObject && firstItem.id && firstItem.id.startsWith('rec'));
        
        console.log(`[DEBUG getLessons] PART A - Field "${fieldName}":`, {
          type: typeof fieldValue,
          isArray,
          value: JSON.stringify(fieldValue),
          firstItem,
          firstItemType: typeof firstItem,
          hasRecId,
          isWritableLinkedRecord: isArray && hasRecId
        });
        
        // Determine if this is a writable linked record field
        if (isArray && hasRecId) {
          console.log(`[DEBUG getLessons] PART A - ✅ "${fieldName}" appears to be a WRITABLE linked record field (array of rec... IDs)`);
          console.log(`[DEBUG getLessons] PART A - Use this field name in config: lessonStudent: '${fieldName}'`);
        } else if (isArray && firstItemIsObject && firstItem.name) {
          console.log(`[DEBUG getLessons] PART A - ❌ "${fieldName}" appears to be a LOOKUP field (array of objects with name) - NOT writable`);
        } else if (typeof fieldValue === 'string' && fieldValue.startsWith('rec')) {
          console.log(`[DEBUG getLessons] PART A - ⚠️ "${fieldName}" is a single string rec ID - may need array wrapper`);
        }
      });
      
      // Check "Student" field specifically
      console.log(`[DEBUG getLessons] PART A - "Student" field analysis:`);
      const studentField = firstRecord.fields?.['Student'];
      if (Array.isArray(studentField) && studentField.length > 0) {
        const first = studentField[0];
        if (typeof first === 'string' && first.startsWith('rec')) {
          console.log(`[DEBUG getLessons] PART A - "Student" is array of rec IDs - WRITABLE ✅`);
        } else if (typeof first === 'object' && first.id && first.id.startsWith('rec')) {
          console.log(`[DEBUG getLessons] PART A - "Student" is array of objects with rec IDs - WRITABLE ✅`);
        } else if (typeof first === 'object' && first.name) {
          console.log(`[DEBUG getLessons] PART A - "Student" is array of objects with names - LOOKUP field, NOT writable ❌`);
        }
      }
      
      // Check Hebrew fields containing "תלמיד"
      const hebrewStudentFields = allFieldNames.filter(k => k.includes('תלמיד'));
      console.log(`[DEBUG getLessons] PART A - Hebrew fields containing "תלמיד":`, hebrewStudentFields);
      hebrewStudentFields.forEach(fieldName => {
        const fieldValue = firstRecord.fields[fieldName];
        console.log(`[DEBUG getLessons] PART A - Hebrew field "${fieldName}":`, {
          type: typeof fieldValue,
          isArray: Array.isArray(fieldValue),
          value: JSON.stringify(fieldValue),
          isWritable: Array.isArray(fieldValue) && fieldValue.length > 0 && 
                     (typeof fieldValue[0] === 'string' && fieldValue[0].startsWith('rec') ||
                      (typeof fieldValue[0] === 'object' && fieldValue[0]?.id?.startsWith('rec')))
        });
      });
      
      // STEP 3: Inspect ALL field names to identify correct mappings
      // Reuse allFieldNames declared above in PART A
      const hebrewFields = allFieldNames.filter(k => /[\u0590-\u05FF]/.test(k));
      const subjectRelatedFields = allFieldNames.filter(k => 
        k.toLowerCase().includes('subject') || 
        k.toLowerCase().includes('סוג') || 
        k.toLowerCase().includes('type') ||
        k.toLowerCase().includes('שיעור')
      );
      
      console.log(`[DEBUG getLessons] STEP 3 - ALL field names in existing lesson record:`, allFieldNames);
      console.log(`[DEBUG getLessons] STEP 3 - Hebrew field names:`, hebrewFields);
      console.log(`[DEBUG getLessons] STEP 3 - Subject/Type related fields:`, subjectRelatedFields);
      console.log(`[DEBUG getLessons] STEP 3 - Subject field (exact):`, firstRecord.fields?.['Subject']);
      console.log(`[DEBUG getLessons] STEP 3 - subject field (lowercase):`, firstRecord.fields?.['subject']);
      console.log(`[DEBUG getLessons] STEP 3 - Full field structure:`, JSON.stringify(firstRecord.fields, null, 2));
      
      // Log for field mapping discovery
      console.log(`[DEBUG getLessons] STEP 3 - FIELD MAPPING DISCOVERY:`);
      console.log(`[DEBUG getLessons] STEP 3 - Use these field names in config/airtable.ts:`);
      allFieldNames.forEach(fieldName => {
        console.log(`[DEBUG getLessons] STEP 3 -   "${fieldName}": ${JSON.stringify(firstRecord.fields[fieldName])}`);
      });
    }
    
    const lessons = response.records.map(mapAirtableToLesson);
    console.log(`[Airtable] Fetched ${lessons.length} lessons`);
    console.log(`[DEBUG] Mapped lessons:`, lessons.slice(0, 2)); // Log first 2 mapped lessons
    
    // Store raw records in a map for modal access
    const rawRecordsMap = new Map<string, any>();
    response.records.forEach(record => {
      rawRecordsMap.set(record.id, record);
    });
    
    // Return lessons with rawRecords attached (for backward compatibility)
    (lessons as any).rawRecords = rawRecordsMap;
    
    return lessons;
  },

  getWeeklySlots: async (): Promise<WeeklySlot[]> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
      if (import.meta.env.DEV && recordIndex < 5) {
        console.log(`[DEBUG getWeeklySlots] Record ${record.id} (index ${recordIndex}):`, {
          dayNumValue: dayNumValue,
          dayNumType: typeof dayNumValue,
          dayOfWeekValue: dayOfWeekValue,
          dayOfWeekType: typeof dayOfWeekValue,
          usingField: dayNumValue !== null && dayNumValue !== undefined && dayNumValue !== '' ? 'day_num' : 'day_of_week',
          rawValue: rawValue,
        });
      }
      
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
        if (import.meta.env.DEV && recordIndex < 5) {
          console.log(`[DEBUG getWeeklySlots] Record ${record.id} - Parsed string "${rawValue}" -> ${dayOfWeek}`);
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
        if (import.meta.env.DEV && recordIndex < 5) {
          console.log(`[DEBUG getWeeklySlots] Record ${record.id} - Normalized number ${rawValue} -> ${dayOfWeek}`);
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
      
      // DEBUG LOG: Show type mapping (temporary, remove before commit)
      if (import.meta.env.DEV && recordIndex < 10) {
        console.log(`[DEBUG getWeeklySlots] Slot ${record.id.substring(0, 8)}: type="${rawTypeValue}" → mapped="${type}", reserved_for_count=${reservedForIds.length}`);
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
    if (import.meta.env.DEV) {
      console.log(`[DEBUG getWeeklySlots] Before API filter: ${slots.length} slots`);
      if (slots.length > 0) {
        console.log(`[DEBUG getWeeklySlots] First mapped record example:`, {
          id: slots[0].id,
          dayOfWeek: slots[0].dayOfWeek,
          dayOfWeekType: typeof slots[0].dayOfWeek,
          startTime: slots[0].startTime,
          endTime: slots[0].endTime,
          teacherId: slots[0].teacherId,
          teacherName: slots[0].teacherName,
          type: slots[0].type,
          status: slots[0].status,
        });
      }
    }
    
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
      console.log(`[DEBUG getWeeklySlots] After API filter: ${validSlots.length} slots (dropped ${slots.length - validSlots.length})`);
      console.log(`[DEBUG getWeeklySlots] Per-day distribution:`, perDayCounts);
      
      // Show sample of first 3 slots with their dayOfWeek values
      if (validSlots.length > 0) {
        console.log(`[DEBUG getWeeklySlots] Sample slots (first 3):`, 
          validSlots.slice(0, 3).map(s => ({
            id: s.id.substring(0, 8),
            dayOfWeek: s.dayOfWeek,
            dayOfWeekType: typeof s.dayOfWeek,
            startTime: s.startTime,
          }))
        );
      }
      
      // Warn if all slots are in the same day
      const nonZeroDays = Object.values(perDayCounts).filter(count => count > 0).length;
      if (nonZeroDays === 1 && validSlots.length > 0) {
        const dayWithSlots = Object.entries(perDayCounts).find(([_, count]) => count > 0)?.[0];
        console.error(`[DEBUG getWeeklySlots] ERROR: All ${validSlots.length} slots are in day ${dayWithSlots}!`);
        console.error(`[DEBUG getWeeklySlots] This means all records in Airtable have day_of_week = ${dayWithSlots} or the field is missing/empty.`);
        console.error(`[DEBUG getWeeklySlots] Please check the day_of_week field values in Airtable table ${tableId}.`);
      }
    }
    
    console.log(`[nexusApi] Fetched ${validSlots.length} weekly slots from ${records.length} records`);
    return validSlots as WeeklySlot[];
  },

  getSlotInventory: async (start: string, end: string, teacherId?: string): Promise<SlotInventory[]> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:1164',message:'getSlotInventory: filter formula',data:{start,end,startDate,endDate,teacherId,filterFormula,dateField},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:1181',message:'getSlotInventory: fetched records',data:{recordsCount:records.length,requestedStartDate:startDate,requestedEndDate:endDate,teacherId,sampleDates:records.slice(0,5).map(r=>r.fields[dateField])},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // PART 1: DEV logging to PROVE duplicates source
    if (import.meta.env?.DEV) {
      const recordIds = records.map(r => r.id);
      const uniqueIds = new Set(recordIds);
      const duplicateById = recordIds.length !== uniqueIds.size;
      
      // Log raw Airtable records
      console.log(`[getSlotInventory] PART 1 - Raw fetch analysis:`);
      console.log(`  Total raw Airtable records: ${records.length}`);
      console.log(`  Unique record.id count: ${uniqueIds.size}`);
      console.log(`  First 10 record IDs:`, recordIds.slice(0, 10));
      
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
      
      // Summary
      console.log(`[getSlotInventory] PART 1 Summary:`);
      console.log(`  Duplicates by record.id: ${duplicateById ? 'YES' : 'NO'}`);
      console.log(`  Duplicates by natural_key: ${duplicateByNaturalKey.length > 0 ? `YES (${duplicateByNaturalKey.length} keys)` : 'NO'}`);
      console.log(`  Duplicates by composite key: ${duplicateByCompositeKey.length > 0 ? `YES (${duplicateByCompositeKey.length} keys)` : 'NO'}`);
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
      
      // Extract status
      const statusField = getField('slotInventory', 'סטטוס');
      const rawStatusValue = fields[statusField] || 'open';
      // Normalize status value: trim whitespace and handle both Hebrew and English
      const statusValue = typeof rawStatusValue === 'string' ? rawStatusValue.trim() : String(rawStatusValue).trim();
      // Map status values (Hebrew and English) to internal enum for consistency
      // Hebrew: "פתוח" → 'open', "סגור" → 'closed', "חסום ע"י מנהל" → 'blocked', "מבוטל" → 'canceled'
      // English: "open" → 'open', "closed"/"booked" → 'closed', "blocked" → 'blocked', "canceled" → 'canceled'
      const status = (
        statusValue === 'פתוח' || statusValue === 'open'
          ? 'open'
          : statusValue === 'סגור' || statusValue === 'closed' || statusValue === 'booked'
          ? 'closed'
          : statusValue === 'חסום ע"י מנהל' || statusValue === 'חסום' || statusValue === 'blocked'
          ? 'blocked'
          : statusValue === 'מבוטל' || statusValue === 'canceled'
          ? 'canceled'
          : 'open' // Default to 'open' for unknown values
      ) as 'open' | 'closed' | 'canceled' | 'blocked';
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:1180',message:'getSlotInventory: status mapping',data:{recordId:record.id,rawStatusValue:statusValue,mappedStatus:status,statusField},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
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
        dayOfWeek: fields.day_of_week,
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
        dayOfWeek?: number; 
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
    
    // Helper to get dedupe key for a slot
    const getDedupeKey = (slot: SlotInventory & { naturalKey?: string }): string => {
      if (slot.naturalKey && slot.naturalKey.trim() !== '') {
        return `natural_key:${slot.naturalKey}`;
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
        
        if (import.meta.env?.DEV) {
          const loser = winner.id === existing.id ? slot : existing;
          console.log(`[getSlotInventory] PART 2 - Dedupe: key "${key}" had ${existing.id === winner.id ? 'existing' : 'new'} winner (${winner.id}), removed ${loser.id}`);
        }
      }
    }
    
    const deduplicatedInventory = Array.from(dedupeMap.values());
    const afterCount = deduplicatedInventory.length;
    
    // DEV: Log deduplication results
    if (import.meta.env?.DEV) {
      console.log(`[getSlotInventory] PART 2 - Deduplication results:`);
      console.log(`  Before: ${beforeCount} slots`);
      console.log(`  After: ${afterCount} slots`);
      console.log(`  Removed: ${beforeCount - afterCount} duplicates`);
      
      if (beforeCount !== afterCount) {
        // Show which keys had duplicates
        const keyCounts = new Map<string, number>();
        mappedInventory.forEach(slot => {
          const key = getDedupeKey(slot);
          keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
        });
        const duplicateKeys = Array.from(keyCounts.entries()).filter(([_, count]) => count > 1);
        if (duplicateKeys.length > 0) {
          console.log(`  Duplicate keys found: ${duplicateKeys.length}`);
          duplicateKeys.slice(0, 5).forEach(([key, count]) => {
            console.log(`    "${key}": ${count} records`);
          });
        }
      }
    }
    
    // Sort deterministically: by date, then startTime
    deduplicatedInventory.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.startTime.localeCompare(b.startTime);
    });
    
    console.log(`[nexusApi] Fetched ${deduplicatedInventory.length} slot inventory records (from ${records.length} raw records)`);
    return deduplicatedInventory as SlotInventory[];
  },

  updateWeeklySlot: async (id: string, updates: Partial<WeeklySlot>): Promise<WeeklySlot> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    const tableId = AIRTABLE_CONFIG.tables.weekly_slot;
    const teachersMap = await getTeachersMap();
    const fields: any = {};
    
    // Map updates to Airtable field names
    if (updates.dayOfWeek !== undefined) {
      // Update day_num (1-7 format) and day_of_week (for backward compatibility)
      // dayOfWeek is 0-6 (0=Sunday), day_num is 1-7 (1=Sunday)
      if (updates.dayOfWeek !== undefined) {
        const dayNumField = getField('weeklySlot', 'day_num');
        const dayOfWeekField = getField('weeklySlot', 'day_of_week');
        // Convert 0-6 to 1-7 for day_num
        const dayNum = updates.dayOfWeek + 1; // 0->1, 1->2, ..., 6->7
        fields[dayNumField] = dayNum;
        // Also update day_of_week for backward compatibility
        fields[dayOfWeekField] = String(updates.dayOfWeek);
      }
    }
    if (updates.startTime !== undefined) {
      fields[getField('weeklySlot', 'start_time')] = updates.startTime;
    }
    if (updates.endTime !== undefined) {
      fields[getField('weeklySlot', 'end_time')] = updates.endTime;
    }
    if (updates.type !== undefined) {
      // Map English type values to Hebrew for Airtable
      const typeMap: Record<'private' | 'group' | 'pair', string> = {
        'private': 'פרטי',
        'group': 'קבוצתי',
        'pair': 'זוגי',
      };
      fields[getField('weeklySlot', 'type')] = typeMap[updates.type] || updates.type;
    }
    if (updates.durationMin !== undefined) {
      fields[getField('weeklySlot', 'duration_min')] = updates.durationMin;
    }
    if (updates.isFixed !== undefined) {
      fields[getField('weeklySlot', 'קבוע' as any)] = updates.isFixed ? true : false;
    }
    if (updates.reservedFor !== undefined) {
      // Handle link field: array of record IDs, or empty array to clear
      fields[getField('weeklySlot', 'reserved_for')] = updates.reservedFor ? [updates.reservedFor] : [];
    }
    // Handle reservedForIds (array of student IDs)
    if (updates.reservedForIds !== undefined) {
      const reservedForField = getField('weeklySlot', 'reserved_for');
      fields[reservedForField] = Array.isArray(updates.reservedForIds) && updates.reservedForIds.length > 0
        ? updates.reservedForIds
        : [];
    }
    // Handle additional fields that might be in updates (even if not in WeeklySlot interface)
    if ((updates as any).isReserved !== undefined) {
      fields[getField('weeklySlot', 'is_reserved')] = (updates as any).isReserved ? 1 : 0;
    }
    if ((updates as any).hasOverlap !== undefined) {
      fields[getField('weeklySlot', 'has_overlap')] = (updates as any).hasOverlap ? 1 : 0;
    }
    if ((updates as any).overlapWith !== undefined) {
      fields[getField('weeklySlot', 'overlap_with')] = (updates as any).overlapWith ? [(updates as any).overlapWith] : [];
    }
    if ((updates as any).overlapDetails !== undefined) {
      fields[getField('weeklySlot', 'overlap_details')] = (updates as any).overlapDetails;
    }
    if (updates.teacherId !== undefined) {
      // teacher_id must be an array of recordIds (wrap single value)
      fields[getField('weeklySlot', 'teacher_id')] = Array.isArray(updates.teacherId) ? updates.teacherId : [updates.teacherId];
    }
    
    // Update record in Airtable
    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${tableId}/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fields }),
      }
    );
    
    // Map response back to WeeklySlot
    const responseFields = response.fields || {};
    const teacherIdField = getField('weeklySlot', 'teacher_id');
    const teacherIdValue = responseFields[teacherIdField];
    const teacherId = Array.isArray(teacherIdValue) 
      ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
      : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
    
    // Extract day_num (preferred) or day_of_week (fallback)
    const dayNumField = getField('weeklySlot', 'day_num');
    const dayOfWeekField = getField('weeklySlot', 'day_of_week');
    const dayNumValue = responseFields[dayNumField];
    const dayOfWeekValue = responseFields[dayOfWeekField];
    
    // Prefer day_num, convert from 1-7 to 0-6
    let dayOfWeek: number;
    if (dayNumValue !== null && dayNumValue !== undefined && dayNumValue !== '') {
      const num = typeof dayNumValue === 'string' ? parseInt(dayNumValue, 10) : dayNumValue;
      if (!isNaN(num) && num >= 1 && num <= 7) {
        dayOfWeek = num - 1; // 1->0, 2->1, ..., 7->6
      } else {
        dayOfWeek = 0;
      }
    } else if (dayOfWeekValue !== null && dayOfWeekValue !== undefined && dayOfWeekValue !== '') {
      const num = typeof dayOfWeekValue === 'string' ? parseInt(dayOfWeekValue, 10) : dayOfWeekValue;
      dayOfWeek = isNaN(num) ? 0 : Math.max(0, Math.min(6, Math.floor(num)));
    } else {
      dayOfWeek = 0;
    }
    
    const reservedForValue = responseFields[getField('weeklySlot', 'reserved_for')];
    const reservedFor = reservedForValue
      ? (Array.isArray(reservedForValue) 
          ? (typeof reservedForValue[0] === 'string' ? reservedForValue[0] : reservedForValue[0]?.id || undefined)
          : (typeof reservedForValue === 'string' ? reservedForValue : reservedForValue?.id || undefined))
      : undefined;
    
    const fixedField = getField('weeklySlot', 'קבוע' as any);
    const isFixed = responseFields[fixedField] === true || responseFields[fixedField] === 1;
    
    // Extract type - NO FALLBACK, use actual value from Airtable
    // Type values in Airtable are in Hebrew: "פרטי", "זוגי", "קבוצתי"
    const typeField = getField('weeklySlot', 'type');
    const rawTypeValue = responseFields[typeField];
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
    
    const updatedSlot: WeeklySlot = {
      id: response.id || id,
      dayOfWeek: dayOfWeek,
      startTime: responseFields[getField('weeklySlot', 'start_time')] || '',
      endTime: responseFields[getField('weeklySlot', 'end_time')] || '',
      teacherId: teacherId || '',
      teacherName: teachersMap.get(teacherId || '') || '',
      type: finalType as 'private' | 'group' | 'pair',
      durationMin: responseFields[getField('weeklySlot', 'duration_min')],
      isFixed: isFixed,
      reservedFor: reservedFor,
      status: 'active',
    };
    
    console.log(`[nexusApi] Updated weekly slot ${id}`);
    return updatedSlot;
  },

  updateSlotInventory: async (id: string, updates: Partial<SlotInventory>): Promise<SlotInventory> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
      
      console.log(`[nexusApi] Setting teacherId field "${teacherIdField}" to array:`, [trimmedTeacherId]);
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
      // Map new status values to Airtable values if needed
      let statusValue = updates.status as string;
      if (statusValue === 'closed') statusValue = 'סגור';
      if (statusValue === 'canceled') statusValue = 'מבוטל';
      if (statusValue === 'blocked') statusValue = 'חסום ע"י מנהל';
      
      // DATA LAYER: Prevent opening slot if lessons overlap
      // If trying to set status to "open", check for overlapping lessons first
      if (statusValue === 'open' || statusValue === 'פתוח') {
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
    const statusValue = responseFields[statusField] || 'open';
    // Normalize status: handle Hebrew values and map to internal enum
    const status = (
      statusValue === 'open' || statusValue === 'פתוח'
        ? 'open'
        : statusValue === 'closed' || statusValue === 'סגור' || statusValue === 'booked'
        ? 'closed'
        : statusValue === 'canceled' || statusValue === 'מבוטל'
        ? 'canceled'
        : statusValue === 'blocked' || statusValue === 'חסום ע"י מנהל' || statusValue === 'חסום'
        ? 'blocked'
        : 'open' // Default to 'open' for unknown values
    ) as 'open' | 'closed' | 'canceled' | 'blocked';
    
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
    
    console.log(`[nexusApi] Updated slot inventory ${id}`);
    return updatedInventory;
  },

  deleteSlotInventory: async (id: string): Promise<void> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    const tableId = AIRTABLE_CONFIG.tables.slot_inventory;
    
    // Delete record from Airtable
    await airtableRequest<{ id: string; deleted: boolean }>(
      `/${tableId}/${id}`,
      {
        method: 'DELETE',
      }
    );
    
    console.log(`[nexusApi] Deleted slot inventory ${id}`);
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
      reservedFor: slot.reservedFor,
      reservedForIds: slot.reservedForIds,
      durationMin: slot.durationMin,
    });
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
    console.log(`[nexusApi] openWeekSlots called for week starting ${weekStart.toISOString()}`);
    return openNewWeekService(weekStart);
  },

  getHomeworkLibrary: async (): Promise<HomeworkLibraryItem[]> => {
    // Fetch from Airtable - no fallback
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    const params = new URLSearchParams({
      pageSize: '100',
    });
    const response = await airtableRequest<{ records: any[] }>(`/${AIRTABLE_CONFIG.tables.homework}?${params}`);
    const homework = response.records.map((record: any) => {
      const fields = record.fields || {};
      return {
        id: record.id,
        title: fields['Title'] || fields['title'] || '',
        subject: fields['Subject'] || fields['subject'] || '',
        level: fields['Level'] || fields['level'] || '',
        description: fields['Description'] || fields['description'] || '',
        attachmentUrl: fields['Attachment_URL'] || fields['attachment_url'],
      };
    });
    console.log(`[Airtable] Fetched ${homework.length} homework items`);
    return homework;
  },

  getHomeworkAssignments: (): Promise<HomeworkAssignment[]> => {
    // Use mock data only
    return Promise.resolve([
      { id: 'as1', studentId: '1', studentName: 'אבי כהן', homeworkId: 'hw1', homeworkTitle: 'פונקציות קוויות', status: 'assigned', dueDate: '2024-03-30', assignedDate: '2024-03-20' }
    ]);
  },

  assignHomework: (payload: Partial<HomeworkAssignment>): Promise<HomeworkAssignment> => {
    // Mock assignment only
    return Promise.resolve({
      id: Math.random().toString(36).substr(2, 9),
      ...payload,
      assignedDate: new Date().toISOString(),
      status: 'assigned'
    } as HomeworkAssignment);
  },

  updateLesson: async (id: string, updates: Partial<Lesson>): Promise<Lesson> => {
    // Update in Airtable - no fallback
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
        body: JSON.stringify(airtableFields),
      }
    );
    // Airtable returns { id, fields } on PATCH
    const updatedLesson = mapAirtableToLesson({ id: response.id || id, fields: response.fields });
    console.log(`[Airtable] Updated lesson ${id}`);
    return updatedLesson;
  },

  getBillingKPIs: async (month: string): Promise<ChargesReportKPIs> => {
    try {
      if (import.meta.env.DEV) {
        console.log('[nexusApi] Fetching billing KPIs for month:', month);
      }
      const kpis = await getChargesReportKPIs(airtableClient, month);
      if (import.meta.env.DEV) {
        console.log('[nexusApi] Received KPIs:', kpis);
      }
      return kpis;
    } catch (error) {
      console.error('[nexusApi] Error fetching billing KPIs:', error);
      throw error;
    }
  },

  getMonthlyBills: async (
    month: string,
    options?: { statusFilter?: 'all' | 'draft' | 'sent' | 'paid' | 'link_sent'; searchQuery?: string }
  ): Promise<MonthlyBill[]> => {
    try {
      // Pass status filter directly to API (no mapping needed - getChargesReport supports all values)
      const apiStatusFilter: 'all' | 'draft' | 'sent' | 'paid' | 'link_sent' = options?.statusFilter || 'all';
      
      if (import.meta.env.DEV) {
        console.log('[nexusApi.getMonthlyBills] Fetching for month:', month, 'statusFilter:', apiStatusFilter, 'searchQuery:', options?.searchQuery);
      }
      
      // Use the new charges report service with filters
      const report = await getChargesReport(airtableClient, {
        billingMonth: month,
        statusFilter: apiStatusFilter,
        searchQuery: options?.searchQuery,
      });
      
      if (import.meta.env.DEV) {
        console.log('[nexusApi.getMonthlyBills] Got', report.rows.length, 'rows from getChargesReport');
      }
      
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
      if (studentIds.size > 0 && AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
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
        let subscriptionsAmount = typeof row.subscriptionsAmount === 'number' ? row.subscriptionsAmount : 0;
        let lessonsAmount = typeof row.lessonsAmount === 'number' ? row.lessonsAmount : 0;
        let totalAmount = typeof row.totalAmount === 'number' ? row.totalAmount : 0;

        // SMART RECOVERY LOGIC:
        // If total is 0 or looks like a subtotal, we need to handle it.
        // The user says Subscription is 480, Total is 280, Adjustment is -200.
        // If we extracted Sub=280 and Total=480, they are likely swapped OR Total is Subtotal.
        
        if (totalAmount > 0 && Math.abs(totalAmount + adjustmentAmount - subscriptionsAmount) < 1) {
          // Case: Total=480, Adj=-200, Subs=280. 
          // Here 480 is actually the Subtotal (Subs+Lessons).
          // We should swap them or recalculate.
          const subtotal = totalAmount;
          totalAmount = subtotal + adjustmentAmount; // 480 - 200 = 280 (Correct Total)
          subscriptionsAmount = subtotal - lessonsAmount; // 480 - 0 = 480 (Correct Subs)
        } else if (totalAmount === 0 && (subscriptionsAmount !== 0 || lessonsAmount !== 0)) {
          totalAmount = subscriptionsAmount + lessonsAmount + adjustmentAmount;
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

  updateBillStatus: async (billId: string, fields: { approved?: boolean; linkSent?: boolean; paid?: boolean }): Promise<void> => {
    const billingTableId = getTableId('monthlyBills');
    
    const performUpdate = async (approvedField: string, linkSentField: string, paidField: string) => {
      const airtableFields: Record<string, any> = {};
      if (fields.approved !== undefined) airtableFields[approvedField] = fields.approved;
      if (fields.linkSent !== undefined) airtableFields[linkSentField] = fields.linkSent;
      if (fields.paid !== undefined) airtableFields[paidField] = fields.paid;

      if (import.meta.env.DEV) {
        console.log(`[nexusApi.updateBillStatus] Sending update to Airtable.`, {
          table: billingTableId,
          record: billId,
          fields: airtableFields,
        });
      }

      return await airtableClient.updateRecord(billingTableId, billId, airtableFields, { typecast: true });
    };

    try {
      if (import.meta.env.DEV) {
        console.log(`[nexusApi.updateBillStatus] Starting update for bill ${billId}`, fields);
      }

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
      if (import.meta.env.DEV) console.log('[nexusApi.updateBillStatus] Update successful with defaults');

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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    const params = new URLSearchParams({
      pageSize: '100',
    });
    const subscriptionsTableId = getTableId('subscriptions');
    const response = await airtableRequest<{ records: any[] }>(`/${subscriptionsTableId}?${params}`);
    const subscriptions = response.records.map((record: any) => nexusApi.mapAirtableToSubscription(record));
    console.log(`[Airtable] Fetched ${subscriptions.length} subscriptions`);
    return subscriptions;
  },

  createSubscription: async (subscription: Partial<Subscription>): Promise<Subscription> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
    console.log(`[Airtable] Created subscription ${response.id}`);
    return newSubscription;
  },

  updateSubscription: async (id: string, updates: Partial<Subscription>): Promise<Subscription> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
    console.log(`[Airtable] Updated subscription ${id}`);
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

  // Search students with autocomplete
  searchStudents: async (query: string, limit: number = 15): Promise<Student[]> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    if (query.length < 2) {
      return []; // Require at least 2 characters
    }

    const searchQuery = query.trim().toLowerCase();
    
    // Try formula-based search first
    try {
      // Use SEARCH-based formula for case-insensitive matching
      // Try multiple possible field names for status and name
      // Airtable field names might be: 'full_name', 'Full Name', 'fullName', etc.
      const fullNameField = getField('students', 'full_name');
      const phoneField = getField('students', 'phone_number');
      const filterFormula = `AND(
        OR({is_active}=1, {Status}!='inactive', {status}!='inactive', {is_active}=TRUE()),
        OR(
          SEARCH(LOWER("${searchQuery}"), LOWER({${fullNameField}}&"")),
          SEARCH(LOWER("${searchQuery}"), LOWER({${phoneField}}&""))
        )
      )`;

      // URL-encode the filterByFormula
      const encodedFormula = encodeURIComponent(filterFormula);
      
      const params = new URLSearchParams({
        filterByFormula: filterFormula, // URLSearchParams will encode it, but we also log the raw formula
        pageSize: String(limit),
        maxRecords: String(limit),
      });
      params.append('sort[0][field]', fullNameField);
      params.append('sort[0][direction]', 'asc');
      
      // Remove any view parameter if present
      // params.delete('view'); // Not needed if we don't add it

      const studentsTableId = getTableId('students');
      const url = `/${studentsTableId}?${params}`;
      const fullUrl = `${API_BASE_URL}/${encodeURIComponent(AIRTABLE_BASE_ID)}${url}`;
      
      console.log(`[DEBUG Student Search] Query: "${query}"`);
      console.log(`[DEBUG Student Search] Full URL: ${fullUrl}`);
      console.log(`[DEBUG Student Search] Raw filterByFormula: ${filterFormula}`);
      console.log(`[DEBUG Student Search] URL-encoded formula: ${encodedFormula}`);
      console.log(`[DEBUG Student Search] Field names used: full_name="${fullNameField}", phone_number="${phoneField}"`);

      const response = await airtableRequest<{ records: any[] }>(`/${studentsTableId}?${params}`);
      
      console.log(`[DEBUG Student Search] Raw Airtable response:`, JSON.stringify(response, null, 2));
      console.log(`[DEBUG Student Search] Number of records: ${response.records?.length || 0}`);
      
      if (response.records && response.records.length > 0) {
        const firstRecord = response.records[0];
        console.log(`[DEBUG Student Search] First record fields:`, Object.keys(firstRecord.fields || {}));
        console.log(`[DEBUG Student Search] First record full_name value:`, firstRecord.fields?.[fullNameField]);
        console.log(`[DEBUG Student Search] First record phone_number value:`, firstRecord.fields?.[phoneField]);
        console.log(`[DEBUG Student Search] First record Status/is_active:`, firstRecord.fields?.Status || firstRecord.fields?.status || firstRecord.fields?.is_active);
      }

      const students = response.records.map(mapAirtableToStudent);
      console.log(`[Airtable] Searched students: found ${students.length} results for "${query}"`);
      
      if (students.length > 0) {
        return students;
      }
    } catch (formulaError: any) {
      console.warn(`[DEBUG Student Search] Formula-based search failed:`, formulaError);
      console.warn(`[DEBUG Student Search] Falling back to local filtering...`);
    }

    // Fallback: Fetch all active students and filter locally
    console.log(`[DEBUG Student Search] Using fallback: fetching all students and filtering locally`);
    try {
      // Fetch directly using airtableRequest to avoid circular dependency
      const params = new URLSearchParams({ pageSize: '100' });
      const studentsTableId = getTableId('students');
      const response = await airtableRequest<{ records: any[] }>(`/${studentsTableId}?${params}`);
      
      // Log available field names from first record for debugging
      if (response.records && response.records.length > 0) {
        const firstRecord = response.records[0];
        console.log(`[DEBUG Student Search Fallback] Available field names in first record:`, Object.keys(firstRecord.fields || {}));
        console.log(`[DEBUG Student Search Fallback] First record fields object:`, firstRecord.fields);
      }
      
      const allStudents = response.records.map(mapAirtableToStudent);
      console.log(`[DEBUG Student Search] Fetched ${allStudents.length} total students`);
      
      // Filter locally: case-insensitive search in name or phone, only active students
      const filtered = allStudents
        .filter(student => {
          // Check if student is active
          const isActive = student.status !== 'inactive';
          
          // Case-insensitive search in name or phone
          const nameMatch = student.name?.toLowerCase().includes(searchQuery);
          const phoneMatch = student.phone?.toLowerCase().includes(searchQuery);
          
          return isActive && (nameMatch || phoneMatch);
        })
        .slice(0, limit)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
      
      console.log(`[DEBUG Student Search] Local filter found ${filtered.length} results`);
      return filtered;
    } catch (fallbackError: any) {
      console.error(`[DEBUG Student Search] Fallback also failed:`, fallbackError);
      return [];
    }
  },

  getStudentByRecordId: async (recordId: string): Promise<Student | null> => {
    if (!recordId || !recordId.startsWith('rec')) return null;
    
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    try {
      const studentsTableId = getTableId('students');
      const response = await airtableRequest<{ id: string; fields: any }>(`/${studentsTableId}/${recordId}`);
      
      if (import.meta.env.DEV) {
        console.log('[nexusApi.getStudentByRecordId] Fetched student:', recordId, response.fields?.[getField('students', 'full_name')]);
      }
      
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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
    console.log(`[Airtable] Conflict check: found ${conflicts.length} conflicting lessons`);
    return conflicts;
  },

  // Create a new lesson with server-side validation
  createLesson: async (lesson: Partial<Lesson>): Promise<Lesson> => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:createLesson:entry',message:'createLesson ENTRY - starting function',data:{teacherId:lesson.teacherId,date:lesson.date,startTime:lesson.startTime,duration:lesson.duration,studentId:lesson.studentId,lessonType:lesson.lessonType,source:(lesson as any).source},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1,H2'})}).catch(()=>{});
    // #endregion
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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
        console.log(`[DEBUG createLesson] Verified student ${lesson.studentId} exists in Students table`);
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
    
    console.log(`[DEBUG createLesson] PART B - Validated student ID: ${studentRecordId}`);

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
    
    console.log(`[DEBUG createLesson] PART C - Datetime calculation:`);
    console.log(`[DEBUG createLesson] PART C - start_datetime (UTC): ${startDatetime}`);
    console.log(`[DEBUG createLesson] PART C - duration: ${lesson.duration} minutes`);
    console.log(`[DEBUG createLesson] PART C - end_datetime (UTC): ${endDatetime}`);
    console.log(`[DEBUG createLesson] PART C - Validation: end > start: ${endTimeMs > startTimeMs} (${endTimeMs} > ${startTimeMs})`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:createLesson:beforeConflictCheck',message:'createLesson - BEFORE server-side lesson conflict check',data:{startDatetime,endDatetime,studentId:studentRecordId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H4'})}).catch(()=>{});
    // #endregion

    // Server-side conflict check (call the function directly, not through nexusApi to avoid circular reference)
    const conflicts = await (async () => {
      if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
        throw new Error('Airtable API Key or Base ID not configured');
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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:createLesson:afterConflictCheck',message:'createLesson - AFTER server-side lesson conflict check',data:{conflictsCount:conflicts.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H4'})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:2653',message:'createLesson: checking if conflict check should run',data:{teacherId:lesson.teacherId,date:lesson.date,startTime:lesson.startTime,hasAllRequired:!!(lesson.date && lesson.startTime),isFromSlotBooking},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (isFromSlotBooking && import.meta.env.DEV) {
      console.log(`[createLesson] Skipping slot conflict check - lesson is from slot_inventory booking (slotBookingService handles slot closure)`);
    }
    if (lesson.date && lesson.startTime && !isFromSlotBooking) {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:2656',message:'createLesson: resolving teacherId',data:{originalTeacherId:lesson.teacherId,teacherIdIsRecordId:lesson.teacherId?.startsWith('rec'),date:lesson.date,startTime:lesson.startTime,duration:lesson.duration || 60},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        // Resolve teacherId: convert number (e.g., "1") to record ID if needed
        const resolvedTeacherId = await resolveTeacherRecordId(lesson.teacherId);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:2660',message:'createLesson: resolved teacherId',data:{originalTeacherId:lesson.teacherId,resolvedTeacherId,date:lesson.date,startTime:lesson.startTime,duration:lesson.duration || 60},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        const { validateConflicts } = await import('./conflictValidationService');
        const validationResult = await validateConflicts({
          teacherId: resolvedTeacherId, // undefined means check all teachers
          date: lesson.date,
          startTime: lesson.startTime,
          endTime: lesson.duration || 60, // duration in minutes
        });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:2664',message:'createLesson: validateConflicts result',data:{openSlotsCount:validationResult.conflicts.openSlots.length,lessonsCount:validationResult.conflicts.lessons.length,openSlots:validationResult.conflicts.openSlots.map(s=>({id:s.id,status:s.status,date:s.date,startTime:s.startTime,endTime:s.endTime,teacherId:s.teacherId}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B,D,E'})}).catch(()=>{});
        // #endregion

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
        if (closedSlots.length > 0 && import.meta.env.DEV) {
          console.log(`[createLesson] Auto-closed ${closedSlots.length} overlapping open slot(s)`);
        }
      } catch (conflictError: any) {
        // Re-throw conflict errors (they should prevent lesson creation)
        if (conflictError.code === 'CONFLICT_ERROR') {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:createLesson:slotConflictError',message:'createLesson - SLOT CONFLICT ERROR thrown',data:{errorCode:conflictError.code,errorMessage:conflictError.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1,H2'})}).catch(()=>{});
          // #endregion
          throw conflictError;
        }
        // Log but don't fail lesson creation if other errors occur
        console.warn(`[createLesson] Failed to check/close overlapping slots:`, conflictError);
      }
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:createLesson:afterSlotCheck',message:'createLesson - AFTER slot conflict check - preparing Airtable fields',data:{isFromSlotBooking},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

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
    
    // Use valid status value if found, otherwise use the requested value
    // If status field is required but we can't determine valid value, try common options
    const finalStatusValue = validStatusValue || statusValue;
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
    console.log(`[DEBUG createLesson] PART B - Writing student(s) to field "${studentFieldName}" = ${JSON.stringify(studentIdsToLink)}`);

    // Add source if available
    try {
      const sourceField = getField('lessons', 'source');
      if (lesson.source) {
        airtableFields.fields[sourceField] = lesson.source;
      }
    } catch (e) {
      console.warn(`[nexusApi] source field not found in mapping, skipping`);
    }

    // Teacher link - OPTIONAL
    // Note: According to the report, the field is 'teacher_id' (linked record to teachers)
    if (lesson.teacherId) {
      if (lesson.teacherId.startsWith('rec')) {
        const teacherFieldName = getField('lessons', 'teacher_id');
        airtableFields.fields[teacherFieldName] = [lesson.teacherId];
        console.log(`[DEBUG createLesson] Added teacher field "${teacherFieldName}" = ["${lesson.teacherId}"]`);
      } else {
        console.warn(`[DEBUG createLesson] Invalid teacher ID format: ${lesson.teacherId}`);
      }
    }

    if (lesson.notes) {
      const lessonDetailsField = getField('lessons', 'פרטי_השיעור' as any);
      airtableFields.fields[lessonDetailsField] = lesson.notes;
    }

    // Price - OPTIONAL (only for private lessons)
    if (lesson.lessonType === 'private' || lesson.isPrivate) {
      const priceField = getField('lessons', 'price');
      const calculatedPrice = lesson.price !== undefined 
        ? lesson.price 
        : ((lesson.duration || 60) / 60) * 175;
      airtableFields.fields[priceField] = Math.round(calculatedPrice * 100) / 100;
      console.log(`[DEBUG createLesson] Added price field "${priceField}" = ${airtableFields.fields[priceField]}`);
    }

    // Subject field - REMOVED (not in config, will cause "Unknown field name" error)
    // DO NOT add lesson.subject - field name must be discovered from existing records first
    // Once discovered, add to config as lessonSubject: 'actual_field_name', then uncomment:
    // if (lesson.subject) {
    //   addFieldIfMapped('lessonSubject', lesson.subject, airtableFields);
    // }

    // Lesson type - map English values to Hebrew for Airtable
    if (lesson.lessonType) {
      const lessonTypeField = getField('lessons', 'lesson_type');
      // Map English to Hebrew
      const typeMap: Record<string, string> = {
        'private': 'פרטי',
        'pair': 'זוגי',
        'group': 'קבוצתי',
      };
      const hebrewType = typeMap[lesson.lessonType] || lesson.lessonType;
      airtableFields.fields[lessonTypeField] = hebrewType;
      console.log(`[DEBUG createLesson] Added lesson type field "${lessonTypeField}" = "${hebrewType}"`);
    }

    console.log(`[DEBUG createLesson] Final payload fields:`, Object.keys(airtableFields.fields));
    console.log(`[DEBUG createLesson] All fields are from config mapping - no hardcoded field names`);
    console.log(`[DEBUG createLesson] Complete Airtable payload:`, JSON.stringify(airtableFields, null, 2));

    // Create the lesson in Airtable using STRICT field mapping (no fallbacks)
    // All field names must be defined in fieldMap
    try {
      const lessonsTableId = getTableId('lessons');
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:createLesson:beforeAirtable',message:'About to call Airtable API',data:{lessonsTableId,fieldCount:Object.keys(airtableFields.fields).length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      const response = await airtableRequest<{ id: string; fields: any }>(
        `/${lessonsTableId}`,
        {
          method: 'POST',
          body: JSON.stringify(airtableFields),
        }
      );
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:createLesson:airtableSuccess',message:'Airtable returned successfully',data:{lessonId:response.id,fieldKeys:Object.keys(response.fields||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      console.log(`[DEBUG createLesson] STEP 5 - SUCCESS! Created lesson ${response.id}`);
      console.log(`[DEBUG createLesson] STEP 5 - Response fields:`, Object.keys(response.fields || {}));
      
      // Map response to Lesson
      const newLesson = mapAirtableToLesson({ id: response.id, fields: response.fields });
      
      console.log(`[Airtable] Created lesson ${response.id}`);
      
      // STEP 6: Trigger Make.com scenario to create calendar event
      // This is non-blocking - we don't fail the lesson creation if Make fails
      try {
        console.log(`[DEBUG createLesson] STEP 6 - Triggering Make.com scenario for calendar sync`);
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
          console.log(`[DEBUG createLesson] STEP 6 - Make.com scenario triggered successfully`);
        } else {
          console.warn(`[DEBUG createLesson] STEP 6 - Make.com scenario failed (non-blocking):`, makeResult.error);
        }
      } catch (makeError) {
        // Log but don't fail - the lesson was already created in Airtable
        console.warn(`[DEBUG createLesson] STEP 6 - Make.com trigger failed (non-blocking):`, makeError);
      }
      
      return newLesson;
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexusApi.ts:createLesson:catch',message:'createLesson failed',data:{errorMessage:error?.message,errorCode:error?.code,errorStatus:error?.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }
    
    return await createMonthlyCharges(airtableClient, billingMonth);
  },

  updateBillAdjustment: async (billId: string, adjustment: { amount: number; reason: string }): Promise<void> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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

      if (import.meta.env.DEV) {
        console.log(`[nexusApi.updateBillAdjustment] Updated adjustment for bill ${billId}`, adjustment);
      }
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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    const billingTableId = getTableId('monthlyBills');

    try {
      await airtableClient.deleteRecord(billingTableId, billId);

      if (import.meta.env.DEV) {
        console.log(`[nexusApi.deleteBill] Deleted bill ${billId}`);
      }
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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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

    console.log(`[Airtable] Fetched ${entities.length} entities`);
    return entities;
  },

  createEntity: async (data: Partial<Entity>): Promise<Entity> => {
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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

      console.log(`[Airtable] Created entity ${response.id}`);
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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
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

      console.log(`[Airtable] Updated entity ${entityId}`);
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
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable API Key or Base ID not configured');
    }

    const entitiesTableId = AIRTABLE_CONFIG.tables.entities;

    try {
      await airtableRequest<{ id: string; deleted: boolean }>(
        `/${entitiesTableId}/${entityId}`,
        { method: 'DELETE' }
      );

      console.log(`[Airtable] Deleted entity ${entityId}`);
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
};

