/**
 * AirtableClient - Data Access Layer with retry/backoff
 * Single point of access for all Airtable operations
 */

import { AIRTABLE_CONFIG } from '../config/airtable';
import { getAuthToken, notifyAuthExpired } from '../hooks/useAuth';
import { apiUrl } from '../config/api';

const PROXY_BASE_URL = '/api/airtable';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // Start with 1 second

/**
 * Sleep utility for backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
  private isConfigured: boolean;

  constructor() {
    this.isConfigured = true; // Always configured when using proxy
  }

  /**
   * Check if user is authenticated and throw a clear error if not
   */
  private ensureConfigured(): void {
    const token = getAuthToken();
    if (!token) {
      throw {
        message: 'Authentication required. Please log in.',
        code: 'AUTH_REQUIRED',
        status: 401,
      };
    }
  }

  /**
   * Make a request to Airtable API via backend proxy with retry/backoff
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Fail gracefully if not authenticated
    this.ensureConfigured();
    const token = getAuthToken();
    
    // Encode table IDs for safety
    const [tablePath, queryString] = endpoint.split('?');
    const pathParts = tablePath.split('/');
    if (pathParts.length > 1 && pathParts[1]) {
      pathParts[1] = encodeURIComponent(pathParts[1]);
    }
    const encodedPath = pathParts.join('/');
    const encodedEndpoint = queryString ? `${encodedPath}?${queryString}` : encodedPath;

    const url = apiUrl(`${PROXY_BASE_URL}${encodedEndpoint}`);


    const makeRequest = async (): Promise<T> => {
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
          notifyAuthExpired();
          throw {
            message: 'Session expired. Please log in again.',
            code: 'AUTH_EXPIRED',
            status: 401,
          };
        }

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

        let errorMessage = errorData.error?.message || `API error: ${response.statusText}`;
        if (response.status === 403) {
          errorMessage = `Forbidden: Table "${tableId}" — check API permissions.`;
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
   * Get records from a table (alias for listRecords for backward compatibility)
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
    return this.listRecords<T>(tableId, options);
  }

  /**
   * List records from a table with pagination support
   */
  async listRecords<T = any>(
    tableId: string,
    options: {
      filterByFormula?: string;
      sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
      pageSize?: number;
      maxRecords?: number;
    } = {}
  ): Promise<Array<{ id: string; fields: T }>> {
    const allRecords: Array<{ id: string; fields: T }> = [];
    let offset: string | undefined;

    do {
      const params = new URLSearchParams();
      
      if (options.filterByFormula) {
        params.append('filterByFormula', options.filterByFormula);
      }
      
      if (options.pageSize) {
        params.append('pageSize', String(options.pageSize));
      } else {
        params.append('pageSize', '100'); // Default to 100
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

      if (offset) {
        params.append('offset', offset);
      }

      const endpoint = `/${tableId}${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await this.request<{ records: Array<{ id: string; fields: T }>; offset?: string }>(endpoint);
      
      allRecords.push(...response.records);
      offset = response.offset;

      // Stop if we've reached maxRecords
      if (options.maxRecords && allRecords.length >= options.maxRecords) {
        break;
      }
    } while (offset);

    return allRecords;
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
    const filterFormula = `{${fieldName}} = "${escapeFormulaString(fieldValue)}"`;
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
// Note: This is created at module load time. Auth check happens per-request, not at construction time.
export const airtableClient = new AirtableClient();
