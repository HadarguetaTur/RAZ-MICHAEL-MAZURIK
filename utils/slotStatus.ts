export type SlotStatus = 'open' | 'closed' | 'canceled' | 'blocked';

const TO_INTERNAL: Record<string, SlotStatus> = {
  'פתוח': 'open',
  'open': 'open',
  'סגור': 'closed',
  'closed': 'closed',
  'booked': 'closed',
  'מבוטל': 'canceled',
  'canceled': 'canceled',
  'חסום ע"י מנהל': 'blocked',
  'חסום': 'blocked',
  'blocked': 'blocked',
};

const TO_AIRTABLE: Record<SlotStatus, string> = {
  open: 'פתוח',
  closed: 'סגור',
  canceled: 'מבוטל',
  blocked: 'חסום ע"י מנהל',
};

/**
 * Normalize any Hebrew/English status string to the internal SlotStatus enum.
 * Unknown values default to 'open'.
 */
export function normalizeSlotStatus(raw: unknown): SlotStatus {
  if (raw == null) return 'open';
  const trimmed = String(raw).trim();
  return TO_INTERNAL[trimmed] ?? 'open';
}

/**
 * Convert an internal SlotStatus back to the Hebrew Airtable value.
 * Also handles the case where the value is already in Hebrew.
 */
export function slotStatusToAirtable(status: string): string {
  const normalized = normalizeSlotStatus(status);
  return TO_AIRTABLE[normalized];
}
