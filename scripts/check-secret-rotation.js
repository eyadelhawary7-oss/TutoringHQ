/**
 * Security rotation reminder script.
 * Parses docs/SECURITY_MAINTENANCE.md for "Next Due" dates and warns when rotations are upcoming or overdue.
 *
 * Run with: npm run check-secrets
 */

const fs = require('fs');
const path = require('path');

const docsPath = path.join(__dirname, '../docs/SECURITY_MAINTENANCE.md');

if (!fs.existsSync(docsPath)) {
  console.error('❌ docs/SECURITY_MAINTENANCE.md not found');
  process.exit(1);
}

const content = fs.readFileSync(docsPath, 'utf-8');

// Parse the rotation tracking table: | SECRET_NAME | ... | YYYY-MM-DD | ...
// Match lines like: | CSRF_SECRET | 2026-02-17 | 2026-08-17 | Admin |
const tableRegex = /\|\s*([A-Z0-9_]+)\s*\|\s*[\d-]+\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/g;
const rotations = {};
let match;
while ((match = tableRegex.exec(content)) !== null) {
  rotations[match[1]] = new Date(match[2]);
}

const today = new Date();
today.setHours(0, 0, 0, 0);

let hasWarnings = false;
let hasOverdue = false;

for (const [secret, dueDate] of Object.entries(rotations)) {
  dueDate.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));

  if (daysUntilDue <= 0) {
    console.log(`🚨 OVERDUE: ${secret} rotation is ${Math.abs(daysUntilDue)} days overdue!`);
    hasOverdue = true;
    hasWarnings = true;
  } else if (daysUntilDue <= 30) {
    console.log(`⚠️  WARNING: ${secret} rotation due in ${daysUntilDue} days`);
    hasWarnings = true;
  }
}

if (!hasWarnings) {
  console.log('✅ All secret rotations are on schedule (nothing due in the next 30 days).');
}

process.exit(hasOverdue ? 1 : 0);
