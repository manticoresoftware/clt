// Test the enhanced block resolution in createFileContentMap
import { createFileContentMap } from './server.js';
import path from 'path';

async function testBlockResolution() {
  console.log('🧪 Testing enhanced block resolution...');
  
  const testFilePath = '/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/bugs/3037-secondary-indexes-bug.rec';
  const baseDir = '/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests';
  
  try {
    const fileMap = await createFileContentMap(testFilePath, baseDir);
    
    console.log('✅ File map created successfully!');
    console.log(`📁 Total files in map: ${Object.keys(fileMap).length}`);
    console.log('📋 File map keys:');
    Object.keys(fileMap).forEach(key => {
      console.log(`  - ${key} (${fileMap[key].length} chars)`);
    });
    
    // Check if the problematic block file is resolved
    if (fileMap['../base/start-searchd']) {
      console.log('✅ Block reference "../base/start-searchd" resolved successfully!');
    } else {
      console.log('❌ Block reference "../base/start-searchd" NOT found in file map');
      console.log('Available keys:', Object.keys(fileMap));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testBlockResolution();