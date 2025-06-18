// Test WASM parsing to debug the issue

async function runTest() {
  const { parseRecFileFromMapWasm } = await import('./ui/wasmNodeWrapper.js');

  console.log('🧪 Testing WASM parsing...');

  // Test data - simple .rec file content
  const testContent = `This is a test description

––– input –––
echo "hello world"
––– output –––
hello world
`;

  // Create file map
  const fileMap = {
    'test.rec': testContent
  };

  try {
    console.log('📝 Input content:');
    console.log(testContent);
    console.log('\n📦 File map:');
    console.log(JSON.stringify(fileMap, null, 2));

    const result = await parseRecFileFromMapWasm('test.rec', fileMap);

    console.log('\n✅ WASM Result:');
    console.log(JSON.stringify(result, null, 2));

    if (!result.steps || result.steps.length === 0) {
      console.error('❌ WASM returned empty steps! This is the bug!');
    } else {
      console.log('✅ WASM parsing worked correctly');
    }

  } catch (error) {
    console.error('❌ WASM parsing failed:');
    console.error(error);
  }
}

async function testWasmParsing() {
  await runTest();
}

testWasmParsing().catch(console.error);
