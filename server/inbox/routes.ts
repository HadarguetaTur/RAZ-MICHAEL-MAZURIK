/**
 * Inbox REST route handlers (server-only).
 * Consumed by the main API server (conflictsCheckServer or apiServer).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listInboxItems,
  upsertInboxItemByKey,
  updateInboxItem,
  closeInboxItem,
  snoozeInboxItem,
  type AirtableInboxFields,
  type ListInboxParams,
} from './airtableInboxRepo';
import {
  AirtableError,
  DuplicateInboxKeyError,
  ValidationError,
} from './domainErrors';
import { buildInboxPayloadFromEvent, type InboxEventPayload } from './inboxEvents';

export type AdminInboxItem = {
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
};

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? (JSON.parse(b) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url: string): Record<string, string> {
  const i = url.indexOf('?');
  if (i === -1) return {};
  const q: Record<string, string> = {};
  new URLSearchParams(url.slice(i)).forEach((v, k) => (q[k] = v));
  return q;
}

function toItem(r: { id: string; fields: AirtableInboxFields }): AdminInboxItem {
  const f = r.fields;
  return {
    id: r.id,
    inbox_key: f.inbox_key ?? '',
    category: f.category,
    type: f.type,
    title: f.title,
    status: f.status,
    closed_at: f.closed_at,
    snooze_until: f.snooze_until,
    due_at: f.due_at,
    details: f.details,
    priority: f.priority,
  };
}

export async function handleGetInbox(
  req: IncomingMessage,
  res: ServerResponse,
  url: string
): Promise<boolean> {
  if (req.method !== 'GET' || !url.startsWith('/api/inbox')) return false;
  const path = url.slice('/api/inbox'.length).replace(/\?.*$/, '') || '/';
  if (path !== '/' && path !== '') return false; // only GET /api/inbox

  const q = parseQuery(url);
  const params: ListInboxParams = {
    category: q.category || undefined,
    status: (q.status as ListInboxParams['status']) || 'openOnly',
    includeSnoozed: q.includeSnoozed === 'true',
    search: q.search || undefined,
    pageSize: q.pageSize ? parseInt(q.pageSize, 10) : 50,
    offset: q.offset || undefined,
  };

  try {
    const result = await listInboxItems(params);
    const items = result.items.map((r) => toItem(r));
    send(res, 200, {
      items,
      nextOffset: result.nextOffset,
      countsByCategory: undefined, // MVP: client can derive from items
    });
  } catch (e) {
    if (e instanceof ValidationError) {
      send(res, 400, { error: e.message });
      return true;
    }
    if (e instanceof AirtableError) {
      send(res, e.statusCode ?? 502, { error: e.message });
      return true;
    }
    send(res, 500, { error: (e as Error).message });
  }
  return true;
}

export async function handlePostInbox(
  req: IncomingMessage,
  res: ServerResponse,
  url: string
): Promise<boolean> {
  if (req.method !== 'POST' || !url.startsWith('/api/inbox')) return false;
  const path = url.slice('/api/inbox'.length).replace(/^\//, '') || '';

  if (path === '' || path === 'upsert' || path === 'events') {
    const body = await parseBody(req);
    if (path === 'events') {
      const ev = body as InboxEventPayload;
      if (!ev.event) {
        send(res, 400, { error: 'event is required (late_cancel|waitlist|system_error|payment_overdue)' });
        return true;
      }
      try {
        const payload = buildInboxPayloadFromEvent(ev);
        const out = await upsertInboxItemByKey(payload);
        send(res, 200, { id: out.id, fields: out.fields });
      } catch (e) {
        if (e instanceof ValidationError) {
          send(res, 400, { error: (e as Error).message });
          return true;
        }
        if (e instanceof DuplicateInboxKeyError) {
          send(res, 409, { error: (e as Error).message });
          return true;
        }
        if (e instanceof AirtableError) {
          send(res, e.statusCode ?? 502, { error: (e as Error).message });
          return true;
        }
        send(res, 500, { error: (e as Error).message });
      }
      return true;
    }
    if (path === 'upsert') {
      const payload = body as AirtableInboxFields & { inbox_key?: string };
      if (!payload.inbox_key) {
        send(res, 400, { error: 'inbox_key is required for upsert' });
        return true;
      }
      try {
        const out = await upsertInboxItemByKey(payload as AirtableInboxFields & { inbox_key: string });
        send(res, 200, { id: out.id, fields: out.fields });
      } catch (e) {
        if (e instanceof ValidationError) {
          send(res, 400, { error: e.message });
          return true;
        }
        if (e instanceof DuplicateInboxKeyError) {
          send(res, 409, { error: e.message });
          return true;
        }
        if (e instanceof AirtableError) {
          send(res, e.statusCode ?? 502, { error: e.message });
          return true;
        }
        send(res, 500, { error: (e as Error).message });
      }
      return true;
    }

    // POST /api/inbox — manual task
    const inboxKey =
      (body.inbox_key as string) || `manual_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const payload: AirtableInboxFields & { inbox_key: string } = {
      inbox_key: inboxKey,
      category: (body.category as string) || 'כללי',
      type: (body.type as string) || 'manual_task',
      title: (body.title as string) || 'משימה ידנית',
      status: (body.status as string) || 'פתוח',
    };
    if (body.details != null) payload.details = String(body.details);
    if (body.priority != null) payload.priority = String(body.priority);
    if (body.due_at != null) payload.due_at = String(body.due_at);

    try {
      const out = await upsertInboxItemByKey(payload);
      send(res, 201, { id: out.id, fields: out.fields });
    } catch (e) {
      if (e instanceof ValidationError) {
        send(res, 400, { error: e.message });
        return true;
      }
      if (e instanceof AirtableError) {
        send(res, e.statusCode ?? 502, { error: e.message });
        return true;
      }
      send(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  return false;
}

export async function handlePatchInbox(
  req: IncomingMessage,
  res: ServerResponse,
  url: string
): Promise<boolean> {
  if (req.method !== 'PATCH' || !url.startsWith('/api/inbox/')) return false;
  const after = url.slice('/api/inbox/'.length);
  const id = after.split('/')[0];
  const sub = after.slice(id.length).replace(/^\//, '');
  if (sub && sub !== 'close' && sub !== 'snooze') return false;
  if (!id) {
    send(res, 400, { error: 'Record id required' });
    return true;
  }

  if (sub === 'close') return false; // handled by POST
  if (sub === 'snooze') return false; // handled by POST

  const body = await parseBody(req);
  const patch: Partial<AirtableInboxFields> = {};
  if (body.status != null) patch.status = String(body.status);
  if (body.title != null) patch.title = String(body.title);
  if (body.details != null) patch.details = String(body.details);
  if (body.priority != null) patch.priority = String(body.priority);
  if (body.due_at != null) patch.due_at = String(body.due_at);

  try {
    const out = await updateInboxItem(id, patch);
    send(res, 200, { id: out.id, fields: out.fields });
  } catch (e) {
    if (e instanceof ValidationError) {
      send(res, 400, { error: e.message });
      return true;
    }
    if (e instanceof AirtableError) {
      send(res, e.statusCode ?? 502, { error: e.message });
      return true;
    }
    send(res, 500, { error: (e as Error).message });
  }
  return true;
}

export async function handlePostInboxIdAction(
  req: IncomingMessage,
  res: ServerResponse,
  url: string
): Promise<boolean> {
  if (req.method !== 'POST' || !url.startsWith('/api/inbox/')) return false;
  const after = url.slice('/api/inbox/'.length);
  const parts = after.split('/').filter(Boolean);
  const id = parts[0];
  const action = parts[1];
  if (!id || !action) return false;

  if (action === 'close') {
    try {
      const out = await closeInboxItem(id);
      send(res, 200, { id: out.id, fields: out.fields });
    } catch (e) {
      if (e instanceof AirtableError) {
        send(res, e.statusCode ?? 502, { error: e.message });
        return true;
      }
      send(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  if (action === 'snooze') {
    const body = await parseBody(req);
    const until = (body.until as string) || '';
    if (!until) {
      send(res, 400, { error: 'until (ISO datetime) is required' });
      return true;
    }
    try {
      const out = await snoozeInboxItem(id, until);
      send(res, 200, { id: out.id, fields: out.fields });
    } catch (e) {
      if (e instanceof AirtableError) {
        send(res, e.statusCode ?? 502, { error: e.message });
        return true;
      }
      send(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  return false;
}
