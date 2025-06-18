// Test WASM initialization race condition

async function testWasmInit() {
  console.log('🧪 Testing WASM initialization race condition...');
  
  // Import the wrapper
  const { parseRecFileFromMapWasm } = await import('./ui/wasmNodeWrapper.js');
  
  // Simple test content
  const testContent = `––– input –––
echo "hello"

––– output –––
hello
`;

  const fileMap = { 'test.rec': testContent };
  
  // Test 1: Single call
  console.log('\n📋 TEST 1: Single call');
  try {
    const result1 = await parseRecFileFromMapWasm('test.rec', fileMap);
    console.log(`✅ Single call: ${result1.steps ? result1.steps.length : 0} steps`);
  } catch (error) {
    console.error(`❌ Single call failed: ${error.message}`);
  }
  
  // Test 2: Multiple simultaneous calls (race condition test)
  console.log('\n📋 TEST 2: Multiple simultaneous calls');
  try {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(parseRecFileFromMapWasm('test.rec', fileMap));
    }
    
    const results = await Promise.all(promises);
    console.log(`✅ Simultaneous calls: All ${results.length} calls succeeded`);
    
    // Check if all results are consistent
    const stepCounts = results.map(r => r.steps ? r.steps.length : 0);
    const allSame = stepCounts.every(count => count === stepCounts[0]);
    
    if (allSame) {
      console.log(`✅ Consistent results: All returned ${stepCounts[0]} steps`);
    } else {
      console.warn(`⚠️  Inconsistent results: ${stepCounts.join(', ')} steps`);
    }
    
  } catch (error) {
    console.error(`❌ Simultaneous calls failed: ${error.message}`);
  }
  
  // Test 3: Check available functions
  console.log('\n📋 TEST 3: Check WASM functions');
  try {
    const wasmModule = await import('./ui/pkg/wasm.js');
    await wasmModule.default();
    
    console.log('Available WASM functions:');
    const functions = Object.keys(wasmModule).filter(key => typeof wasmModule[key] === 'function');
    functions.forEach(fn => console.log(`  - ${fn}`));
    
    if (wasmModule.read_test_file_from_map_wasm) {
      console.log('✅ read_test_file_from_map_wasm is available');
    } else {
      console.error('❌ read_test_file_from_map_wasm is NOT available');
    }
    
    if (wasmModule.write_test_file_to_map_wasm) {
      console.log('✅ write_test_file_to_map_wasm is available');
    } else {
      console.error('❌ write_test_file_to_map_wasm is NOT available');
    }
    
  } catch (error) {
    console.error(`❌ Function check failed: ${error.message}`);
  }
}

testWasmInit().catch(console.error);