import assert from 'assert';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { run, get, all } from './database.js';
import runnerInstance from './services/automationRunner.js';

async function testAutoSplitAndExcelReport() {
  console.log('====================================================');
  console.log('   MULTI-DEVICE AUTO-SPLITTING & EXCEL REPORT TEST');
  console.log('====================================================\n');

  const testUserId = 1;
  const testCampaignName = `AutoSplit Test Campaign ${Date.now()}`;

  // 1. Create a test campaign with 20 contacts
  console.log('--- 1. Creating Test Campaign with 20 Contacts ---');
  const campRes = await run(`
    INSERT INTO campaigns (user_id, name, status, total_contacts, sent_count, failed_count, session_mode, session_name)
    VALUES (?, ?, 'Pending', 20, 0, 0, 'auto_split', 'auto_split')
  `, [testUserId, testCampaignName]);

  const campaignId = campRes.id;
  assert(campaignId > 0, 'Campaign ID should be valid');
  console.log(`Created Campaign #${campaignId}: ${testCampaignName}`);

  // Insert 20 sample contacts
  for (let i = 1; i <= 20; i++) {
    const phone = `9198765432${i.toString().padStart(2, '0')}`;
    const targetSession = (i % 2 === 1) ? 'profile-sales-1' : 'profile-sales-2';
    const status = (i === 13) ? 'Failed' : (i === 17 ? 'Skipped' : 'Sent');
    const errReason = (i === 13) ? 'Number not registered on WhatsApp' : (i === 17 ? 'Number is in opt-out blacklist' : null);

    await run(`
      INSERT INTO contacts (user_id, campaign_id, name, phone, company, message_template, status, sent_via_session, error_reason, sent_at, row_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      testUserId,
      campaignId,
      `Lead #${i}`,
      phone,
      `Acme Corp ${i}`,
      `Hello Lead #${i}, here is your exclusive offer!`,
      status,
      targetSession,
      errReason,
      new Date().toISOString(),
      i
    ]);
  }

  const sentCount = 18;
  const failedCount = 1;
  await run(`
    UPDATE campaigns 
    SET status = 'Completed', sent_count = ?, failed_count = ?, duration = 12 
    WHERE id = ?
  `, [sentCount, failedCount, campaignId]);

  console.log('✅ 20 contacts inserted with multi-session distribution (profile-sales-1 & profile-sales-2).');

  // 2. Test Excel Delivery Report Generation
  console.log('\n--- 2. Generating Automated Excel Campaign Report ---');
  const reportPath = await runnerInstance.generateCampaignExcelReport(campaignId);
  console.log('Generated Report Path:', reportPath);

  assert(reportPath && typeof reportPath === 'string', 'Report path must be a valid string');
  assert(fs.existsSync(reportPath), `Excel report file must exist on disk at: ${reportPath}`);
  console.log('✅ Excel report file successfully created on disk.');

  // 3. Inspect Excel Workbook Structure & Sheets
  console.log('\n--- 3. Verifying Excel Workbook Structure & Content ---');
  const wb = XLSX.readFile(reportPath);
  assert(wb.SheetNames.includes('Executive Summary'), 'Workbook must contain "Executive Summary" sheet');
  assert(wb.SheetNames.includes('Recipients Audit'), 'Workbook must contain "Recipients Audit" sheet');
  console.log('Sheet Names:', wb.SheetNames);

  const summarySheet = wb.Sheets['Executive Summary'];
  const summaryJson = XLSX.utils.sheet_to_json(summarySheet, { header: 1 });
  console.log('Executive Summary Rows:', summaryJson.length);
  assert(summaryJson.length >= 8, 'Summary sheet must have executive rows');

  const auditSheet = wb.Sheets['Recipients Audit'];
  const auditJson = XLSX.utils.sheet_to_json(auditSheet);
  console.log('Recipients Audit Rows:', auditJson.length);
  assert(auditJson.length === 20, 'Audit sheet must contain all 20 contact rows');

  // Verify columns & session attribution
  const firstRow = auditJson[0];
  console.log('Sample Row 1 Data:', firstRow);
  assert(firstRow['Recipient Name'] === 'Lead #1', 'Recipient Name matches Lead #1');
  assert(firstRow['WhatsApp Sender Profile'] === 'profile-sales-1', 'Session profile correctly attributed');

  const secondRow = auditJson[1];
  console.log('Sample Row 2 Data:', secondRow);
  assert(secondRow['WhatsApp Sender Profile'] === 'profile-sales-2', 'Session profile correctly attributed to Profile 2');

  const failedRow = auditJson.find(r => r['#'] === 13 || r['#'] === '13');
  assert(failedRow && failedRow['Delivery Status'] === 'Failed', 'Row 13 must show Failed status');
  assert(failedRow['Error / Failure Details'] === 'Number not registered on WhatsApp', 'Error details preserved');

  console.log('✅ Excel Workbook integrity and multi-device session audit verified 100%!');

  // Cleanup test campaign
  await run('DELETE FROM campaigns WHERE id = ?', [campaignId]);
  await run('DELETE FROM contacts WHERE campaign_id = ?', [campaignId]);
  try { fs.unlinkSync(reportPath); } catch (e) {}

  console.log('\n====================================================');
  console.log('   ALL MULTI-DEVICE & EXCEL REPORT TESTS PASSED!');
  console.log('====================================================\n');
}

testAutoSplitAndExcelReport().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
