import assert from 'assert';
import { buildSpintaxFromMessages, parseSpintax } from './services/antiBanService.js';

async function testSpintaxStudio() {
  console.log('====================================================');
  console.log('       SPINTAX MESSAGE FUSION STUDIO TESTS');
  console.log('====================================================\n');

  // Test 1: Full Message Rotation with 3 variations
  console.log('--- 1. Testing Full Message Rotation (3 Messages) ---');
  const msgs3 = [
    'Hey {{name}}, check out our summer sale with 20% discount!',
    'Hello {{name}}, don\'t miss our exclusive summer deals with 20% off!',
    'Hi {{name}}, we have a special summer offer just for you: save 20% today!'
  ];

  const fullSpintax = buildSpintaxFromMessages(msgs3, 'full');
  console.log('Full Spintax Output:\n', fullSpintax);
  assert(fullSpintax.startsWith('{') && fullSpintax.endsWith('}'), 'Full spintax must be enclosed in brackets');
  assert(fullSpintax.includes('|'), 'Full spintax must contain pipe separators');

  const parsedSample1 = parseSpintax(fullSpintax);
  console.log('Parsed Random Sample 1:', parsedSample1);
  assert(msgs3.includes(parsedSample1), 'Parsed sample must match one of the 3 original message variations');
  console.log('✅ Full message rotation verified.');

  // Test 2: Multi-Message Rotation with 5 variations
  console.log('\n--- 2. Testing 5 Message Variations ---');
  const msgs5 = [
    'Msg 1: Special offer for {{company}}',
    'Msg 2: Exclusive discounts for {{company}}',
    'Msg 3: Limited time savings for {{company}}',
    'Msg 4: Premium deal for {{company}}',
    'Msg 5: VIP access for {{company}}'
  ];

  const spintax5 = buildSpintaxFromMessages(msgs5, 'full');
  assert(spintax5 === `{${msgs5.join('|')}}`, '5-message spintax matches expected structure');

  // Generate 20 samples to verify all variations can be selected
  const chosenVariations = new Set();
  for (let i = 0; i < 50; i++) {
    chosenVariations.add(parseSpintax(spintax5));
  }
  console.log(`Unique variations generated over 50 iterations: ${chosenVariations.size} / 5`);
  assert(chosenVariations.size > 1, 'Randomizer must pick multiple variations');
  console.log('✅ 5-message spintax rotation verified.');

  // Test 3: Sentence & Line Fusion Mode
  console.log('\n--- 3. Testing Sentence & Line-by-Line Fusion Mode ---');
  const multilineMsgs = [
    'Hello {{name}}!\nWe have a special discount for {{company}}.\nClick here to claim: https://example.com',
    'Hi {{name}},\nExclusive deals are waiting for {{company}}.\nVisit our website to get 20% off: https://example.com'
  ];

  const lineFusedSpintax = buildSpintaxFromMessages(multilineMsgs, 'sentence');
  console.log('Line-Fused Spintax Output:\n', lineFusedSpintax);
  assert(lineFusedSpintax.includes('{Hello {{name}}!|Hi {{name}},}'), 'Header lines fused');
  assert(lineFusedSpintax.includes('{We have a special discount for {{company}}.|Exclusive deals are waiting for {{company}}.}'), 'Body lines fused');

  const fusedSample = parseSpintax(lineFusedSpintax);
  console.log('Parsed Fused Sample:\n', fusedSample);
  assert(fusedSample.includes('https://example.com'), 'CTA line included in output');
  console.log('✅ Sentence and line-by-line fusion verified.');

  // Test 4: API Combine Endpoint Live Call
  console.log('\n--- 4. Testing API POST /api/anti-ban/spintax/combine ---');
  const apiRes = await fetch('http://localhost:5000/api/anti-ban/spintax/combine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: msgs3, mode: 'full' })
  });

  const apiJson = await apiRes.json();
  console.log('API Response Success:', apiJson.success);
  console.log('API Total Variations:', apiJson.totalVariations);
  console.log('API Generated Samples Count:', apiJson.samples?.length);
  assert(apiJson.success === true, 'API response must succeed');
  assert(apiJson.totalVariations === 3, 'API total variations matches 3');
  assert(apiJson.samples.length === 5, 'API returns 5 randomized preview samples');
  console.log('✅ API endpoint verified.');

  console.log('\n====================================================');
  console.log('   ALL SPINTAX STUDIO TESTS PASSED 100%!');
  console.log('====================================================\n');
}

testSpintaxStudio().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
