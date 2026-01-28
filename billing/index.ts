#!/usr/bin/env node
/**
 * CLI for Billing Engine
 * 
 * Usage:
 *   npm run billing:build -- --student <studentId> --month <YYYY-MM>
 *   npm run billing:build -- --month <YYYY-MM> --all
 *   npm run billing:validate -- --month <YYYY-MM>
 */

import { AirtableClient } from './airtableClient';
import { buildStudentMonth, buildMonthForAllActiveStudents } from './billingEngine';
import { MissingFieldsError, DuplicateBillingRecordsError, DomainError } from './domainErrors';

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
};

const hasFlag = (flag: string): boolean => {
  return args.includes(flag);
};

async function main() {
  const command = args[0] || 'help';

  if (command === 'help' || hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Billing Engine CLI

Commands:
  build          Build billing records
  validate       Validate billing setup

Build Options:
  --student <id>     Build for specific student
  --month <YYYY-MM>  Billing month (required)
  --all              Build for all active students
  --dry-run          Show what would be created without saving

Examples:
  npm run billing:build -- --student rec123 --month 2024-03
  npm run billing:build -- --month 2024-03 --all
  npm run billing:validate -- --month 2024-03
`);
    return;
  }

  if (command === 'build') {
    const studentId = getArg('--student');
    const month = getArg('--month');
    const all = hasFlag('--all');
    const dryRun = hasFlag('--dry-run');

    if (!month) {
      console.error('Error: --month is required');
      process.exit(1);
    }

    if (!studentId && !all) {
      console.error('Error: Either --student or --all is required');
      process.exit(1);
    }

    const client = new AirtableClient();

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be saved\n');
    }

    if (all) {
      console.log(`Building billing for all active students - Month: ${month}\n`);
      
      const result = await buildMonthForAllActiveStudents(client, month, dryRun);
      
      console.log(`\n📊 Summary:`);
      console.log(`  - Students fetched: ${result.summary.studentsFetched}`);
      console.log(`  - Lessons fetched: ${result.summary.lessonsFetched}`);
      console.log(`  - Cancellations fetched: ${result.summary.cancellationsFetched}`);
      console.log(`\n💳 Charges:`);
      console.log(`  - Created: ${result.summary.chargesCreated}`);
      console.log(`  - Updated: ${result.summary.chargesUpdated}`);
      console.log(`  - Skipped: ${result.summary.chargesSkipped}`);
      console.log(`  - Errors: ${result.errors.length}`);
      
      if (result.success.length > 0) {
        const total = result.success.reduce((sum, b) => sum + b.total, 0);
        console.log(`\n💰 Total amount: ₪${total.toLocaleString()}`);
        
        console.log('\n📊 Breakdown:');
        console.log(`  - Lessons: ${result.success.reduce((sum, b) => sum + b.lessonsCount, 0)} lessons, ₪${result.success.reduce((sum, b) => sum + b.lessonsTotal, 0).toLocaleString()}`);
        console.log(`  - Cancellations: ${result.success.reduce((sum, b) => sum + b.cancellationsCount, 0)} cancellations, ₪${result.success.reduce((sum, b) => sum + b.cancellationsTotal, 0).toLocaleString()}`);
        console.log(`  - Subscriptions: ${result.success.reduce((sum, b) => sum + b.subscriptionsCount, 0)} subscriptions, ₪${result.success.reduce((sum, b) => sum + b.subscriptionsTotal, 0).toLocaleString()}`);
      }

      if (result.skipped.length > 0) {
        console.log(`\n⏭️  Skipped (${result.skipped.length} students with no billable data):`);
        result.skipped.slice(0, 10).forEach(skip => {
          console.log(`  - ${skip.studentId}: ${skip.reason}`);
        });
        if (result.skipped.length > 10) {
          console.log(`  ... and ${result.skipped.length - 10} more`);
        }
      }

      if (result.errors.length > 0) {
        console.log('\n❌ Errors:');
        for (const error of result.errors) {
          if (error.error instanceof MissingFieldsError) {
            console.log(`  Student ${error.studentId}: Missing fields`);
            console.log(JSON.stringify({ MISSING_FIELDS: error.error.missingFields }, null, 2));
          } else if (error.error instanceof DuplicateBillingRecordsError) {
            console.log(`  Student ${error.studentId}: Duplicate billing records found`);
            console.log(`    Record IDs: ${error.error.recordIds.join(', ')}`);
          } else {
            console.log(`  Student ${error.studentId}: ${error.error.message}`);
          }
        }
      }
    } else if (studentId) {
      console.log(`Building billing for student ${studentId} - Month: ${month}\n`);

      if (dryRun) {
        console.log('Dry run not yet implemented for --student');
        return;
      }

      try {
        const result = await buildStudentMonth(client, studentId, month);

        if (result instanceof MissingFieldsError) {
          console.error('❌ Missing required fields:');
          console.log(JSON.stringify({ MISSING_FIELDS: result.missingFields }, null, 2));
          process.exit(1);
        } else if (result instanceof DuplicateBillingRecordsError) {
          console.error('❌ Duplicate billing records found:');
          console.error(`   Record IDs: ${result.recordIds.join(', ')}`);
          process.exit(1);
        } else {
          console.log('✅ Billing record created/updated:');
          console.log(`   Record ID: ${result.billingRecordId}`);
          console.log(`   Status: ${result.status}`);
          console.log(`   Created: ${result.created ? 'Yes' : 'No (updated)'}`);
          console.log(`\n💰 Amounts:`);
          console.log(`   Lessons: ${result.lessonsCount} × ₪175 = ₪${result.lessonsTotal.toLocaleString()}`);
          console.log(`   Cancellations: ${result.cancellationsCount} = ₪${result.cancellationsTotal.toLocaleString()}`);
          console.log(`   Subscriptions: ${result.subscriptionsCount} = ₪${result.subscriptionsTotal.toLocaleString()}`);
          console.log(`   Total: ₪${result.total.toLocaleString()}`);
          
          if (result.pendingCancellationsCount > 0) {
            console.log(`\n⚠️  ${result.pendingCancellationsCount} cancellation(s) pending approval`);
          }
        }
      } catch (error: any) {
        if (error instanceof DomainError && error.code === 'NO_BILLABLE_DATA') {
          console.log('⏭️  Skipped: No billable data for this student in this month');
          console.log(`   ${error.message}`);
          if (error.details) {
            console.log(`   Details:`, JSON.stringify(error.details, null, 2));
          }
        } else {
          console.error('❌ Error:', error.message);
          if (error.details) {
            console.error('Details:', JSON.stringify(error.details, null, 2));
          }
          process.exit(1);
        }
      }
    }
  } else if (command === 'validate') {
    const month = getArg('--month');
    
    if (!month) {
      console.error('Error: --month is required');
      process.exit(1);
    }

    console.log(`Validating billing setup for month: ${month}\n`);
    console.log('Validation not yet implemented');
    // TODO: Implement validation
  } else {
    console.error(`Unknown command: ${command}`);
    console.log('Run with --help for usage information');
    process.exit(1);
  }
}

// Run CLI
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
