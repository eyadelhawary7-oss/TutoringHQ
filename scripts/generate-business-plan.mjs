#!/usr/bin/env node
/**
 * Generates CenterHQ_Business_Plan_v5.docx from the business plan content.
 * Run: node scripts/generate-business-plan.mjs
 */
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'docs', 'CenterHQ_Business_Plan_v5.docx');

const doc = new Document({
  title: 'CenterHQ Business Plan v5.0',
  subject: 'Business Plan - Version 5.0',
  creator: 'CenterHQ',
  description: 'v5.0: Updated pricing structure to 5-tier model with BUSINESS tier, adjusted PAYG to 30-50% premium, updated team limits and student capacities',
  sections: [
    {
      children: [
        new Paragraph({
          text: 'CenterHQ Business Plan',
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Paragraph({
          text: 'Version 5.0',
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Document Date: February 17, 2026', bold: true }),
          ],
          spacing: { after: 50 },
        }),
        new Paragraph({
          text: 'Change Log: v5.0: Updated pricing structure to 5-tier model with BUSINESS tier, adjusted PAYG to 30-50% premium, updated team limits and student capacities',
          spacing: { after: 400 },
        }),

        new Paragraph({ text: '4. Pricing Model', heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }),
        new Paragraph({ text: 'Fixed Monthly Plans', heading: HeadingLevel.HEADING_2, spacing: { after: 150 } }),
        new Table({
          columnWidths: [1800, 2000, 2000, 1800, 1800],
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({ children: [new Paragraph({ text: 'Plan', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Monthly Price', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Student Limit', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Team Members', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Setup Fee', bold: true })] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('STARTER')] }),
                new TableCell({ children: [new Paragraph('EGP 2,000/month')] }),
                new TableCell({ children: [new Paragraph('≤150 students')] }),
                new TableCell({ children: [new Paragraph('2 team members')] }),
                new TableCell({ children: [new Paragraph('EGP 1,000')] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('PRO')] }),
                new TableCell({ children: [new Paragraph('EGP 4,500/month')] }),
                new TableCell({ children: [new Paragraph('≤500 students')] }),
                new TableCell({ children: [new Paragraph('5 team members')] }),
                new TableCell({ children: [new Paragraph('EGP 2,000')] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('BUSINESS')] }),
                new TableCell({ children: [new Paragraph('EGP 6,500/month')] }),
                new TableCell({ children: [new Paragraph('≤1,000 students')] }),
                new TableCell({ children: [new Paragraph('10 team members')] }),
                new TableCell({ children: [new Paragraph('EGP 3,000')] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('ENTERPRISE')] }),
                new TableCell({ children: [new Paragraph('EGP 9,000/month')] }),
                new TableCell({ children: [new Paragraph('≤2,000 students')] }),
                new TableCell({ children: [new Paragraph('20 team members')] }),
                new TableCell({ children: [new Paragraph('EGP 5,000')] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('TOP CENTERS')] }),
                new TableCell({ children: [new Paragraph('Custom')] }),
                new TableCell({ children: [new Paragraph('Unlimited students')] }),
                new TableCell({ children: [new Paragraph('Unlimited team members')] }),
                new TableCell({ children: [new Paragraph('Custom setup')] }),
              ],
            }),
          ],
        }),
        new Paragraph({ text: '', spacing: { after: 200 } }),

        new Paragraph({ text: 'Pay-As-You-Go (PAYG) Pricing', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 150 } }),
        new Paragraph({
          text: 'PAYG pricing is 30-50% premium over fixed plans, ideal for centers with variable attendance.',
          spacing: { after: 100 },
        }),
        new Table({
          columnWidths: [2500, 2500, 2500],
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({ children: [new Paragraph({ text: 'Students/Week', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Rate per Student', bold: true })] }),
                new TableCell({ children: [new Paragraph({ text: 'Premium vs Fixed', bold: true })] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('0–150')] }),
                new TableCell({ children: [new Paragraph('EGP 4/student/week')] }),
                new TableCell({ children: [new Paragraph('20% premium')] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('151–500')] }),
                new TableCell({ children: [new Paragraph('EGP 3/student/week')] }),
                new TableCell({ children: [new Paragraph('33% premium')] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('501–1,000')] }),
                new TableCell({ children: [new Paragraph('EGP 2.50/student/week')] }),
                new TableCell({ children: [new Paragraph('54% premium')] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('1,001–2,000')] }),
                new TableCell({ children: [new Paragraph('EGP 2/student/week')] }),
                new TableCell({ children: [new Paragraph('78% premium')] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('2,001+')] }),
                new TableCell({ children: [new Paragraph('EGP 1.75/student/week')] }),
                new TableCell({ children: [new Paragraph('Custom pricing')] }),
              ],
            }),
          ],
        }),
        new Paragraph({ text: '', spacing: { after: 300 } }),

        new Paragraph({ text: '5. WhatsApp Products', heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 100 } }),
        new Paragraph({
          text: 'WhatsApp products remain as Phase 2 premium add-ons. No changes to this section.',
          spacing: { after: 300 },
        }),

        new Paragraph({ text: '7. Revenue Projections', heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 200 } }),

        new Paragraph({ text: 'Year 1 (50 centers)', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }),
        new Paragraph({ text: 'Monthly Recurring Revenue (MRR):', bold: true, spacing: { after: 50 } }),
        new Paragraph({ text: '• 20 × STARTER (EGP 2,000) = EGP 40,000', spacing: { after: 20 } }),
        new Paragraph({ text: '• 15 × PRO (EGP 4,500) = EGP 67,500', spacing: { after: 20 } }),
        new Paragraph({ text: '• 8 × BUSINESS (EGP 6,500) = EGP 52,000', spacing: { after: 20 } }),
        new Paragraph({ text: '• 5 × ENTERPRISE (EGP 9,000) = EGP 45,000', spacing: { after: 20 } }),
        new Paragraph({ text: '• 2 × TOP CENTERS (avg EGP 15,000) = EGP 30,000', spacing: { after: 50 } }),
        new Paragraph({ text: 'Total MRR: EGP 234,500', bold: true, spacing: { after: 20 } }),
        new Paragraph({ text: 'Annual Recurring Revenue (ARR): EGP 2,814,000', bold: true, spacing: { after: 100 } }),
        new Paragraph({ text: 'Setup Fees Year 1:', bold: true, spacing: { after: 50 } }),
        new Paragraph({ text: '• 20 × EGP 1,000 = EGP 20,000', spacing: { after: 20 } }),
        new Paragraph({ text: '• 15 × EGP 2,000 = EGP 30,000', spacing: { after: 20 } }),
        new Paragraph({ text: '• 8 × EGP 3,000 = EGP 24,000', spacing: { after: 20 } }),
        new Paragraph({ text: '• 5 × EGP 5,000 = EGP 25,000', spacing: { after: 20 } }),
        new Paragraph({ text: '• 2 × Custom (avg EGP 15,000) = EGP 30,000', spacing: { after: 50 } }),
        new Paragraph({ text: 'Total Setup Fees: EGP 129,000', bold: true, spacing: { after: 200 } }),

        new Paragraph({ text: 'Year 2 (120 centers)', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }),
        new Paragraph({ text: 'Assumed mix: 45 STARTER, 35 PRO, 22 BUSINESS, 12 ENTERPRISE, 6 TOP CENTERS', spacing: { after: 50 } }),
        new Paragraph({ text: 'Total MRR: EGP 588,500 | ARR: EGP 7,062,000', bold: true, spacing: { after: 50 } }),
        new Paragraph({ text: 'New Setup Fees (70 new centers): EGP 202,000', bold: true, spacing: { after: 200 } }),

        new Paragraph({ text: 'Year 3 (200 centers)', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }),
        new Paragraph({ text: 'Assumed mix: 75 STARTER, 60 PRO, 38 BUSINESS, 20 ENTERPRISE, 7 TOP CENTERS', spacing: { after: 50 } }),
        new Paragraph({ text: 'Total MRR: EGP 952,000 | ARR: EGP 11,424,000', bold: true, spacing: { after: 50 } }),
        new Paragraph({ text: 'New Setup Fees (80 new centers): EGP 195,000', bold: true, spacing: { after: 200 } }),

        new Paragraph({ text: '8. Competitive Comparison', heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 100 } }),
        new Paragraph({
          text: 'CenterHQ now offers more granular pricing for centers of all sizes, from small operations (STARTER, ≤150 students) to large enterprises (TOP CENTERS, custom). The 5-tier fixed model plus PAYG gives flexibility that competitors lack. The BUSINESS tier (EGP 6,500, ≤1,000 students) fills the gap between PRO and ENTERPRISE, enabling mid-size centers to scale affordably.',
          spacing: { after: 200 },
        }),
      ],
    },
  ],
});

async function main() {
  const buffer = await Packer.toBuffer(doc);
  writeFileSync(OUTPUT_PATH, buffer);
  console.log(`Created: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
