
import { Subscription } from '../types';
import { AIRTABLE_CONFIG } from '../config/airtable';
import { getAuthToken } from '../hooks/useAuth';
import { apiUrl } from '../config/api';

const PROXY_BASE_URL = '/api/airtable';

/**
 * Airtable API helper function (via backend proxy)
 */
async function airtableRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  if (!token) {
    throw {
      message: 'Authentication required. Please log in.',
      code: 'AUTH_REQUIRED',
      status: 401,
    };
  }

  // Encode table IDs for safety
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
      if (response.status === 401) {
        sessionStorage.removeItem('auth_token');
        window.location.reload();
      }

      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      console.error(`[SubscriptionsService] Error ${response.status}:`, errorData);
      throw {
        message: errorData.error?.message || `API error: ${response.statusText}`,
        code: 'AIRTABLE_ERROR',
        status: response.status,
        details: errorData,
      };
    }

    return response.json() as Promise<T>;
  } catch (err: any) {
    if (err.code === 'AIRTABLE_ERROR' || err.code === 'AUTH_REQUIRED') {
      throw err;
    }
    // Network or other errors
    throw {
      message: `Failed to connect to API: ${err.message}`,
      code: 'AIRTABLE_CONNECTION_ERROR',
      status: 0,
    };
  }
}

/**
 * Parse monthly amount from currency string or number to number
 * Handles formats like:
 * - String: "₪480.00", "₪ 1,200.00", "480.00", "480", etc.
 * - Number: 480, 1200.50, etc.
 * Returns 0 if invalid
 */
export function parseMonthlyAmount(amount: string | number | undefined | null): number {
  // Handle null/undefined
  if (amount === null || amount === undefined) {
    return 0;
  }

  // If it's already a number, validate and return
  if (typeof amount === 'number') {
    return isNaN(amount) || amount < 0 ? 0 : amount;
  }

  // If it's a string, parse it
  if (typeof amount === 'string') {
    // Remove currency symbols (₪), commas, and whitespace
    const cleaned = amount.replace(/[₪,\s]/g, '').trim();
    
    // If empty after cleaning, return 0
    if (cleaned === '') {
      return 0;
    }
    
    const num = parseFloat(cleaned);
    return isNaN(num) || num < 0 ? 0 : num;
  }

  // Fallback for any other type
  return 0;
}

/**
 * Map Airtable record to Subscription
 */
