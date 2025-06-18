// Debug exact keys that WASM looks for

async function debugWasmKeys() {
  console.log('🔍 Debugging WASM key resolution...');
  
  const { parseRecFileFromMapWasm } = await import('./ui/wasmNodeWrapper.js');
  const fs = await import('fs/promises');
  
  // Read the actual file content to see the exact block reference
  const realContent = await fs.readFile('/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/bugs/3037-secondary-indexes-bug.rec', 'utf8');
  
  console.log('📄 File content analysis:');
  const lines = realContent.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('block:')) {
      console.log(`Line ${i + 1}: "${line}"`);
      // Extract the block path
      const match = line.match(/block:\s*(.+?)\s*–––/);
      if (match) {
        console.log(`  → Extracted block path: "${match[1]}"`);
        console.log(`  → Expected key: "${match[1]}.recb"`);
      }
    }
  });
  
  // Test with different key variations
  const blockContent = await fs.readFile('/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/base/start-searchd.recb', 'utf8');
  
  const testVariations = [
    {
      name: 'Original key',
      map: {
        '3037-secondary-indexes-bug.rec': realContent,
        '../base/start-searchd.recb': blockContent
      }
    },
    {
      name: 'Without ../',
      map: {
        '3037-secondary-indexes-bug.rec': realContent,
        'base/start-searchd.recb': blockContent
      }
    },
    {
      name: 'Just filename',
      map: {
        '3037-secondary-indexes-bug.rec': realContent,
        'start-searchd.recb': blockContent
      }
    },
    {
      name: 'Absolute path',
      map: {
        '3037-secondary-indexes-bug.rec': realContent,
        '/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/base/start-searchd.recb': blockContent
      }
    },
    {
      name: 'Multiple keys (shotgun approach)',
      map: {
        '3037-secondary-indexes-bug.rec': realContent,
        '../base/start-searchd.recb': blockContent,
        'base/start-searchd.recb': blockContent,
        'start-searchd.recb': blockContent
      }
    }
  ];
  
  for (const variation of testVariations) {
    console.log(`\n🧪 Testing: ${variation.name}`);
    console.log(`Keys in map: ${Object.keys(variation.map).filter(k => k.endsWith('.recb')).join(', ')}`);
    
    try {
      const result = await parseRecFileFromMapWasm('3037-secondary-indexes-bug.rec', variation.map);
      console.log(`✅ Success: ${result.steps ? result.steps.length : 0} steps`);
    } catch (error) {
      console.error(`❌ Failed: ${error.message}`);
    }
  }
  
  // Test multiple times to check for intermittent issues
  console.log('\n🔄 Testing consistency (5 runs with working key):');
  const workingMap = {
    '3037-secondary-indexes-bug.rec': realContent,
    '../base/start-searchd.recb': blockContent
  };
  
  for (let i = 1; i <= 5; i++) {
    try {
      const result = await parseRecFileFromMapWasm('3037-secondary-indexes-bug.rec', workingMap);
      console.log(`Run ${i}: ✅ ${result.steps ? result.steps.length : 0} steps`);
    } catch (error) {
      console.log(`Run ${i}: ❌ ${error.message}`);
    }
  }
}

debugWasmKeys().catch(console.error);