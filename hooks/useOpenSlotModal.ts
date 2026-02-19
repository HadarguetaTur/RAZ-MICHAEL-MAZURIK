import { useState, useCallback } from 'react';
import { SlotInventory } from '../types';
import { nexusApi } from '../services/nexusApi';

/**
 * Shared hook for managing SlotInventoryModal state across Calendar and Availability components.
 * Provides a unified API for opening/closing the slot reservation modal.
 */
export function useOpenSlotModal() {
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [isLoadingSlot, setIsLoadingSlot] = useState(false);
  const [slotData, setSlotData] = useState<SlotInventory | null>(null);

  /**
   * Open the modal for a specific slot by ID.
   * Fetches slot data if needed.
   * Also accepts a pre-loaded slot object for immediate display.
   */
  const open = useCallback(async (slotId: string | null, preloadedSlot?: SlotInventory) => {
    if (!slotId) {
      if (import.meta.env?.DEV) {
        console.warn('[useOpenSlotModal] Cannot open modal: slotId is null/undefined');
      }
      return;
    }


    setActiveSlotId(slotId);

    // If slot is preloaded, use it immediately
    if (preloadedSlot && preloadedSlot.id === slotId) {
      setSlotData(preloadedSlot);
      setIsLoadingSlot(false);
      return;
    }

    setIsLoadingSlot(true);

    try {
      // Fetch slot data from API
      const dayStartISO = new Date().toISOString().split('T')[0];
      const dayEndISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 30 days ahead
      
      const slots = await nexusApi.getSlotInventory(dayStartISO, dayEndISO);
      const slot = slots.find(s => s.id === slotId);

      if (!slot) {
        if (import.meta.env?.DEV) {
          console.warn('[useOpenSlotModal] Slot not found:', slotId);
        }
        setActiveSlotId(null);
        setSlotData(null);
        return;
      }

      setSlotData(slot);
    } catch (err) {
      console.error('[useOpenSlotModal] Failed to fetch slot:', err);
      setActiveSlotId(null);
      setSlotData(null);
    } finally {
      setIsLoadingSlot(false);
    }
  }, []);

  /**
   * Close the modal and reset state.
   */
  const close = useCallback(() => {
    setActiveSlotId(null);
    setSlotData(null);
    setIsLoadingSlot(false);
  }, []);

  /**
   * Handle successful slot reservation/closure.
   * This should be called after the slot operation completes.
   */
  const handleSuccess = useCallback(() => {
    // Close modal after success
    close();
  }, [close]);

  const isOpen = activeSlotId !== null;

  return {
    open,
    close,
    handleSuccess,
    isOpen,
    activeSlotId,
    slotData,
    isLoadingSlot,
  };
}
