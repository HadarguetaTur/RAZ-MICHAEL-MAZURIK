/**
 * React hook for fetching open slots with caching
 * Open slots are filtered from slot inventory
 */

import { useMemo } from 'react';
import { useSlotInventory } from './useSlotInventory';
import { OpenSlot } from '../../types';
import { SlotInventory } from '../../types';

export interface UseOpenSlotsReturn {
  data: OpenSlot[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export interface OpenSlotsRange {
  start: string; // ISO datetime string
  end: string; // ISO datetime string
}

/**
 * Convert SlotInventory to OpenSlot format
 */
function convertToOpenSlots(inventory: SlotInventory[]): OpenSlot[] {
  return inventory
    .filter(slot => slot.status === 'open')
    .map(slot => {
      const slotWithDT = slot as SlotInventory & { startDT?: string; endDT?: string };
      
      let startDateTime: string;
      let endDateTime: string;
      
      if (slotWithDT.startDT && slotWithDT.endDT) {
        startDateTime = slotWithDT.startDT;
        endDateTime = slotWithDT.endDT;
      } else {
        const startTimeStr = slot.startTime.includes(':') ? slot.startTime : `${slot.startTime}:00`;
        const endTimeStr = slot.endTime.includes(':') ? slot.endTime : `${slot.endTime}:00`;
        const startLocal = new Date(`${slot.date}T${startTimeStr}`);
        const endLocal = new Date(`${slot.date}T${endTimeStr}`);
        
        if (isNaN(startLocal.getTime()) || isNaN(endLocal.getTime())) {
          startDateTime = new Date().toISOString();
          endDateTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        } else {
          startDateTime = startLocal.toISOString();
          endDateTime = endLocal.toISOString();
        }
      }
      
      return {
        id: slot.id,
        teacherId: slot.teacherId,
        teacherName: slot.teacherName,
        startDateTime,
        endDateTime,
        status: slot.status,
      };
    });
}

export function useOpenSlots(
  range: OpenSlotsRange,
  teacherId?: string
): UseOpenSlotsReturn {
  // Extract date part from ISO strings
  const startDate = range.start.split('T')[0];
  const endDate = range.end.split('T')[0];
  
  const slotInventory = useSlotInventory(
    { start: startDate, end: endDate },
    teacherId
  );
  
  const openSlots = useMemo(() => {
    return convertToOpenSlots(slotInventory.data);
  }, [slotInventory.data]);
  
  return {
    data: openSlots,
    isLoading: slotInventory.isLoading,
    error: slotInventory.error,
    refresh: slotInventory.refresh,
  };
}
