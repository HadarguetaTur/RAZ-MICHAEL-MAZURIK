/**
 * Weekly Rollover CLI Script
 * 
 * Usage:
 *   npm run rollover              - Run rollover for current date
 *   npm run rollover -- --date YYYY-MM-DD  - Run rollover for specific date
 *   npm run rollover -- --dry-run - Dry run (no changes)
 */

import { performWeeklyRollover, getCurrentOpenWeeks } from '../services/weeklyRolloverService';
import { formatDate, getNextWeekStart } from '../services/dateUtils';

// Parse command line arguments
const args = process.argv.slice(2);
const dateArg = args.find(arg => arg.startsWith('--date='));
const dryRun = args.includes('--dry-run');

// Get reference date
let referenceDate: Date | undefined;
if (dateArg) {
  const dateStr = dateArg.split('=')[1];
  referenceDate = new Date(dateStr);
  if (isNaN(referenceDate.getTime())) {
    console.error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD format.`);
    process.exit(1);
  }
}

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Weekly Rollover Script');
    console.log('='.repeat(60));
    
    if (dryRun) {
      console.log('⚠️  DRY RUN MODE - No changes will be made');
      console.log('');
    }
    
    // Show current open weeks
    const currentOpenWeeks = getCurrentOpenWeeks(referenceDate);
    console.log('Current open weeks:');
    console.log(`  Week 1: ${formatDate(currentOpenWeeks[0])} (Sunday)`);
    console.log(`  Week 2: ${formatDate(currentOpenWeeks[1])} (Sunday)`);
    console.log('');
    
    if (dryRun) {
      const nextWeekStart = getNextWeekStart(currentOpenWeeks[1]);
      console.log('Would perform rollover:');
      console.log(`  - Close week: ${formatDate(currentOpenWeeks[0])}`);
      console.log(`  - Open week: ${formatDate(nextWeekStart)}`);
      console.log('');
      console.log('Dry run completed. No changes made.');
      return;
    }
    
    // Perform rollover
    console.log('Performing weekly rollover...');
    console.log('');
    
    const result = await performWeeklyRollover(referenceDate);
    
    console.log('');
    console.log('='.repeat(60));
    console.log('Rollover completed successfully!');
    console.log('='.repeat(60));
    console.log(`Closed week: ${formatDate(result.closedWeek)}`);
    console.log(`Opened week: ${formatDate(result.openedWeek)}`);
    console.log(`Created ${result.slotInventoryCount} slot inventory records`);
    console.log(`Created ${result.fixedLessonsCount} fixed lessons`);
    console.log('');
    
  } catch (error: any) {
    console.error('');
    console.error('='.repeat(60));
    console.error('ERROR: Rollover failed');
    console.error('='.repeat(60));
    console.error(error.message || error);
    if (error.details) {
      console.error('Details:', error.details);
    }
    console.error('');
    process.exit(1);
  }
}

main();
