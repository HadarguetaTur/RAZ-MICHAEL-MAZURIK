/**
 * AirtableClient - Data Access Layer with retry/backoff
 * Single point of access for all Airtable operations
 */

import { AIRTABLE_CONFIG } from '../config/airtable';

const API_BASE_URL = 'https://api.airtable.com/v0';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // Start with 1 second

// Use environment variables from Vite (import.meta.env.VITE_*)
const getApiKey = () => {
  return import.meta.env.VITE_AIRTABLE_API_KEY || '';
};

const getBaseId = () => {
  return import.meta.env.VITE_AIRTABLE_BASE_ID || '';
};

/**
 * Sleep utility for backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize fields before sending to Airtable
 * Removes computed/read-only fields that cannot be written
 * Airtable computed fields (AutoNumber/Formula/etc.) cannot be written; sending them causes 422
 */
function sanitizeFields(fields: any): any {
  if (!fields || typeof fields !== 'object') {
    return fields;
  }
  
  // List of read-only/computed field names that should never be sent
  const readonlyFieldNames = [
    'id',                    // Auto Number field (computed by Airtable)
    'createdTime',           // Created Time field (automatic timestamp)
    'Created time',          // Alternative casing
    'Created Time',          // Alternative casing
    'lastModifiedTime',      // Last Modified Time field (automatic timestamp)
    'Last Modified Time',    // Alternative casing
  ];
  
  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(fields)) {
    // Skip read-only fields
    if (readonlyFieldNames.includes(key)) {
      if (import.meta.env.DEV) {
        console.warn(`[AirtableClient] Skipping read-only field "${key}" in payload`);
      }
      continue;
    }
    
    // Skip undefined values (Airtable doesn't accept them)
    if (value === undefined) {
      continue;
    }
    
    sanitized[key] = value;
  }
  
  return sanitized;
}

/**
 * Retry with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  backoffMs: number = INITIAL_BACKOFF_MS
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Don't retry on client errors (4xx) except 429 (rate limit)
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      throw error;
    }

    // Don't retry if we're out of retries
    if (retries <= 0) {
      throw error;
    }

    // Wait before retrying
    await sleep(backoffMs);
    
    // Exponential backoff: double the wait time
    return withRetry(fn, retries - 1, backoffMs * 2);
  }
}

/**
 * AirtableClient - Single DAL for all Airtable operations
 */
export class AirtableClient {
  private apiKey: string;
  private baseId: string;
  private isConfigured: boolean;

  constructor(apiKey?: string, baseId?: string) {
    this.apiKey = apiKey || getApiKey();
    this.baseId = baseId || getBaseId();
    this.isConfigured = !!(this.apiKey && this.baseId);
  }

  /**
   * Check if client is configured and throw a clear error if not
   */
  private ensureConfigured(): void {
    if (!this.isConfigured) {
      throw {
        message: 'Airtable API Key or Base ID not configured. Please set VITE_AIRTABLE_API_KEY and VITE_AIRTABLE_BASE_ID in .env.local',
        code: 'AIRTABLE_NOT_CONFIGURED',
        status: 0,
      };
    }
  }

