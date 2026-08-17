import { getMachineId, validateLicenseKey, activateLicense } from './services/licenseService.js';
import { createLicenseKey } from './utils/licenseGenerator.js';
import assert from 'assert';

async function testDesktopSecurity() {
  console.log('====================================================');
  console.log('   DESKTOP APP HARDWARE SECURITY HARNESS TEST');
  console.log('====================================================\n');

  // 1. Test Hardware Machine ID Generation
  console.log('--- 1. Testing Hardware Node-Locking Fingerprint ---');
  const machineId = getMachineId();
  console.log('Generated Windows Machine ID:', machineId);
  assert(typeof machineId === 'string' && machineId.startsWith('WA-WIN-'), 'Machine ID must start with WA-WIN-');
  console.log('✅ Hardware Node-Locking Fingerprint generated successfully.');

  // 2. Test Invalid & Unsigned Legacy License Key Rejection
  console.log('\n--- 2. Testing Invalid & Unsigned License Key Rejection ---');
  const invalidRes = await validateLicenseKey('INVALID-KEY-1234', machineId);
  console.log('Invalid License Check:', invalidRes);
  assert(invalidRes.valid === false, 'Invalid key should be rejected');

  const legacyKeyRes = await validateLicenseKey('WA-PRO-TEST-9999-8888', machineId);
  console.log('Legacy Unsigned Key Check:', legacyKeyRes);
  assert(legacyKeyRes.valid === false, 'Legacy unsigned key should be strictly rejected');
  console.log('✅ Unauthorized and unsigned license keys successfully rejected.');

  // 3. Test Signed Master Pro License Key Validation & Activation
  console.log('\n--- 3. Testing Valid Signed License Activation & Hardware Binding ---');
  const testKey = createLicenseKey({
    customer: 'Desktop Pro Licensee',
    licenseType: 'Pro Desktop',
    nodeLockId: machineId
  });
  const activateRes = await activateLicense(testKey);
  console.log('License Activation Result:', activateRes);
  assert(activateRes.success === true, 'Valid license key activation failed');
  assert(activateRes.machineId === machineId, 'License should bind to machine ID');
  console.log('✅ License activation and machine ID binding verified.');

  console.log('\n====================================================');
  console.log('   ALL DESKTOP SECURITY HARNESS TESTS PASSED!');
  console.log('====================================================\n');
}

testDesktopSecurity();
