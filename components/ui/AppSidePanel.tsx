import React, { useEffect, useRef, useState } from 'react';

export interface AppSidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number | string;
  side?: 'right' | 'left';
  loading?: boolean;
  closeOnOverlayClick?: boolean;
}

const AppSidePanel: React.FC<AppSidePanelProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 480,
  side = 'right',
  loading = false,
  closeOnOverlayClick = true,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle mount/unmount for animations
  useEffect(() => {
    if (open) {
      // Clear any pending unmount timeout
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      // Mount immediately when opening
      setIsMounted(true);
    } else {
      // When closing, wait for animation to complete before unmounting
      if (isMounted) {
        animationTimeoutRef.current = setTimeout(() => {
          setIsMounted(false);
          animationTimeoutRef.current = null;
        }, 350); // Slightly longer than animation duration (300ms) to ensure it completes
      }
    }

    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
    };
  }, [open, isMounted]);

  // ESC key handler
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, loading, onOpenChange]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  // Focus trap - focus first element when opened
  useEffect(() => {
    if (!open || !isMounted) return;

    const panel = panelRef.current;
    if (!panel) return;

    // Find first focusable element
    const focusableSelectors = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const firstFocusable = panel.querySelector(focusableSelectors) as HTMLElement;
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 100);
    }
  }, [open, isMounted]);

  // Handle overlay click
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && !loading && e.target === overlayRef.current) {
      onOpenChange(false);
    }
  };

  // Handle close button
  const handleClose = () => {
    if (!loading) {
      onOpenChange(false);
    }
  };

  // Calculate width
  const panelWidth = typeof width === 'number' ? `${width}px` : width;

  // Determine if RTL (default to RTL)
  const isRTL = document.documentElement.dir === 'rtl' || (!document.documentElement.dir && side === 'right');
  // In RTL: right side means opening from right (justify-end)
  // In LTR: right side means opening from right (justify-end)
  // So: side='right' always means justify-end, side='left' always means justify-start
  const shouldOpenFromRight = side === 'right';

  // Don't render if not mounted at all
  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex ${shouldOpenFromRight ? 'justify-end' : 'justify-start'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'app-side-panel-title' : undefined}
      style={{
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* Overlay */}
      <div
        ref={overlayRef}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleOverlayClick}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`relative bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl flex flex-col overflow-hidden transition-transform duration-300 ease-in-out ${
          open 
            ? 'translate-x-0'
            : shouldOpenFromRight
            ? 'translate-x-full'
            : '-translate-x-full'
        }`}
        style={{
          width: `min(100%, ${panelWidth})`,
          pointerEvents: open ? 'auto' : 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || description) && (
          <div className="p-6 md:p-8 border-b border-slate-100 relative shrink-0 bg-slate-50">
            {/* Mobile drag handle */}
            <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden" />

            {/* Close button */}
            <button
              onClick={handleClose}
              disabled={loading}
              className="absolute left-6 md:left-8 top-6 md:top-8 p-2 text-slate-400 hover:text-slate-900 hover:bg-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="סגור"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Title */}
            <div className="mt-6 md:mt-0 pr-12">
              {title && (
                <h2 id="app-side-panel-title" className="text-xl md:text-2xl font-black text-slate-900 mb-2">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-sm font-bold text-slate-600">{description}</p>
              )}
            </div>
          </div>
        )}

        {/* Content - Scrollable */}
        <div className="flex-1 p-6 md:p-8 overflow-y-auto custom-scrollbar bg-[#fcfdfe]">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="p-6 md:p-8 border-t border-slate-100 bg-white flex gap-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default AppSidePanel;
