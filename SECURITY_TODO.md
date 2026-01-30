# Security TODO - Airtable API Key Exposure

## Critical Issue

The Airtable API Key (`VITE_AIRTABLE_API_KEY`) is currently exposed in the frontend bundle.
This means anyone can inspect the browser's network tab or JS bundle and extract the API key.

## Affected Files

### Direct Airtable Calls from Frontend (API Key Exposed)

| File | Line | Impact |
|------|------|--------|
| `services/nexusApi.ts` | 16-17 | Main API client - exposes `VITE_AIRTABLE_API_KEY` in all requests |
| `services/airtableClient.ts` | 14-18 | Secondary client - same exposure |
| `services/subscriptionsService.ts` | 7-8 | Subscriptions API - same exposure |
| `billing/airtableClient.ts` | 15-35 | Billing client - may be used both server/client side |

## Current State

```typescript
// Example from services/nexusApi.ts
const AIRTABLE_API_KEY = import.meta.env.VITE_AIRTABLE_API_KEY || '';
// This key is bundled into the frontend JS and visible to anyone!
```

## Recommended Fix

### Option 1: Backend Proxy (Recommended)

Move ALL Airtable calls through the backend API server:

1. **Keep API key on server only** (remove `VITE_AIRTABLE_API_KEY`)
2. **Extend `server/apiServer.ts`** with new endpoints:
   - `GET /api/students`
   - `GET /api/lessons`
   - `POST /api/lessons`
   - etc.
3. **Update frontend services** to use `apiUrl()` helper for all calls
4. **Benefit**: API key never leaves the server

### Option 2: Airtable API Scoping (Partial Mitigation)

If moving all calls to backend is too much work:

1. Create a **restricted Airtable token** with:
   - Read-only access where possible
   - Limited to specific tables
   - Limited to specific scopes
2. This reduces damage if key is exposed, but doesn't eliminate risk

### Option 3: Serverless Functions (If using Vercel)

Use Vercel serverless functions (`/api/` folder) as a proxy:

```
frontend → /api/airtable/* → Vercel serverless → Airtable
```

## Priority

**HIGH** - Should be addressed before going to production with real user data.

## Implementation Estimate

- Option 1: Medium effort (extend existing backend, update all fetch calls)
- Option 2: Low effort (reconfigure Airtable token)
- Option 3: Medium effort (create new Vercel API routes)

## Temporary Mitigation (Already Done)

For the `/api/conflicts/check` endpoint:
- ✅ Already moved to backend (`server/apiServer.ts`)
- ✅ Frontend uses `apiUrl()` helper
- ✅ API key stays on server for conflict checking

## Next Steps

1. [ ] Discuss with team which option to pursue
2. [ ] Create backend endpoints for remaining Airtable operations
3. [ ] Update frontend to use new backend endpoints
4. [ ] Remove `VITE_AIRTABLE_API_KEY` from production frontend
5. [ ] Rotate Airtable API key after migration
