/**
 * Unit Tests for Overlap Detection Utilities
 * 
 * Run with: npm test overlapDetection.test.ts
 */

import { hasOverlap, findOverlappingOpenSlots } from './overlapDetection';
import { OpenSlot, SlotInventory, Lesson } from '../types';

describe('hasOverlap', () => {
  it('should detect overlapping ranges', () => {
    expect(
      hasOverlap(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T10:30:00Z',
        '2024-01-15T11:30:00Z'
      )
    ).toBe(true);
  });

  it('should not detect overlap for non-overlapping ranges', () => {
    expect(
      hasOverlap(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T12:00:00Z'
      )
    ).toBe(false);
  });

  it('should not detect overlap for adjacent ranges (touching)', () => {
    expect(
      hasOverlap(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T11:00:00Z',
        '2024-01-15T12:00:00Z'
      )
    ).toBe(false);
  });

  it('should detect overlap when one range contains another', () => {
    expect(
      hasOverlap(
        '2024-01-15T10:00:00Z',
        '2024-01-15T12:00:00Z',
        '2024-01-15T10:30:00Z',
        '2024-01-15T11:30:00Z'
      )
    ).toBe(true);
  });

  it('should work with Date objects', () => {
    const aStart = new Date('2024-01-15T10:00:00Z');
    const aEnd = new Date('2024-01-15T11:00:00Z');
    const bStart = new Date('2024-01-15T10:30:00Z');
    const bEnd = new Date('2024-01-15T11:30:00Z');
    
    expect(hasOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
  });

  it('should work with mixed string and Date inputs', () => {
    const aStart = new Date('2024-01-15T10:00:00Z');
    const aEnd = '2024-01-15T11:00:00Z';
    const bStart = '2024-01-15T10:30:00Z';
    const bEnd = new Date('2024-01-15T11:30:00Z');
    
    expect(hasOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
  });

  it('should handle edge case: same start and end times', () => {
    expect(
      hasOverlap(
        '2024-01-15T10:00:00Z',
        '2024-01-15T10:00:00Z',
        '2024-01-15T10:00:00Z',
        '2024-01-15T10:00:00Z'
      )
    ).toBe(false); // Zero-duration ranges don't overlap
  });
});

describe('findOverlappingOpenSlots', () => {
  // Use local-time ISO (no Z) so they match lessonDraft date+startTime interpreted as local
  const mockOpenSlot: OpenSlot = {
    id: 'slot1',
    teacherId: 'teacher1',
    startDateTime: '2024-01-15T10:00:00',
    endDateTime: '2024-01-15T11:00:00',
    status: 'open',
    source: 'weekly1',
  };

  const mockSlotInventory: SlotInventory = {
    id: 'slot2',
    teacherId: 'teacher1',
    teacherName: 'Teacher 1',
    date: '2024-01-15',
    startTime: '10:30',
    endTime: '11:30',
    status: 'open',
  };

  it('should find overlapping open slots with OpenSlot type', () => {
    const lessonDraft: Partial<Lesson> & { date: string; startTime: string; duration: number } = {
      date: '2024-01-15',
      startTime: '10:30',
      duration: 30,
      teacherId: 'teacher1',
    };

    const overlaps = findOverlappingOpenSlots(lessonDraft, [mockOpenSlot]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].id).toBe('slot1');
  });

  it('should find overlapping open slots with SlotInventory type', () => {
    const lessonDraft: Partial<Lesson> & { date: string; startTime: string; duration: number } = {
      date: '2024-01-15',
      startTime: '10:00',
      duration: 60,
      teacherId: 'teacher1',
    };

    const overlaps = findOverlappingOpenSlots(lessonDraft, [mockSlotInventory]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].id).toBe('slot2');
  });

  it('should filter by teacherId', () => {
    const differentTeacherSlot: OpenSlot = {
      id: 'slot3',
      teacherId: 'teacher2',
      startDateTime: '2024-01-15T10:00:00',
      endDateTime: '2024-01-15T11:00:00',
      status: 'open',
      source: 'weekly2',
    };

    const lessonDraft: Partial<Lesson> & { date: string; startTime: string; duration: number } = {
      date: '2024-01-15',
      startTime: '10:30',
      duration: 30,
      teacherId: 'teacher1',
    };

    const overlaps = findOverlappingOpenSlots(lessonDraft, [mockOpenSlot, differentTeacherSlot]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].id).toBe('slot1');
  });

  it('should filter by status === "open"', () => {
    const bookedSlot: OpenSlot = {
      id: 'slot4',
      teacherId: 'teacher1',
      startDateTime: '2024-01-15T10:00:00',
      endDateTime: '2024-01-15T11:00:00',
      status: 'booked',
      source: 'weekly3',
    };

    const lessonDraft: Partial<Lesson> & { date: string; startTime: string; duration: number } = {
      date: '2024-01-15',
      startTime: '10:30',
      duration: 30,
      teacherId: 'teacher1',
    };

    const overlaps = findOverlappingOpenSlots(lessonDraft, [mockOpenSlot, bookedSlot]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].id).toBe('slot1');
  });

  it('should return empty array if no overlaps', () => {
    const nonOverlappingSlot: OpenSlot = {
      id: 'slot5',
      teacherId: 'teacher1',
      startDateTime: '2024-01-15T12:00:00',
      endDateTime: '2024-01-15T13:00:00',
      status: 'open',
      source: 'weekly4',
    };

    const lessonDraft: Partial<Lesson> & { date: string; startTime: string; duration: number } = {
      date: '2024-01-15',
      startTime: '10:00',
      duration: 60,
      teacherId: 'teacher1',
    };

    const overlaps = findOverlappingOpenSlots(lessonDraft, [nonOverlappingSlot]);
    expect(overlaps).toHaveLength(0);
  });

  it('should return empty array if lessonDraft is missing required fields', () => {
    const lessonDraft: Partial<Lesson> & { date?: string; startTime?: string; duration?: number } = {
      date: '2024-01-15',
      // Missing startTime and duration
    };

    const overlaps = findOverlappingOpenSlots(lessonDraft as any, [mockOpenSlot]);
    expect(overlaps).toHaveLength(0);
  });

  it('should work without teacherId filter if lessonDraft has no teacherId', () => {
    const lessonDraft: Partial<Lesson> & { date: string; startTime: string; duration: number } = {
      date: '2024-01-15',
      startTime: '10:30',
      duration: 30,
      // No teacherId
    };

    const overlaps = findOverlappingOpenSlots(lessonDraft, [mockOpenSlot]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].id).toBe('slot1');
  });

  it('should handle multiple overlapping slots', () => {
    const anotherOverlappingSlot: OpenSlot = {
      id: 'slot6',
      teacherId: 'teacher1',
      startDateTime: '2024-01-15T10:15:00',
      endDateTime: '2024-01-15T11:15:00',
      status: 'open',
      source: 'weekly5',
    };

    const lessonDraft: Partial<Lesson> & { date: string; startTime: string; duration: number } = {
      date: '2024-01-15',
      startTime: '10:30',
      duration: 30,
      teacherId: 'teacher1',
    };

    const overlaps = findOverlappingOpenSlots(lessonDraft, [mockOpenSlot, anotherOverlappingSlot]);
    expect(overlaps).toHaveLength(2);
    expect(overlaps.map(s => s.id)).toContain('slot1');
    expect(overlaps.map(s => s.id)).toContain('slot6');
  });
});
