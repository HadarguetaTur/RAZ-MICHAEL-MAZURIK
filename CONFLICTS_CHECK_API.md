# Conflicts Check API

## Endpoint

`POST /api/conflicts/check`

## Request Body

```json
{
  "entity": "lesson" | "slot_inventory",
  "recordId": "optional - record ID to exclude from conflicts",
  "teacherId": "string|number",
  "date": "YYYY-MM-DD",
  "start": "HH:mm" | "ISO datetime string",
  "end": "HH:mm" | "ISO datetime string"
}
```

## Response

```json
{
  "hasConflicts": boolean,
  "conflicts": [
    {
      "source": "lessons" | "slot_inventory",
      "recordId": "string",
      "start": "ISO datetime string",
      "end": "ISO datetime string",
      "label": "string",
      "meta": {}
    }
  ]
}
```

## Logic

1. **Lessons conflicts**: Checks for overlapping lessons of the same teacher on the same date
   - Excludes cancelled lessons: `'בוטל'` (CANCELLED) and `'ממתין לאישור ביטול'` (PENDING_CANCEL)
   - Excludes the `recordId` itself if provided

2. **Slot inventory conflicts**: Checks for overlapping open slots of the same teacher on the same date
   - Only includes slots with status `'open'` (English) or `'פתוח'` (Hebrew)
   - Excludes slots with linked lessons (already booked)
   - Excludes the `recordId` itself if provided

3. **Overlap detection**: Uses pure overlap engine from `utils/overlaps.ts`
   - Rule: overlap if `aStart < bEnd && aEnd > bStart`
   - Touching edges (end == start) are NOT considered overlaps

## Error Handling

- **400**: Invalid JSON body or missing required fields
- **500**: Airtable API error or internal error
  - Error messages are in Hebrew for user-facing errors
  - Console logs include minimal payload (no sensitive data)

## Example cURL

### Check conflicts for a lesson

```bash
curl -X POST http://localhost:3001/api/conflicts/check \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "lesson",
    "teacherId": "recXXXXXXXXXXXXXX",
    "date": "2024-01-15",
    "start": "10:00",
    "end": "11:00"
  }'
```

### Check conflicts for a slot_inventory (excluding itself)

```bash
curl -X POST http://localhost:3001/api/conflicts/check \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "slot_inventory",
    "recordId": "recYYYYYYYYYYYYYY",
    "teacherId": "recXXXXXXXXXXXXXX",
    "date": "2024-01-15",
    "start": "10:30",
    "end": "11:30"
  }'
```

### Check conflicts with ISO datetime strings

```bash
curl -X POST http://localhost:3001/api/conflicts/check \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "lesson",
    "teacherId": "recXXXXXXXXXXXXXX",
    "date": "2024-01-15",
    "start": "2024-01-15T10:00:00+02:00",
    "end": "2024-01-15T11:00:00+02:00"
  }'
```

## Response Examples

### No conflicts

```json
{
  "hasConflicts": false,
  "conflicts": []
}
```

### With conflicts

```json
{
  "hasConflicts": true,
  "conflicts": [
    {
      "source": "lessons",
      "recordId": "recABC123",
      "start": "2024-01-15T10:00:00.000Z",
      "end": "2024-01-15T11:00:00.000Z",
      "label": "יוסי כהן",
      "meta": {}
    },
    {
      "source": "slot_inventory",
      "recordId": "recXYZ789",
      "start": "2024-01-15T10:30:00.000Z",
      "end": "2024-01-15T11:30:00.000Z",
      "label": "חלון פתוח",
      "meta": {}
    }
  ]
}
```

## Server Setup

The API server runs on port 3001 (configurable via `CONFLICTS_CHECK_PORT` or `INBOX_API_PORT` environment variable).

Start the server:
```bash
npm run api:server
# or
npx tsx server/apiServer.ts
```

## Implementation Files

- `server/apiServer.ts` - HTTP server and endpoint handler
- `services/conflictsCheckService.ts` - Conflict checking logic
- `utils/overlaps.ts` - Pure overlap detection engine
