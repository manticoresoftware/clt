// Test WASM parameter passing issues

async function testParameterPassing() {
  console.log('🧪 Testing WASM parameter passing...');
  
  const { parseRecFileFromMapWasm } = await import('./ui/wasmNodeWrapper.js');
  const fs = await import('fs/promises');
  
  // Test 1: Very simple map
  console.log('\n📋 TEST 1: Very simple map');
  try {
    const simpleMap = {
      'test.rec': '––– input –––\necho hello\n––– output –––\nhello'
    };
    console.log(`Map size: ${JSON.stringify(simpleMap).length} chars`);
    
    const result1 = await parseRecFileFromMapWasm('test.rec', simpleMap);
    console.log(`✅ Simple map: ${result1.steps ? result1.steps.length : 0} steps`);
  } catch (error) {
    console.error(`❌ Simple map failed: ${error.message}`);
  }
  
  // Test 2: Real file content but smaller
  console.log('\n📋 TEST 2: Real file content (truncated)');
  try {
    const realContent = await fs.readFile('/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/bugs/3037-secondary-indexes-bug.rec', 'utf8');
    const truncatedContent = realContent.substring(0, 500); // First 500 chars only
    
    const truncatedMap = {
      '3037-secondary-indexes-bug.rec': truncatedContent
    };
    console.log(`Map size: ${JSON.stringify(truncatedMap).length} chars`);
    
    const result2 = await parseRecFileFromMapWasm('3037-secondary-indexes-bug.rec', truncatedMap);
    console.log(`✅ Truncated real file: ${result2.steps ? result2.steps.length : 0} steps`);
  } catch (error) {
    console.error(`❌ Truncated real file failed: ${error.message}`);
  }
  
  // Test 3: Real file content full size
  console.log('\n📋 TEST 3: Real file content (full size)');
  try {
    const realContent = await fs.readFile('/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/bugs/3037-secondary-indexes-bug.rec', 'utf8');
    
    const fullMap = {
      '3037-secondary-indexes-bug.rec': realContent
    };
    console.log(`Map size: ${JSON.stringify(fullMap).length} chars`);
    
    const result3 = await parseRecFileFromMapWasm('3037-secondary-indexes-bug.rec', fullMap);
    console.log(`✅ Full real file: ${result3.steps ? result3.steps.length : 0} steps`);
  } catch (error) {
    console.error(`❌ Full real file failed: ${error.message}`);
  }
  
  // Test 4: Real file with block file
  console.log('\n📋 TEST 4: Real file with block file');
  try {
    const realContent = await fs.readFile('/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/bugs/3037-secondary-indexes-bug.rec', 'utf8');
    const blockContent = await fs.readFile('/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/base/start-searchd.recb', 'utf8');
    
    const fullMapWithBlock = {
      '3037-secondary-indexes-bug.rec': realContent,
      '../base/start-searchd.recb': blockContent
    };
    console.log(`Map size: ${JSON.stringify(fullMapWithBlock).length} chars`);
    console.log(`Map keys: ${Object.keys(fullMapWithBlock).join(', ')}`);
    
    const result4 = await parseRecFileFromMapWasm('3037-secondary-indexes-bug.rec', fullMapWithBlock);
    console.log(`✅ Full file with block: ${result4.steps ? result4.steps.length : 0} steps`);
  } catch (error) {
    console.error(`❌ Full file with block failed: ${error.message}`);
  }
  
  // Test 5: Check for special characters
  console.log('\n📋 TEST 5: Check for problematic characters');
  try {
    const realContent = await fs.readFile('/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/bugs/3037-secondary-indexes-bug.rec', 'utf8');
    
    // Check for potentially problematic characters
    const problematicChars = [];
    for (let i = 0; i < realContent.length; i++) {
      const char = realContent[i];
      const code = char.charCodeAt(0);
      if (code > 127 || code < 32 && code !== 10 && code !== 13 && code !== 9) {
        problematicChars.push({ char, code, pos: i });
      }
    }
    
    console.log(`Found ${problematicChars.length} potentially problematic characters`);
    if (problematicChars.length > 0) {
      console.log('First few:', problematicChars.slice(0, 5));
    }
    
  } catch (error) {
    console.error(`❌ Character check failed: ${error.message}`);
  }
  
  // Test 6: Multiple rapid calls (race condition)
  console.log('\n📋 TEST 6: Multiple rapid calls');
  try {
    const simpleMap = {
      'test.rec': '––– input –––\necho hello\n––– output –––\nhello'
    };
    
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(parseRecFileFromMapWasm('test.rec', simpleMap));
    }
    
    const results = await Promise.all(promises);
    console.log(`✅ Multiple calls: All ${results.length} calls succeeded`);
    
  } catch (error) {
    console.error(`❌ Multiple calls failed: ${error.message}`);
  }
}

testParameterPassing().catch(console.error);