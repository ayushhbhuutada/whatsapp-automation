import { tier1Suite } from './tier1_feature_coverage.test.js';
import { tier2Suite } from './tier2_boundary_corner.test.js';
import { tier3Suite } from './tier3_cross_feature.test.js';
import { tier4Suite } from './tier4_real_world.test.js';
import { challengerM1Suite } from './m1_challenger_adversarial.test.js';
import { m1EmpiricalSuite } from './m1_emp_concurrency_auth_stress.test.js';
import { challengerM2Suite } from './m2_challenger_stress.test.js';
import { challengerM3Suite } from './m3_challenger_stress.test.js';
import { m3DesktopPackagingSuite } from './m3_desktop_packaging.test.js';

import { challengerM2EmpiricalSuite } from './m2_challenger_empirical_harness.js';
import { m2EmpiricalRunnerSuite } from './m2_runner_concurrency_adversarial.test.js';
import { challengerM4FrontendSuite } from './m4_challenger_frontend_resilience.test.js';
import { m5StoreConfigSuite } from './m5_store_config.test.js';

async function main() {
  console.log(`\n======================================================`);
  console.log(` WHATSAPP AUTOMATION ENGINE & ANTI-BAN TEST SUITE`);
  console.log(`======================================================`);
  
  const startTime = Date.now();

  const suites = [
    tier1Suite,
    tier2Suite,
    tier3Suite,
    tier4Suite,
    challengerM1Suite,
    m1EmpiricalSuite,
    challengerM2Suite,
    challengerM2EmpiricalSuite,
    m2EmpiricalRunnerSuite,
    challengerM3Suite,
    m3DesktopPackagingSuite,
    challengerM4FrontendSuite,
    m5StoreConfigSuite
  ];
  const summary = [];

  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;

  for (const suite of suites) {
    const res = await suite.run();
    summary.push(res);
    grandTotal += res.total;
    grandPassed += res.passed;
    grandFailed += res.failed;
  }

  const totalDuration = Date.now() - startTime;

  console.log(`\n======================================================`);
  console.log(` FINAL TEST EXECUTION SUMMARY`);
  console.log(`======================================================`);
  console.log(` Suite Name                          Total  Pass  Fail`);
  console.log(` ----------------------------------------------------`);
  
  for (const s of summary) {
    const nameFormatted = s.name.padEnd(35, ' ');
    const totalFormatted = String(s.total).padStart(5, ' ');
    const passFormatted = String(s.passed).padStart(5, ' ');
    const failFormatted = String(s.failed).padStart(5, ' ');
    console.log(` ${nameFormatted} ${totalFormatted} ${passFormatted} ${failFormatted}`);
  }

  console.log(` ----------------------------------------------------`);
  console.log(` TOTAL                                ${String(grandTotal).padStart(5, ' ')} ${String(grandPassed).padStart(5, ' ')} ${String(grandFailed).padStart(5, ' ')}`);
  console.log(` Duration: ${totalDuration}ms`);
  console.log(`======================================================\n`);

  if (grandFailed > 0) {
    console.log(`\x1b[31mRESULT: TEST SUITE FAILED (${grandFailed} test failure(s))\x1b[0m\n`);
    process.exit(1);
  } else {
    console.log(`\x1b[32mRESULT: ALL ${grandTotal} TESTS PASSED SUCCESSFULLY! ✔\x1b[0m\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error running test runner:', err);
  process.exit(1);
});
