# Operational Notes: Safe Month Rebuild

## Overview

The billing engine is **idempotent** - re-running for the same student + month will update existing records rather than creating duplicates. This allows safe rebuilding of billing months when data changes.

## Safe Rebuild Process

### 1. Pre-Rebuild Checklist

Before rebuilding a billing month:

- [ ] Verify all lessons have correct `billing_month` field
- [ ] Verify all cancellations have correct `billing_month` and `is_lt_24h` fields
- [ ] Verify subscription dates are correct
- [ ] Check for any pending cancellations that need approval
- [ ] Backup current billing records (export from Airtable)

### 2. Rebuild Single Student

```bash
# Rebuild billing for one student
npm run billing:build -- --student rec123 --month 2024-03
```

**What happens:**
- Engine finds existing billing record (if any)
- Recalculates all totals from source data
- Updates existing record with new totals
- Preserves `שולם` (paid) flag if already set

**Safe to run multiple times** - each run recalculates from source data.

### 3. Rebuild All Students

```bash
# Rebuild billing for all active students
npm run billing:build -- --month 2024-03 --all
```

**What happens:**
- Processes each active student sequentially
- Creates new records or updates existing ones
- Reports success/error counts
- **Stops on duplicate records** (does not update)

### 4. Handling Errors

#### Duplicate Billing Records

If you see `DUPLICATE_BILLING_RECORDS` error:

1. **DO NOT** re-run the engine
2. Manually review duplicate records in Airtable
3. Identify which record is correct
4. Delete incorrect duplicate(s) manually
5. Re-run the engine

**Example:**
```
Error: Multiple billing records found for student rec123 and month 2024-03
Record IDs: rec456, rec789
```

**Action:** Check records `rec456` and `rec789` in Airtable, delete the incorrect one, then re-run.

#### Missing Fields

If you see `MISSING_FIELDS` error:

1. Review the missing fields list
2. Add missing fields to Airtable tables
3. Or provide the requested business rule
4. Re-run the engine

**Example:**
```json
{
  "MISSING_FIELDS": [
    {
      "table": "lessons",
      "field": "full_name (multi-link)",
      "why_needed": "Private lesson has multiple students. Need split rule.",
      "example_values": ["split_evenly", "charge_per_student", "disallow"]
    }
  ]
}
```

**Action:** Decide on split rule, implement it, then re-run.

### 5. Retroactive Changes

**Scenario:** A lesson's `billing_month` is corrected from `2024-04` to `2024-03`.

**Process:**
1. Update the lesson's `billing_month` field in Airtable
2. Re-run billing for both months:
   ```bash
   npm run billing:build -- --student rec123 --month 2024-03
   npm run billing:build -- --student rec123 --month 2024-04
   ```
3. Engine will:
   - Add lesson to March billing (update March totals)
   - Remove lesson from April billing (update April totals)

**Note:** Always rebuild both affected months when moving lessons between months.

### 6. Timezone Considerations

- Month boundaries use **Asia/Jerusalem** timezone
- Subscription dates are compared using month boundaries
- Ensure all date fields in Airtable are stored consistently

### 7. Verification After Rebuild

After rebuilding, verify:

1. **Totals match expectations:**
   - Check `lessons_total` = sum of private lessons
   - Check `cancellations_total` = sum of charged cancellations
   - Check `subscriptions_total` = sum of active subscriptions
   - Check `total` = lessons + cancellations + subscriptions

2. **Status is correct:**
   - `pending_approval` if there are pending cancellations
   - `approved` if no pending cancellations
   - `paid` if `שולם` is true

3. **No duplicates:**
   - Each student+month should have exactly one billing record

### 8. Best Practices

1. **Always rebuild after:**
   - Bulk updates to lessons/cancellations/subscriptions
   - Changes to `billing_month` fields
   - Changes to subscription dates
   - Approval/rejection of cancellations

2. **Test with one student first:**
   ```bash
   npm run billing:build -- --student rec123 --month 2024-03
   ```
   Then rebuild all if successful.

3. **Monitor for errors:**
   - Review error output carefully
   - Fix data issues before re-running
   - Don't ignore `MISSING_FIELDS` errors

4. **Preserve paid status:**
   - Engine preserves `שולם` (paid) flag
   - If a bill was paid, re-running won't change that
   - Manually update if needed

### 9. Emergency Procedures

#### If duplicates are created:

1. **Stop the engine immediately**
2. Identify all duplicate records
3. Export data from correct record
4. Delete all duplicates
5. Manually create/update correct record with exported data
6. Verify totals
7. Re-run engine to ensure consistency

#### If totals are incorrect:

1. Check source data (lessons, cancellations, subscriptions)
2. Verify `billing_month` fields are correct
3. Verify lesson types and statuses
4. Re-run engine - it will recalculate from source

#### If status is wrong:

1. Check `pending_cancellations_count`
2. Verify cancellation `is_charged` flags
3. Re-run engine - status is calculated automatically

## Summary

- ✅ **Safe to re-run** - engine is idempotent
- ✅ **Updates existing records** - no duplicates created
- ✅ **Preserves paid status** - won't change `שולם` flag
- ⚠️ **Stops on duplicates** - manual cleanup required
- ⚠️ **Returns MISSING_FIELDS** - fix data before re-running
- ✅ **Handles retroactive changes** - rebuild affected months

**When in doubt:** Rebuild one student first, verify results, then rebuild all.
