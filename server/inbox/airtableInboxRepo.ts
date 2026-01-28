/**
 * Airtable-backed repository for Admin Inbox (server-only).
 * Single source of truth: Airtable table admin_inbox.
 * Uses process.env.AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_INBOX_TABLE.
 */

import {
  AirtableError,
  DuplicateInboxKeyError,
  ValidationError,
} from './domainErrors';

const API_BASE = 'https://api.airtable.com/v0';
const BACKOFF_MS = 800;
const RETRY_ON_STATUSES = [429, 500, 502, 503];

function env(name: string): string {
  const v =
    process.env[name] ??
    process.env[name.replace('AIRTABLE_', 'VITE_AIRTABLE_')] ??
    '';
  return String(v).trim();
}

function getBaseId(): string {
  return env('AIRTABLE_BASE_ID') || env('VITE_AIRTABLE_BASE_ID') || '';
}

function getToken(): string {
  return env('AIRTABLE_API_KEY') || env('VITE_AIRTABLE_API_KEY') || '';
}

function getTableId(): string {
  return env('AIRTABLE_ADMIN_INBOX_TABLE') || '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeFormula(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

export interface AirtableInboxFields {
  inbox_key: string;
  category?: string;
  type?: string;
  title?: string;
  status?: string;
  closed_at?: string;
  snooze_until?: string;
  due_at?: string;
  details?: string;
  priority?: string;
  [k: string]: unknown;
}

export interface InboxRecord {
  id: string;
  fields: AirtableInboxFields;
}

export interface NormalizedAirtableError {
  statusCode: number;
  message: string;
  airtableError?: unknown;
}

/**
 * Uniform wrapper for Airtable REST calls.
 * - One retry on 429/5xx with short backoff.
 * - Normalized errors: statusCode, message, airtableError.
 */
export async function airtableRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const baseId = getBaseId();
  const token = getToken();
  if (!baseId || !token) {
    throw new AirtableError(
      'Airtable not configured. Set AIRTABLE_BASE_ID and AIRTABLE_API_KEY.',
      undefined,
      undefined
    );
  }

  const url = `${API_BASE}/${encodeURIComponent(baseId)}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body != null && (method === 'POST' || method === 'PATCH')) {
    opts.body = JSON.stringify(body);
  }

  const doReq = async (): Promise<T> => {
    const res = await fetch(url, opts);
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: text };
    }

    if (!res.ok) {
      const err: NormalizedAirtableError = {
        statusCode: res.status,
        message:
          (parsed.error as { message?: string })?.message ||
          (typeof parsed.error === 'string' ? parsed.error : text.slice(0, 200)),
        airtableError: parsed,
      };
      throw new AirtableError(err.message, err.statusCode, err.airtableError);
    }

    return parsed as T;
  };

  try {
    return await doReq();
  } catch (e) {
    const status =
      e instanceof AirtableError ? e.statusCode : (e as { statusCode?: number })?.statusCode;
    if (status && RETRY_ON_STATUSES.includes(status)) {
      await sleep(BACKOFF_MS);
      return doReq();
    }
    throw e;
  }
}

/**
 * Find one inbox record by inbox_key.
 * Throws DuplicateInboxKeyError if more than one record exists.
 */
export async function findInboxItemByKey(inboxKey: string): Promise<InboxRecord | null> {
  const tableId = getTableId();
  if (!tableId) {
    throw new ValidationError(
      'AIRTABLE_ADMIN_INBOX_TABLE is not set. Use the Airtable table ID (e.g. tblXXX).'
    );
  }

  const formula = `{inbox_key} = '${escapeFormula(inboxKey)}'`;
  const path = `/${tableId}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=10`;
  const res = await airtableRequest<{ records: Array<{ id: string; fields: Record<string, unknown> }> }>(
    'GET',
    path
  );

  const records = res.records ?? [];
  if (records.length > 1) {
    throw new DuplicateInboxKeyError(
      `Duplicate inbox_key: "${inboxKey}". Multiple records found.`,
      inboxKey,
      records.map((r) => r.id)
    );
  }
  if (records.length === 0) return null;
  return {
    id: records[0].id,
    fields: records[0].fields as AirtableInboxFields,
  };
}

/**
 * UPSERT by inbox_key: update if exists, create if not.
 * Never creates duplicates for the same inbox_key.
 */
export async function upsertInboxItemByKey(
  payload: AirtableInboxFields & { inbox_key: string }
): Promise<{ id: string; fields: AirtableInboxFields }> {
  const tableId = getTableId();
  if (!tableId) {
    throw new ValidationError(
      'AIRTABLE_ADMIN_INBOX_TABLE is not set. Use the Airtable table ID (e.g. tblXXX).'
    );
  }
  if (!payload.inbox_key || typeof payload.inbox_key !== 'string') {
    throw new ValidationError('inbox_key is required and must be a string.', 'inbox_key');
  }

  const existing = await findInboxItemByKey(payload.inbox_key);
  const fields = { ...payload } as Record<string, unknown>;

  if (existing) {
    const out = await airtableRequest<{ id: string; fields: AirtableInboxFields }>(
      'PATCH',
      `/${tableId}/${existing.id}`,
      { fields }
    );
    return { id: out.id, fields: out.fields ?? (existing.fields as AirtableInboxFields) };
  }

  const created = await airtableRequest<{ id: string; fields: AirtableInboxFields }>(
    'POST',
    `/${tableId}`,
    { fields }
  );
  return { id: created.id, fields: created.fields ?? (fields as AirtableInboxFields) };
}

/**
 * Update specific fields of an inbox record.
 */
export async function updateInboxItem(
  recordId: string,
  patch: Partial<AirtableInboxFields>
): Promise<{ id: string; fields: AirtableInboxFields }> {
  const tableId = getTableId();
  if (!tableId) {
    throw new ValidationError('AIRTABLE_ADMIN_INBOX_TABLE is not set.');
  }

  const res = await airtableRequest<{ id: string; fields: AirtableInboxFields }>(
    'PATCH',
    `/${tableId}/${encodeURIComponent(recordId)}`,
    { fields: patch as Record<string, unknown> }
  );
  return { id: res.id, fields: res.fields ?? (patch as AirtableInboxFields) };
}

/**
 * Close an inbox item: status='נסגר', closed_at=now.
 */
export async function closeInboxItem(recordId: string): Promise<{ id: string; fields: AirtableInboxFields }> {
  const now = new Date().toISOString();
  return updateInboxItem(recordId, { status: 'נסגר', closed_at: now });
}

/**
 * Snooze until a given datetime (ISO string).
 */
export async function snoozeInboxItem(
  recordId: string,
  until: string
): Promise<{ id: string; fields: AirtableInboxFields }> {
  return updateInboxItem(recordId, { snooze_until: until });
}

export interface ListInboxParams {
  category?: string;
  status?: 'openOnly' | 'all' | 'closed';
  includeSnoozed?: boolean;
  search?: string;
  pageSize?: number;
  offset?: string;
}

export interface ListInboxResult {
  items: InboxRecord[];
  nextOffset?: string;
}

/**
 * List inbox records with optional filters and pagination.
 */
export async function listInboxItems(params: ListInboxParams = {}): Promise<ListInboxResult> {
  const tableId = getTableId();
  if (!tableId) {
    throw new ValidationError('AIRTABLE_ADMIN_INBOX_TABLE is not set.');
  }

  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 200);
  const parts: string[] = [];

  if (params.status === 'openOnly' || !params.status) {
    parts.push(`OR({status} = '', {status} != 'נסגר')`);
  } else if (params.status === 'closed') {
    parts.push(`{status} = 'נסגר'`);
  }

  if (params.includeSnoozed !== true) {
    parts.push(
      `OR({snooze_until} = '', IS_AFTER(NOW(), {snooze_until}))`
    );
  }

  if (params.category) {
    parts.push(`{category} = '${escapeFormula(params.category)}'`);
  }

  if (params.search && params.search.trim()) {
    const q = escapeFormula(params.search.trim());
    parts.push(`FIND('${q}', {title} & ' ' & {details}) > 0`);
  }

  const formula = parts.length ? `AND(${parts.join(', ')})` : '';
  const searchParams = new URLSearchParams();
  searchParams.set('pageSize', String(pageSize));
  if (formula) searchParams.set('filterByFormula', formula);
  if (params.offset) searchParams.set('offset', params.offset);
  searchParams.set('sort[0][field]', 'createdTime');
  searchParams.set('sort[0][direction]', 'desc');

  const path = `/${tableId}?${searchParams.toString()}`;
  const res = await airtableRequest<{
    records: Array<{ id: string; fields: Record<string, unknown> }>;
    offset?: string;
  }>('GET', path);

  const records = (res.records ?? []).map((r) => ({
    id: r.id,
    fields: r.fields as AirtableInboxFields,
  }));

  return {
    items: records,
    nextOffset: res.offset ?? undefined,
  };
}
