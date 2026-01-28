/**
 * WhatsApp Utilities
 * Functions for opening WhatsApp with prefilled messages
 */

/**
 * Normalize phone number to E.164 format (+972...)
 * Handles Israeli phone numbers:
 * - Removes leading 0
 * - Removes spaces, dashes, parentheses
 * - Adds +972 country code if missing
 * - Returns null if phone is invalid/empty
 */
export function normalizePhoneToE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If empty after cleaning, return null
  if (!cleaned || cleaned.length === 0) return null;
  
  // Handle Israeli numbers
  // If starts with +972, use as-is
  if (cleaned.startsWith('+972')) {
    return cleaned;
  }
  
  // If starts with 972 (without +), add +
  if (cleaned.startsWith('972')) {
    return '+' + cleaned;
  }
  
  // If starts with 0, remove it and add +972
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
    return '+972' + cleaned;
  }
  
  // If starts with 5 (Israeli mobile), add +972
  if (cleaned.startsWith('5') && cleaned.length === 9) {
    return '+972' + cleaned;
  }
  
  // If it's 9 digits and starts with 5, assume Israeli mobile
  if (cleaned.length === 9 && cleaned.startsWith('5')) {
    return '+972' + cleaned;
  }
  
  // If it's 10 digits and starts with 0, remove 0 and add +972
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return '+972' + cleaned.substring(1);
  }
  
  // If already in E.164 format (starts with +), return as-is
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  // Default: assume it's an Israeli number without country code
  // If it's 9 digits starting with 5, add +972
  if (cleaned.length === 9 && cleaned.startsWith('5')) {
    return '+972' + cleaned;
  }
  
  // If it's 10 digits, assume it starts with 0 and remove it
  if (cleaned.length === 10) {
    return '+972' + cleaned.substring(1);
  }
  
  // If we can't determine, return null
  return null;
}

/**
 * Open WhatsApp chat with prefilled message
 * Uses wa.me or api.whatsapp.com/send with encoded text
 * 
 * @param phoneE164 Phone number in E.164 format (e.g., +972501234567)
 * @param text Prefilled message text (will be URL-encoded)
 */
export function openWhatsApp(phoneE164: string, text: string): void {
  if (!phoneE164 || !phoneE164.startsWith('+')) {
    throw new Error('Phone number must be in E.164 format (e.g., +972501234567)');
  }
  
  // Remove + from phone number for WhatsApp URL
  const phoneNumber = phoneE164.substring(1);
  
  // URL encode the message text
  const encodedText = encodeURIComponent(text);
  
  // Use wa.me format (more reliable)
  const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodedText}`;
  
  // Open in new window/tab
  window.open(whatsappUrl, '_blank');
}
