/**
 * Unit tests for detectWeeklySlotOverlaps function
 */

import { WeeklySlot } from '../types';
import { detectWeeklySlotOverlaps } from '../components/Availability';

describe('detectWeeklySlotOverlaps', () => {
  const createSlot = (
    id: string,
    dayOfWeek: number,
    startTime: string,
    endTime: string
  ): WeeklySlot => ({
    id,
    teacherId: 'teacher1',
    teacherName: 'Teacher 1',
    dayOfWeek,
    startTime,
    endTime,
    type: 'private',
    status: 'active',
  });

  describe('Partial overlap', () => {
    it('should detect partial overlap', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '10:00', endTime: '12:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot2', 0, '11:00', '13:00'), // Overlaps: 11:00-12:00
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0].slotId).toBe('slot2');
    });
  });

  describe('Complete overlap', () => {
    it('should detect complete overlap (identical times)', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '10:00', endTime: '12:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot2', 0, '10:00', '12:00'), // Identical
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0].slotId).toBe('slot2');
    });

    it('should detect complete overlap (edited contains other)', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '09:00', endTime: '13:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot2', 0, '10:00', '12:00'), // Contained within edited
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0].slotId).toBe('slot2');
    });

    it('should detect complete overlap (other contains edited)', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '10:00', endTime: '12:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot2', 0, '09:00', '13:00'), // Contains edited
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0].slotId).toBe('slot2');
    });
  });

  describe('No overlap when end==start', () => {
    it('should not detect overlap when end equals start', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '10:00', endTime: '12:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot2', 0, '12:00', '14:00'), // End == start, no overlap
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(0);
    });

    it('should not detect overlap when start equals end', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '12:00', endTime: '14:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot2', 0, '10:00', '12:00'), // End == start, no overlap
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(0);
    });
  });

  describe('Different day should not overlap', () => {
    it('should not detect overlap for different days', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '10:00', endTime: '12:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot2', 1, '10:00', '12:00'), // Different day
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should skip the slot being edited', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '10:00', endTime: '12:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot1', 0, '10:00', '12:00'), // Same ID, should be skipped
        createSlot('slot2', 0, '11:00', '13:00'), // Should be detected
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0].slotId).toBe('slot2');
    });

    it('should return empty array if edited slot has missing fields', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '', endTime: '12:00', id: 'slot1' };
      const allSlots = [createSlot('slot2', 0, '10:00', '12:00')];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(0);
    });

    it('should skip slots with missing time fields', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '10:00', endTime: '12:00', id: 'slot1' };
      const allSlots = [
        { ...createSlot('slot2', 0, '11:00', '13:00'), startTime: '' }, // Missing startTime
        createSlot('slot3', 0, '11:00', '13:00'), // Valid overlap
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0].slotId).toBe('slot3');
    });

    it('should handle multiple overlaps', () => {
      const editedSlot = { dayOfWeek: 0, startTime: '10:00', endTime: '14:00', id: 'slot1' };
      const allSlots = [
        createSlot('slot2', 0, '09:00', '11:00'), // Overlaps
        createSlot('slot3', 0, '12:00', '13:00'), // Overlaps
        createSlot('slot4', 0, '13:00', '15:00'), // Overlaps
        createSlot('slot5', 1, '10:00', '14:00'), // Different day, no overlap
      ];

      const overlaps = detectWeeklySlotOverlaps(editedSlot, allSlots);
      expect(overlaps).toHaveLength(3);
      expect(overlaps.map(o => o.slotId).sort()).toEqual(['slot2', 'slot3', 'slot4']);
    });
  });
});
