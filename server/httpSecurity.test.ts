import { isPublicIp, isValidRecordId } from './httpSecurity';

describe('httpSecurity helpers', () => {
  test('validates Airtable record IDs strictly', () => {
    expect(isValidRecordId('rec1234567890ABCD')).toBe(true);
    expect(isValidRecordId('rec"), OR(1,1), "x')).toBe(false);
    expect(isValidRecordId('rec-short')).toBe(false);
  });

  test('detects public vs local IPs', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('192.168.1.1')).toBe(false);
  });
});
