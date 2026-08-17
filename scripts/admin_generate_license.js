import { createLicenseKey, fromBase64Url } from '../backend/utils/licenseGenerator.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace(/^--/, '');
      const value = (args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : true;
      params[key] = value;
      if (value !== true) i++;
    }
  }
  return params;
}

function printHelp() {
  console.log(`
==================================================================
  WHATSAPP AUTOMATOR - ADMIN COMMERCIAL LICENSE GENERATOR
==================================================================

Usage:
  node scripts/admin_generate_license.js [options]

Options:
  --email <email>        Customer email address (e.g. client@domain.com)
  --name <name>          Customer / Company name (e.g. "Acme Corp")
  --machine <machineId>  Hardware Node-Lock ID (e.g. WA-WIN-XXXX-XXXX-XXXX-XXXX)
                         (Use '*' to generate a portable floating license)
  --days <days>          Validity duration in days (e.g. 30, 90, 365). Default: 365
  --expiry <YYYY-MM-DD>  Exact expiration date (overrides --days)
  --tier <tier>          Tier name ("Pro Desktop", "Enterprise Desktop"). Default: "Pro Desktop"
  --sessions <number>    Max concurrent WhatsApp profile seats. Default: 5
  --grace <days>         Offline grace period in days. Default: 14
  --decode <key>         Inspect and decode an existing WALIC license key

Examples:
  # Generate a 1-year node-locked license for a client:
  node scripts/admin_generate_license.js --email client@company.com --machine WA-WIN-A1B2-C3D4-E5F6-7890 --days 365 --sessions 5

  # Generate a 30-day trial license:
  node scripts/admin_generate_license.js --email user@gmail.com --machine WA-WIN-A1B2-C3D4-E5F6-7890 --days 30 --sessions 2

  # Inspect an existing license key:
  node scripts/admin_generate_license.js --decode WALIC.ey...
==================================================================
`);
}

async function main() {
  const params = parseArgs();

  // If decoding an existing key
  if (params.decode) {
    const key = typeof params.decode === 'string' ? params.decode : process.argv[3];
    if (!key || !key.startsWith('WALIC.')) {
      console.error('Error: Please provide a valid WALIC token to decode.');
      process.exit(1);
    }
    const parts = key.split('.');
    try {
      const payloadStr = fromBase64Url(parts[1]).toString('utf8');
      const payload = JSON.parse(payloadStr);
      console.log('\n=== DECODED LICENSE DETAILS ===');
      console.log(JSON.stringify(payload, null, 2));
      console.log('===============================\n');
    } catch (e) {
      console.error('Failed to decode key:', e.message);
    }
    return;
  }

  if (params.help || (!params.email && !params.name && !params.machine)) {
    printHelp();
    return;
  }

  const email = params.email || 'customer@example.com';
  const name = params.name || email;
  const customerLabel = `${name} <${email}>`;
  const machineId = params.machine || '*';
  const tier = params.tier || 'Pro Desktop';
  const maxSessions = parseInt(params.sessions) || 5;
  const gracePeriodDays = parseInt(params.grace) || 14;

  let expiryDate;
  if (params.expiry) {
    expiryDate = new Date(params.expiry).toISOString();
  } else {
    const days = parseInt(params.days) || 365;
    expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const licenseKey = createLicenseKey({
    customer: customerLabel,
    licenseType: tier,
    expiryDate,
    nodeLockId: machineId,
    gracePeriodDays,
    maxSessions
  });

  console.log(`
==================================================================
  ✅ LICENSE KEY GENERATED SUCCESSFULLY!
==================================================================

Client Email   : ${email}
Customer Name  : ${name}
Target Machine : ${machineId === '*' ? 'ANY (Floating License)' : machineId}
Plan Tier      : ${tier}
WhatsApp Slots : ${maxSessions} Profiles
Expiry Date    : ${expiryDate.split('T')[0]} (${Math.round((new Date(expiryDate) - Date.now()) / (1000 * 60 * 60 * 24))} days)
Grace Period   : ${gracePeriodDays} Days

------------------------------------------------------------------
🔑 COMMERCIAL LICENSE KEY (Provide this to your customer):
------------------------------------------------------------------
${licenseKey}
------------------------------------------------------------------

Instruction for client:
1. Open the WhatsApp Automator app.
2. Go to Settings > Pro Desktop License Manager.
3. Paste the key above and click "Activate License Key".
==================================================================
`);
}

main();
