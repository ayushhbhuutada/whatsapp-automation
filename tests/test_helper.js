import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { run, get } from '../backend/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function ensureTestUser(userId) {
  const existing = await get('SELECT id FROM users WHERE id = ?', [userId]);
  const now = new Date().toISOString();
  if (!existing) {
    await run(`
      INSERT OR IGNORE INTO users (id, name, email, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [userId, `Test User ${userId}`, `testuser${userId}@example.com`, 'hash', now]);
  } else {
    await run('UPDATE users SET created_at = ? WHERE id = ?', [now, userId]);
  }
  await run('DELETE FROM daily_send_tracker WHERE user_id = ?', [userId]);
  await run('DELETE FROM blacklisted_numbers WHERE user_id = ?', [userId]);
}

// Helper for test suites

export function createTestSuite(name) {
  const tests = [];
  return {
    name,
    add(title, fn) {
      tests.push({ title, fn });
    },
    async run() {
      console.log(`\n======================================================`);
      console.log(` Running Suite: ${name}`);
      console.log(`======================================================`);
      let passed = 0;
      let failed = 0;
      const results = [];

      for (const test of tests) {
        const start = Date.now();
        try {
          await test.fn();
          const duration = Date.now() - start;
          console.log(`  \x1b[32m✔ PASS\x1b[0m [${duration}ms] - ${test.title}`);
          passed++;
          results.push({ title: test.title, status: 'PASS', duration, error: null });
        } catch (err) {
          const duration = Date.now() - start;
          console.log(`  \x1b[31m✖ FAIL\x1b[0m [${duration}ms] - ${test.title}`);
          console.log(`     \x1b[31mError: ${err.message}\x1b[0m`);
          failed++;
          results.push({ title: test.title, status: 'FAIL', duration, error: err.message });
        }
      }

      return { name, total: tests.length, passed, failed, results };
    }
  };
}
