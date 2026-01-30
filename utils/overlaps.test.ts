/**
 * Unit tests for overlap utilities (utils/overlaps.ts).
 * Run: npm test overlaps.test.ts
 */

import { isOverlapping, findConflicts, type ExistingInterval } from './overlaps';

describe('isOverlapping', () => {
  it('returns false when there is no overlap', () => {
    expect(
      isOverlapping(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T12:00:00Z',
        '2024-01-15T13:00:00Z'
      )
    ).toBe(false);
  });

  it('returns true for partial overlap', () => {
    expect(
      isOverlapping(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T10:30:00Z',
        '2024-01-15T11:30:00Z'
      )
    ).toBe(true);
  });

  it('returns true for exact same interval', () => {
    expect(
      isOverlapping(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z'
      )
    ).toBe(true);
  });

  it('returns false when edges touch (aEnd === bStart)', () => {
    expect(
      isOverlapping(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T12:00:00Z'
      )
    ).toBe(false);
  });

  it('returns false when edges touch (bEnd === aStart)', () => {
    expect(
      isOverlapping(
        '2024-01-15T11:00:00Z',
        '2024-01-15T12:00:00Z',
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z'
      )
    ).toBe(false);
  });

  it('works with Date objects', () => {
    const aStart = new Date('2024-01-15T10:00:00Z');
    const aEnd = new Date('2024-01-15T11:00:00Z');
    const bStart = new Date('2024-01-15T10:30:00Z');
    const bEnd = new Date('2024-01-15T11:30:00Z');
    expect(isOverlapping(aStart, aEnd, bStart, bEnd)).toBe(true);
  });

  it('returns false for zero-duration range vs same point', () => {
    expect(
      isOverlapping(
        '2024-01-15T10:00:00Z',
        '2024-01-15T10:00:00Z',
        '2024-01-15T10:00:00Z',
        '2024-01-15T10:00:00Z'
      )
    ).toBe(false);
  });

  it('works with Asia/Jerusalem timezone offsets (+02:00)', () => {
    // Same time in UTC and Jerusalem timezone should overlap
    expect(
      isOverlapping(
        '2024-01-15T10:00:00+02:00', // 08:00 UTC
        '2024-01-15T11:00:00+02:00', // 09:00 UTC
        '2024-01-15T08:00:00Z',
        '2024-01-15T09:00:00Z'
      )
    ).toBe(true);
  });

  it('works with Asia/Jerusalem timezone offsets (+03:00)', () => {
    // Summer time in Jerusalem (UTC+3)
    expect(
      isOverlapping(
        '2024-07-15T10:00:00+03:00', // 07:00 UTC
        '2024-07-15T11:00:00+03:00', // 08:00 UTC
        '2024-07-15T07:00:00Z',
        '2024-07-15T08:00:00Z'
      )
    ).toBe(true);
  });

  it('handles mixed UTC and timezone offset strings', () => {
    expect(
      isOverlapping(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T12:00:00+02:00', // 10:00 UTC
        '2024-01-15T13:00:00+02:00'  // 11:00 UTC
      )
    ).toBe(true);
  });
});