function mapAirtableToSubscription(record: any): Subscription {
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
  
  // Handle linked record (student) — Airtable may return field as student_id, תלמיד (Hebrew), or other names
  const STUDENT_LINK_FIELD_NAMES = [
    'student_id',
    'Student_ID',
    'studentId',
    'StudentId',
    'תלמיד', // Used in Billing table and possibly in Subscriptions (contracts/validators.ts)
  ];
  let studentIdField: unknown = '';
  for (const name of STUDENT_LINK_FIELD_NAMES) {
    if (fields[name] !== undefined && fields[name] !== null) {
      studentIdField = fields[name];
      break;
    }
  }
  // Fallback 1: any field key that looks like a student link by name
  if (!studentIdField || (Array.isArray(studentIdField) && studentIdField.length === 0)) {
    const fieldKeys = Object.keys(fields);
    for (const key of fieldKeys) {
      const lower = key.toLowerCase();
      if (lower === 'תלמיד' || lower === 'student' || lower === 'student_id') {
        const v = fields[key];
        if (v !== undefined && v !== null && (typeof v === 'string' || (Array.isArray(v) && v.length > 0))) {
          studentIdField = v;
          break;
        }
      }
    }
  }
  // Fallback 2: any field whose value is an array of Airtable record IDs (rec...)
  // Prefer keys that suggest student (תלמיד, student); else take first linked-record array
  if (!studentIdField || (Array.isArray(studentIdField) && studentIdField.length === 0)) {
    const idFrom = (v: unknown): string => {
      if (!Array.isArray(v) || !v.length) return '';
      const first = v[0];
      return typeof first === 'string' ? first : (first && typeof first === 'object' ? (first as { id?: string }).id ?? '' : '');
    };
    const isRecIdArray = (v: unknown): boolean =>
      Array.isArray(v) && v.length > 0 && idFrom(v).startsWith('rec');
    // 2a: key hints student
    for (const key of Object.keys(fields)) {
      const k = key.toLowerCase();
      if ((k.includes('תלמיד') || k.includes('student')) && isRecIdArray(fields[key])) {
        studentIdField = fields[key];
        break;
      }
    }
    // 2b: first array of rec IDs
    if (!studentIdField || (Array.isArray(studentIdField) && studentIdField.length === 0)) {
      for (const key of Object.keys(fields)) {
        const v = fields[key];
        if (isRecIdArray(v)) {
          studentIdField = v;
          break;
        }
      }
    }
  }
  const studentId = Array.isArray(studentIdField)
    ? (typeof studentIdField[0] === 'string' ? studentIdField[0] : (studentIdField[0] as { id?: string })?.id || '')
    : (typeof studentIdField === 'string' ? studentIdField : (studentIdField as { id?: string })?.id ?? '');

  // fullName: in some bases student_id (or תלמיד) holds the display name, not the record ID
  let fullName = '';
  const rawStudent = studentIdField;
  if (typeof rawStudent === 'string' && rawStudent.trim() !== '' && !rawStudent.startsWith('rec')) {
    fullName = rawStudent.trim();
  } else if (Array.isArray(rawStudent) && rawStudent.length > 0) {
    const first = rawStudent[0];
    if (typeof first === 'string' && first.trim() !== '' && !first.startsWith('rec')) {
      fullName = first.trim();
    } else if (first && typeof first === 'object' && typeof (first as { name?: string }).name === 'string') {
      fullName = (first as { name: string }).name.trim();
    }
  }

  // Otherwise try direct field names
  if (!fullName) {
    fullName = getField(['full_name', 'Full_Name', 'fullName', 'FullName']);
  }
  
  // If not found, search for lookup fields (containing "from student" or "from student_id")
  if (!fullName) {
    const fieldKeys = Object.keys(fields);
    for (const key of fieldKeys) {
      const lowerKey = key.toLowerCase();
      // Check if this is a lookup field related to student
      if ((lowerKey.includes('from student') || lowerKey.includes('from student_id')) &&
          (lowerKey.includes('name') || lowerKey.includes('full'))) {
        const value = fields[key];
        if (value !== undefined && value !== null && value !== '') {
          // Lookup fields can be strings or arrays
          if (typeof value === 'string' && value.trim() !== '') {
            fullName = value;
            break;
          } else if (Array.isArray(value) && value.length > 0) {
            // If array, take first non-empty string value
            const firstValue = value.find(v => v && typeof v === 'string' && v.trim() !== '');
            if (firstValue) {
              fullName = firstValue;
              break;
            }
          }
        }
      }
    }
  }

  return {
    id: record.id,
    studentId: studentId,
    fullName: fullName,
    subscriptionStartDate: getField(['subscription_start_date', 'Subscription_Start_Date', 'subscriptionStartDate', 'SubscriptionStartDate']) || '',
    subscriptionEndDate: getField(['subscription_end_date', 'Subscription_End_Date', 'subscriptionEndDate', 'SubscriptionEndDate']) || '',
    monthlyAmount: getField(['monthly_amount', 'Monthly_Amount', 'monthlyAmount', 'MonthlyAmount']) || '', // Store as-is (currency string)
    subscriptionType: getField(['subscription_type', 'Subscription_Type', 'subscriptionType', 'SubscriptionType']) || '',
    pauseSubscription: fields['pause_subscription'] || fields['Pause_Subscription'] || fields['pauseSubscription'] || fields['PauseSubscription'] || false,
    pauseDate: getField(['pause_date', 'Pause_Date', 'pauseDate', 'PauseDate']) || '',
  };
}

