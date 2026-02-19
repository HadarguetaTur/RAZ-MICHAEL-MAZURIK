/**
 * Enhanced AirtableClient with CRUD, pagination, filtering, and retry/backoff
 */

import { AIRTABLE_CONFIG } from '../config/airtable';
import { AirtableError } from './domainErrors';

const API_BASE_URL = 'https://api.airtable.com/v0';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// Environment variable access — server-side only, never expose to frontend
const getApiKey = () => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.AIRTABLE_API_KEY || '';
  }
  return '';
};

const getBaseId = () => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.AIRTABLE_BASE_ID || '';
  }
  return '';
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

    if (retries <= 0) {
      throw error;
    }

    await sleep(backoffMs);
    return withRetry(fn, retries - 1, backoffMs * 2);
  }
}

export interface AirtableRecord<T = any> {
  id: string;
  fields: T;
  createdTime?: string;
}

export interface ListRecordsOptions {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  pageSize?: number;
  maxRecords?: number;
  view?: string;
}

export interface ListRecordsResponse<T = any> {
  records: AirtableRecord<T>[];
  offset?: string;
}

/**
 * Enhanced AirtableClient with full CRUD and pagination support
 */
export class AirtableClient {
  private apiKey: string;
  private baseId: string;

  constructor(apiKey?: string, baseId?: string) {
    this.apiKey = apiKey || getApiKey();
    this.baseId = baseId || getBaseId();

    if (!this.apiKey || !this.baseId) {
      throw new Error('Airtable API Key or Base ID not configured');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
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

        throw new AirtableError(
          errorData.error?.message || `Airtable API error: ${response.statusText}`,
          response.status,
          errorData
        );
      }

      return response.json() as Promise<T>;
    };

    return withRetry(makeRequest);
  }

  /**
   * List records with pagination support
   */
  async listRecords<T = any>(
    tableId: string,
    options: ListRecordsOptions = {}
  ): Promise<AirtableRecord<T>[]> {
    const allRecords: AirtableRecord<T>[] = [];
    let offset: string | undefined;

    do {
      const params = new URLSearchParams();
      
      if (options.filterByFormula) {
        params.append('filterByFormula', options.filterByFormula);
      }
      
      if (options.pageSize) {
        params.append('pageSize', String(options.pageSize));
      } else {
        params.append('pageSize', '100'); // Default page size
      }
      
      if (options.maxRecords) {
        params.append('maxRecords', String(options.maxRecords));
      }

      if (options.view) {
        params.append('view', options.view);
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
      const response = await this.request<ListRecordsResponse<T>>(endpoint);
      
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
  async getRecord<T = any>(tableId: string, recordId: string): Promise<AirtableRecord<T>> {
    const response = await this.request<AirtableRecord<T>>(`/${tableId}/${recordId}`);
    return response;
  }

  /**
   * Create a record
   */
  async createRecord<T = any>(
    tableId: string,
    fields: T
  ): Promise<AirtableRecord<T>> {
    const response = await this.request<AirtableRecord<T>>(
      `/${tableId}`,
      {
        method: 'POST',
        body: JSON.stringify({ fields }),
      }
    );
    return response;
  }

  /**
   * Update a record
   */
  async updateRecord<T = any>(
    tableId: string,
    recordId: string,
    fields: Partial<T>
  ): Promise<AirtableRecord<T>> {
    const response = await this.request<AirtableRecord<T>>(
      `/${tableId}/${recordId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fields }),
      }
    );
    return response;
  }

  /**
   * Delete a record
   */
  async deleteRecord(tableId: string, recordId: string): Promise<{ id: string; deleted: boolean }> {
    const response = await this.request<{ id: string; deleted: boolean }>(
      `/${tableId}/${recordId}`,
      {
        method: 'DELETE',
      }
    );
    return response;
  }

  /**
   * Find records by a field value
   */
  async findRecordsByField<T = any>(
    tableId: string,
    fieldName: string,
    fieldValue: string | number | boolean
  ): Promise<AirtableRecord<T>[]> {
    // Escape quotes in fieldValue for formula
    const escapedValue = typeof fieldValue === 'string' 
      ? `"${fieldValue.replace(/"/g, '\\"')}"`
      : String(fieldValue);
    
    const filterFormula = `{${fieldName}} = ${escapedValue}`;
    return this.listRecords<T>(tableId, { filterByFormula: filterFormula });
  }

  /**
   * Get table ID by name
   */
  getTableId(tableName: keyof typeof AIRTABLE_CONFIG.tables): string {
    return AIRTABLE_CONFIG.tables[tableName];
  }
}

// Export singleton instance
export const airtableClient = new AirtableClient();