describe('findConflicts', () => {
  const existing: ExistingInterval[] = [
    { recordId: 'recA', source: 'lesson', start: '2024-01-15T09:00:00Z', end: '2024-01-15T10:00:00Z', label: 'A' },
    { recordId: 'recB', source: 'slot', start: '2024-01-15T10:30:00Z', end: '2024-01-15T11:30:00Z', label: 'B' },
    { recordId: 'recC', source: 'lesson', start: '2024-01-15T11:00:00Z', end: '2024-01-15T12:00:00Z', label: 'C' },
    { recordId: 'recD', source: 'slot', start: '2024-01-15T14:00:00Z', end: '2024-01-15T15:00:00Z', label: 'D' },
  ];

  it('returns empty when proposed interval has no overlap', () => {
    const conflicts = findConflicts(
      '2024-01-15T12:30:00Z',
      '2024-01-15T13:30:00Z',
      existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it('returns overlapping intervals sorted by start', () => {
    const conflicts = findConflicts(
      '2024-01-15T10:00:00Z',
      '2024-01-15T12:00:00Z',
      existing
    );
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].recordId).toBe('recB');
    expect(conflicts[0].start).toBe('2024-01-15T10:30:00Z');
    expect(conflicts[1].recordId).toBe('recC');
    expect(conflicts[1].start).toBe('2024-01-15T11:00:00Z');
  });

  it('excludes touching intervals (proposed end === existing start)', () => {
    const conflicts = findConflicts(
      '2024-01-15T08:00:00Z',
      '2024-01-15T09:00:00Z',
      existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it('excludes touching intervals (proposed start === existing end)', () => {
    const conflicts = findConflicts(
      '2024-01-15T10:00:00Z',
      '2024-01-15T10:30:00Z',
      existing
    );
    expect(conflicts).toHaveLength(0);
  });

  it('excludes self when excludeRecordId is provided', () => {
    const existing: ExistingInterval[] = [
      { recordId: 'recA', source: 'lessons', start: '2024-01-15T10:00:00Z', end: '2024-01-15T11:00:00Z', label: 'Lesson A' },
      { recordId: 'recB', source: 'lessons', start: '2024-01-15T10:30:00Z', end: '2024-01-15T11:30:00Z', label: 'Lesson B' },
    ];
    // Proposed interval overlaps with recA, but we exclude recA itself
    const conflicts = findConflicts(
      '2024-01-15T10:00:00Z',
      '2024-01-15T11:00:00Z',
      existing,
      'recA' // Exclude recA
    );
    // Should only find recB (which overlaps), not recA
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].recordId).toBe('recB');
  });

  it('returns full structure for each conflict', () => {
    const conflicts = findConflicts(
      '2024-01-15T10:30:00Z',
      '2024-01-15T11:00:00Z',
      existing
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      recordId: 'recB',
      source: 'slot',
      start: '2024-01-15T10:30:00Z',
      end: '2024-01-15T11:30:00Z',
      label: 'B',
    });
  });

  it('works with Asia/Jerusalem timezone in existing intervals', () => {
    const existingWithTimezone: ExistingInterval[] = [
      { recordId: 'recE', source: 'lesson', start: '2024-01-15T10:00:00+02:00', end: '2024-01-15T11:00:00+02:00', label: 'E' },
      { recordId: 'recF', source: 'slot', start: '2024-01-15T12:00:00+02:00', end: '2024-01-15T13:00:00+02:00', label: 'F' },
    ];
    
    // Proposed interval overlaps with first interval (same timezone)
    const conflicts = findConflicts(
      '2024-01-15T10:30:00+02:00',
      '2024-01-15T11:30:00+02:00',
      existingWithTimezone
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].recordId).toBe('recE');
  });

  it('handles mixed UTC and timezone offsets in findConflicts', () => {
    const existingMixed: ExistingInterval[] = [
      { recordId: 'recG', source: 'lesson', start: '2024-01-15T08:00:00Z', end: '2024-01-15T09:00:00Z', label: 'G' },
      { recordId: 'recH', source: 'slot', start: '2024-01-15T12:00:00+02:00', end: '2024-01-15T13:00:00+02:00', label: 'H' }, // 10:00-11:00 UTC
    ];
    
    // Proposed interval in UTC overlaps only with UTC interval
    const conflicts = findConflicts(
      '2024-01-15T08:00:00Z',
      '2024-01-15T09:00:00Z',
      existingMixed
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].recordId).toBe('recG');
    
    // Proposed interval in timezone overlaps with UTC interval (same time)
    const conflicts2 = findConflicts(
      '2024-01-15T10:00:00+02:00', // 08:00 UTC
      '2024-01-15T11:00:00+02:00', // 09:00 UTC
      existingMixed
    );
    expect(conflicts2).toHaveLength(1);
    expect(conflicts2[0].recordId).toBe('recG');
  });
});