/**
 * Map Subscription to Airtable fields format
 */
function mapSubscriptionToAirtable(subscription: Partial<Subscription>): any {
  const airtableFields: any = {
    fields: {},
  };

  // Add student link if provided
  if (subscription.studentId) {
    airtableFields.fields['student_id'] = [subscription.studentId];
  }

  // Add optional fields (store monthly_amount as-is, Airtable expects currency string)
  if (subscription.subscriptionStartDate !== undefined) {
    airtableFields.fields['subscription_start_date'] = subscription.subscriptionStartDate || null;
  }
  if (subscription.subscriptionEndDate !== undefined) {
    airtableFields.fields['subscription_end_date'] = subscription.subscriptionEndDate || null;
  }
  if (subscription.monthlyAmount !== undefined) {
    // Store as-is - Airtable expects currency string format
    airtableFields.fields['monthly_amount'] = subscription.monthlyAmount || null;
  }
  if (subscription.subscriptionType !== undefined) {
    airtableFields.fields['subscription_type'] = subscription.subscriptionType || null;
  }
  if (subscription.pauseSubscription !== undefined) {
    airtableFields.fields['pause_subscription'] = subscription.pauseSubscription || false;
  }
  if (subscription.pauseDate !== undefined) {
    airtableFields.fields['pause_date'] = subscription.pauseDate || null;
  }

  return airtableFields;
}

/**
 * Subscriptions Service
 * Wraps all Airtable calls for subscription management
 */
export const subscriptionsService = {
  /**
   * List all subscriptions
   */
  listSubscriptions: async (): Promise<Subscription[]> => {
    const params = new URLSearchParams({
      pageSize: '100',
    });
    
    const response = await airtableRequest<{ records: any[] }>(
      `/${AIRTABLE_CONFIG.tables.subscriptions}?${params}`
    );
    
    // Log field names and types from first record for debugging
    if (response.records.length > 0 && import.meta.env.DEV) {
      const firstRecord = response.records[0];
      const fields = firstRecord.fields || {};
      const fieldKeys = Object.keys(fields);
      // Log each field key and a short value summary to see exact Airtable response
      fieldKeys.forEach(k => {
        const v = fields[k];
        const summary = Array.isArray(v)
          ? `[${v.length}] ${v.length ? (typeof v[0] === 'string' ? v[0] : (v[0] && typeof v[0] === 'object' ? (v[0] as { id?: string }).id : '')) : ''}`
          : String(v);
      });
    }
    
    const subscriptions = response.records.map(mapAirtableToSubscription);
    
    // Log mapping results for first few subscriptions
    if (import.meta.env.DEV && subscriptions.length > 0) {
      subscriptions.slice(0, 3).forEach((sub, idx) => {
      });
    }
    
    return subscriptions;
  },

  /**
   * Create a new subscription
   */
  createSubscription: async (data: Partial<Subscription>): Promise<Subscription> => {
    if (!data.studentId) {
      throw { 
        message: 'Missing required field: studentId', 
        code: 'VALIDATION_ERROR', 
        status: 400 
      };
    }

    const airtableFields = mapSubscriptionToAirtable(data);

    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${AIRTABLE_CONFIG.tables.subscriptions}`,
      {
        method: 'POST',
        body: JSON.stringify(airtableFields),
      }
    );

    const newSubscription = mapAirtableToSubscription({ 
      id: response.id, 
      fields: response.fields 
    });
    
    return newSubscription;
  },

  /**
   * Update an existing subscription
   */
  updateSubscription: async (id: string, data: Partial<Subscription>): Promise<Subscription> => {
    const airtableFields = mapSubscriptionToAirtable(data);

    const response = await airtableRequest<{ id: string; fields: any }>(
      `/${AIRTABLE_CONFIG.tables.subscriptions}/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(airtableFields),
      }
    );

    const updatedSubscription = mapAirtableToSubscription({ 
      id: response.id || id, 
      fields: response.fields 
    });
    
    return updatedSubscription;
  },
};
