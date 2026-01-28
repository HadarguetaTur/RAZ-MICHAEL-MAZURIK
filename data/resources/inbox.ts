/**
 * Admin Inbox resource — all calls go to server /api/inbox (no Airtable key in frontend).
 */

const INBOX_BASE = '/api/inbox';

async function inboxFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url =
    path.startsWith('?') ? INBOX_BASE + path
    : path ? INBOX_BASE + '/' + path.replace(/^\//, '')
    : INBOX_BASE;
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
}

export interface AdminInboxItem {
  id: string;
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
  createdTime?: string;
}

export interface GetInboxParams {
  category?: string;
  status?: 'openOnly' | 'all' | 'closed';
  includeSnoozed?: boolean;
  search?: string;
  pageSize?: number;
  offset?: string;
}

export interface GetInboxResult {
  items: AdminInboxItem[];
  nextOffset?: string;
  countsByCategory?: Record<string, number>;
}

export async function getInboxItems(params: GetInboxParams = {}): Promise<GetInboxResult> {
  const q = new URLSearchParams();
  if (params.category) q.set('category', params.category);
  if (params.status) q.set('status', params.status);
  if (params.includeSnoozed !== undefined) q.set('includeSnoozed', String(params.includeSnoozed));
  if (params.search) q.set('search', params.search);
  if (params.pageSize != null) q.set('pageSize', String(params.pageSize));
  if (params.offset) q.set('offset', params.offset);
  const path = q.toString() ? '?' + q.toString() : '';
  try {
    const res = await inboxFetch(path);
    if (!res.ok) {
      const body = await res.text();
      let msg = body;
      try {
        const j = JSON.parse(body) as { error?: string };
        msg = j.error || body;
      } catch {
        //
      }
      throw new Error(msg || `Inbox API ${res.status}`);
    }
    return res.json() as Promise<GetInboxResult>;
  } catch (err) {
    throw err;
  }
}

export async function closeInboxItem(recordId: string): Promise<AdminInboxItem> {
  const res = await inboxFetch(`${recordId}/close`, { method: 'POST' });
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      const j = JSON.parse(t) as { error?: string };
      msg = j.error || t;
    } catch {
      //
    }
    throw new Error(msg || `Close failed ${res.status}`);
  }
  const data = (await res.json()) as { id: string; fields: Record<string, unknown> };
  return { id: data.id, inbox_key: '', ...(data.fields as Record<string, unknown>) } as AdminInboxItem;
}

export async function snoozeInboxItem(recordId: string, until: string): Promise<AdminInboxItem> {
  const res = await inboxFetch(`${recordId}/snooze`, {
    method: 'POST',
    body: JSON.stringify({ until }),
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      const j = JSON.parse(t) as { error?: string };
      msg = j.error || t;
    } catch {
      //
    }
    throw new Error(msg || `Snooze failed ${res.status}`);
  }
  const data = (await res.json()) as { id: string; fields: Record<string, unknown> };
  return { id: data.id, inbox_key: '', ...(data.fields as Record<string, unknown>) } as AdminInboxItem;
}

export async function updateInboxItem(
  recordId: string,
  patch: Partial<Pick<AdminInboxItem, 'status' | 'title' | 'details' | 'priority' | 'due_at'>>
): Promise<AdminInboxItem> {
  const res = await inboxFetch(recordId, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      const j = JSON.parse(t) as { error?: string };
      msg = j.error || t;
    } catch {
      //
    }
    throw new Error(msg || `Update failed ${res.status}`);
  }
  const data = (await res.json()) as { id: string; fields: Record<string, unknown> };
  return { id: data.id, inbox_key: '', ...(data.fields as Record<string, unknown>) } as AdminInboxItem;
}

/** Event payloads for POST /api/inbox/events — use after domain actions (e.g. late cancel requested). */
export type InboxEventPayload =
  | {
      event: 'late_cancel';
      lessonId: string;
      studentId: string;
      lessonDateTime: string;
      hoursUntil: number;
      studentName?: string;
    }
  | {
      event: 'waitlist';
      waitlistId: string;
      teacherId?: string;
      date?: string;
      slotId?: string;
      studentId?: string;
      studentName?: string;
    }
  | { event: 'system_error'; signature: string; message: string; source?: string; code?: string }
  | {
      event: 'payment_overdue';
      studentId: string;
      billingMonth: string;
      amount?: number;
      studentName?: string;
    };

export async function reportInboxEvent(payload: InboxEventPayload): Promise<{ id: string }> {
  const res = await inboxFetch('events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try {
      const j = JSON.parse(t) as { error?: string };
      msg = j.error || t;
    } catch {
      //
    }
    throw new Error(msg || `Report event failed ${res.status}`);
  }
  const data = (await res.json()) as { id: string };
  return { id: data.id };
}
