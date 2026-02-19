/**
 * API Configuration for Frontend-Backend communication
 * 
 * Usage:
 *   import { getApiBaseUrl, apiUrl } from '@/config/api';
 *   fetch(apiUrl('/api/conflicts/check'), { ... })
 * 
 * Environment setup:
 *   - Local dev: Leave VITE_API_BASE_URL empty (uses Vite proxy)
 *   - Production (Vercel): Set VITE_API_BASE_URL=https://your-api.onrender.com
 */

/**
 * Get the API base URL for backend requests
 * 
 * Priority:
 * 1. VITE_API_BASE_URL env var (for production pointing to Render)
 * 2. Empty string '' (for local dev with Vite proxy)
 * 
 * @returns Base URL string (empty for relative URLs, full URL for production)
 */
export function getApiBaseUrl(): string {
  // Check for Vite environment variable
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  
  // Fallback: empty string = relative URL (works with Vite proxy in dev)
  return '';
}

/**
 * Build a full API URL from a path
 * 
 * @param path - API path starting with / (e.g., '/api/conflicts/check')
 * @returns Full URL or relative path depending on environment
 * 
 * @example
 * // In dev (no VITE_API_BASE_URL): apiUrl('/api/conflicts/check') => '/api/conflicts/check'
 * // In prod (VITE_API_BASE_URL set): apiUrl('/api/conflicts/check') => 'https://api.example.com/api/conflicts/check'
 */
export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  
  // If no base URL, return path as-is (relative URL for proxy)
  if (!base) {
    return path;
  }
  
  // Ensure no double slashes when joining
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  return `${cleanBase}${cleanPath}`;
}

/**
 * API endpoints enum for type safety and discoverability
 */
export const API_ENDPOINTS = {
  CONFLICTS_CHECK: '/api/conflicts/check',
  SLOT_INVENTORY: '/api/slot-inventory',
  HEALTH: '/health',
  AUTH_LOGIN: '/api/auth/login',
  AUTH_ME: '/api/auth/me',
  AIRTABLE_PROXY: '/api/airtable',
} as const;

// Export for debugging
export const API_CONFIG = {
  baseUrl: getApiBaseUrl(),
  isProduction: !!getApiBaseUrl(),
};

// Log configuration in dev mode
if (import.meta.env?.DEV) {
  console.log('[API Config]', {
    baseUrl: API_CONFIG.baseUrl || '(using proxy)',
    mode: import.meta.env.MODE,
  });
}