  /**
   * Make a request to Airtable API with retry/backoff
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Fail gracefully if not configured
    this.ensureConfigured();
    
    // Encode table IDs for safety
    const [tablePath, queryString] = endpoint.split('?');
    const pathParts = tablePath.split('/');
    if (pathParts.length > 1 && pathParts[1]) {
      pathParts[1] = encodeURIComponent(pathParts[1]);
    }
    const encodedPath = pathParts.join('/');
    const encodedEndpoint = queryString ? `${encodedPath}?${queryString}` : encodedPath;

    const url = `${API_BASE_URL}/${encodeURIComponent(this.baseId)}${encodedEndpoint}`;

    const makeRequest = async (): Promise<T> => {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
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

        // Extract table ID from endpoint for better error messages
        const tableIdMatch = endpoint.match(/\/([^/?]+)/);
        const tableId = tableIdMatch ? tableIdMatch[1] : 'unknown';

        // Enhanced error message for 403 (permission/not found errors)
        let errorMessage = errorData.error?.message || `Airtable API error: ${response.statusText}`;
        if (response.status === 403) {
          errorMessage = `Airtable 403 Forbidden: Invalid permissions or table not found. ` +
            `Attempted table ID: "${tableId}". ` +
            `Please verify: (1) The table ID is correct in config/airtable.ts, ` +
            `(2) The API key has access to this table, (3) The table exists in base ${this.baseId.substring(0, 8)}...`;
        }

        const error: any = {
          message: errorMessage,
          code: 'AIRTABLE_ERROR',
          status: response.status,
          details: {
            ...errorData,
            tableId: tableId,
            endpoint: endpoint,
          },
        };

        // Log detailed error in dev mode
        if (import.meta.env.DEV) {
          console.error('[AirtableClient] API Error:', {
            status: response.status,
            tableId: tableId,
            endpoint: endpoint,
            errorMessage: errorMessage,
            errorDetails: errorData,
          });
        }

        throw error;
      }

      return response.json() as Promise<T>;
    };

    return withRetry(makeRequest);
  }

  /**
   * Get records from a table
   */
  async getRecords<T = any>(
    tableId: string,
    options: {
      filterByFormula?: string;
      sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
      pageSize?: number;
      maxRecords?: number;
    } = {}
  ): Promise<Array<{ id: string; fields: T }>> {
    const params = new URLSearchParams();
    
    if (options.filterByFormula) {
      params.append('filterByFormula', options.filterByFormula);
    }
    
    if (options.pageSize) {
      params.append('pageSize', String(options.pageSize));
    }
    
    if (options.maxRecords) {
      params.append('maxRecords', String(options.maxRecords));
    }

    if (options.sort) {
      options.sort.forEach((sort, index) => {
        params.append(`sort[${index}][field]`, sort.field);
        params.append(`sort[${index}][direction]`, sort.direction);
      });
    }

    const endpoint = `/${tableId}${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await this.request<{ records: Array<{ id: string; fields: T }> }>(endpoint);
    
    return response.records;
  }

  /**
   * Get a single record by ID
   */
  async getRecord<T = any>(tableId: string, recordId: string): Promise<{ id: string; fields: T }> {
    const response = await this.request<{ id: string; fields: T }>(`/${tableId}/${recordId}`);
    return response;
  }

  /**
   * Create a record
   * @param typecast - If true, allows Airtable to automatically add new options to Single Select fields
   */
  async createRecord<T = any>(
    tableId: string,
    fields: T,
    options?: { typecast?: boolean }
  ): Promise<{ id: string; fields: T }> {
    this.ensureConfigured();
    
    // Sanitize fields: remove read-only/computed fields like "id", "createdTime"
    if (import.meta.env.DEV) {
      console.log(`[AirtableClient.createRecord] BEFORE sanitization - Fields received:`, Object.keys(fields));
      if ('id' in fields) {
        console.error(`[AirtableClient.createRecord] ERROR: Field "id" found in input fields!`, fields);
      }
    }
    
    const sanitizedFields = sanitizeFields(fields);
    
    // Runtime assertion: ensure "id" is not present
    if ('id' in sanitizedFields) {
      console.error(`[AirtableClient.createRecord] CRITICAL: Field "id" still present after sanitization!`, {
        originalFields: Object.keys(fields),
        sanitizedFields: Object.keys(sanitizedFields),
        idValue: sanitizedFields.id,
      });
      throw new Error('CRITICAL: Field "id" is still present after sanitization. This should never happen.');
    }
    
    if (import.meta.env.DEV) {
      console.log(`[AirtableClient.createRecord] Creating record in table ${tableId}`);
      console.log(`[AirtableClient.createRecord] Fields being sent:`, Object.keys(sanitizedFields));
      console.log(`[AirtableClient.createRecord] Full payload:`, JSON.stringify({ fields: sanitizedFields }, null, 2));
    }
    
    const body: any = { fields: sanitizedFields };
    if (options?.typecast) {
      body.typecast = true;
    }
    const response = await this.request<{ id: string; fields: T }>(
      `/${tableId}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
    return response;
  }

  /**
   * Update a record
   * @param typecast - If true, allows Airtable to automatically add new options to Single Select fields
   */
  async updateRecord<T = any>(
    tableId: string,
    recordId: string,
    fields: Partial<T>,
    options?: { typecast?: boolean }
  ): Promise<{ id: string; fields: T }> {
    this.ensureConfigured();
    
    // Sanitize fields: remove read-only/computed fields like "id", "createdTime"
    if (import.meta.env.DEV) {
      console.log(`[AirtableClient.updateRecord] BEFORE sanitization - Fields received:`, Object.keys(fields));
      if ('id' in fields) {
        console.error(`[AirtableClient.updateRecord] ERROR: Field "id" found in input fields!`, fields);
      }
    }
    
    const sanitizedFields = sanitizeFields(fields);
    
    // Runtime assertion: ensure "id" is not present
    if ('id' in sanitizedFields) {
      console.error(`[AirtableClient.updateRecord] CRITICAL: Field "id" still present after sanitization!`, {
        originalFields: Object.keys(fields),
        sanitizedFields: Object.keys(sanitizedFields),
        idValue: sanitizedFields.id,
      });
      throw new Error('CRITICAL: Field "id" is still present after sanitization. This should never happen.');
    }
    
    if (import.meta.env.DEV) {
      console.log(`[AirtableClient.updateRecord] Updating record ${recordId} in table ${tableId}`);
      console.log(`[AirtableClient.updateRecord] Fields being sent:`, Object.keys(sanitizedFields));
      console.log(`[AirtableClient.updateRecord] Full payload:`, JSON.stringify({ fields: sanitizedFields }, null, 2));
    }
    
    const body: any = { fields: sanitizedFields };
    if (options?.typecast) {
      body.typecast = true;
    }
    const response = await this.request<{ id: string; fields: T }>(
      `/${tableId}/${recordId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    );
    return response;
  }

  /**
   * Find a record by a field value (returns first match)
   */
  async findRecordByField<T = any>(
    tableId: string,
    fieldName: string,
    fieldValue: string
  ): Promise<{ id: string; fields: T } | null> {
    const filterFormula = `{${fieldName}} = "${fieldValue}"`;
    const records = await this.getRecords<T>(tableId, {
      filterByFormula: filterFormula,
      maxRecords: 1,
    });
    
    return records.length > 0 ? records[0] : null;
  }

  /**
   * Delete a record
   */
  async deleteRecord(tableId: string, recordId: string): Promise<void> {
    await this.request<{ id: string; deleted: boolean }>(
      `/${tableId}/${recordId}`,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * Get table configuration
   */
  getTableId(tableName: keyof typeof AIRTABLE_CONFIG.tables): string {
    return AIRTABLE_CONFIG.tables[tableName];
  }
}

// Export singleton instance
// Note: This is created at module load time, matching the original behavior
// The constructor will throw if env vars are missing, which is the expected behavior
export const airtableClient = new AirtableClient();
