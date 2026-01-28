/**
 * Domain errors for Admin Inbox (server-only).
 */

export class AirtableError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly airtableError?: unknown
  ) {
    super(message);
    this.name = 'AirtableError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DuplicateInboxKeyError extends Error {
  constructor(
    message: string,
    public readonly inboxKey: string,
    public readonly recordIds?: string[]
  ) {
    super(message);
    this.name = 'DuplicateInboxKeyError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string, public readonly identifier?: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
