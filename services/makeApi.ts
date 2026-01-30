/**
 * Make.com API Service
 * Handles communication with Make scenarios through Vite proxy
 * 
 * The Vite proxy is configured to forward /api/make/* to Make.com API
 * with authentication automatically added.
 */

export interface SendTeacherCancelParams {
  phone: string;       // Normalized phone number (e.g., "504343547")
  date: string;        // ISO date format (e.g., "2026-02-01")
  name: string;        // Student name
}

export interface SendTeacherCancelResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Normalize Israeli phone number to digits only
 * Removes +972, leading 0, spaces, and dashes
 * @param phone - Raw phone number string
 * @returns Normalized phone (e.g., "504343547")
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');
  
  // Handle Israeli country code +972 or 972
  if (digits.startsWith('972')) {
    digits = digits.slice(3);
  }
  
  // Remove leading 0 if present
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  
  return digits;
}

/**
 * Format date to ISO format (YYYY-MM-DD)
 * @param date - Date string in various formats
 * @returns ISO date string
 */
export function formatDateForMake(date: string): string {
  if (!date) return '';
  
  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  
  // Try to parse and format
  try {
    const dateObj = new Date(date);
    return dateObj.toISOString().split('T')[0];
  } catch {
    return date;
  }
}

// Get scenario ID from environment
const TEACHER_CANCEL_SCENARIO_ID = import.meta.env.VITE_MAKE_SCENARIO_TEACHER_CANCEL_ID || '';

/**
 * Trigger a Make scenario with data
 * Uses the Vite proxy which forwards to Make.com API
 * 
 * @param scenarioId - The Make scenario ID to trigger
 * @param data - Data to pass to the scenario
 * @returns Result with success status
 */
async function triggerMakeScenario(
  scenarioId: string,
  data: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  if (!scenarioId) {
    return {
      success: false,
      error: 'Scenario ID not configured',
    };
  }

  try {
    // Make.com On-Demand API endpoint: POST /scenarios/{scenarioId}/run
    // The Vite proxy rewrites /api/make to /api/v2
    const response = await fetch(`/api/make/scenarios/${scenarioId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Make API error (${response.status})`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        // Use default error message
      }
      console.error('[makeApi] triggerMakeScenario error:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[makeApi] triggerMakeScenario network error:', err);
    return {
      success: false,
      error: err.message || 'Network error',
    };
  }
}

/**
 * Send teacher cancellation notification via Make scenario
 * This triggers the "הודעת ביטול ע\"י מורה" scenario
 * 
 * @param params - Phone, date, and name for the notification
 * @returns Result with success status and any error message
 */
export async function sendTeacherCancelNotification(
  params: SendTeacherCancelParams
): Promise<SendTeacherCancelResult> {
  const { phone, date, name } = params;
  
  // Validate required fields
  if (!phone || !date || !name) {
    return {
      success: false,
      error: 'חסרים פרטים לשליחת ההודעה (טלפון, תאריך או שם)',
    };
  }
  
  // Normalize phone number
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone || normalizedPhone.length < 9) {
    return {
      success: false,
      error: 'מספר טלפון לא תקין',
    };
  }
  
  // Format date
  const formattedDate = formatDateForMake(date);
  
  // Check if scenario ID is configured
  if (!TEACHER_CANCEL_SCENARIO_ID) {
    console.error('[makeApi] VITE_MAKE_SCENARIO_TEACHER_CANCEL_ID not configured');
    return {
      success: false,
      error: 'סנריו ההודעות לא מוגדר. יש להגדיר VITE_MAKE_SCENARIO_TEACHER_CANCEL_ID',
    };
  }
  
  // Trigger the Make scenario
  const result = await triggerMakeScenario(TEACHER_CANCEL_SCENARIO_ID, {
    phone: normalizedPhone,
    date: formattedDate,
    name: name.trim(),
  });
  
  if (result.success) {
    return {
      success: true,
      message: 'ההודעה נשלחה בהצלחה',
    };
  } else {
    return {
      success: false,
      error: result.error || 'שגיאה בשליחת ההודעה',
    };
  }
}
