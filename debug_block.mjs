import fs from 'fs/promises';
import path from 'path';

async function debugBlockResolution() {
  const testFilePath = '/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/core/test-auto-schema.rec';
  const baseDir = '/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests';
  
  console.log('🧪 Debugging block resolution...');
  
  // Read the main file
  const content = await fs.readFile(testFilePath, 'utf8');
  console.log('📝 File content (first 200 chars):');
  console.log(content.substring(0, 200));
  
  // Test block regex
  const blockRegex = /–––\s*block:\s*([^–]+)\s*–––/g;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const blockPath = match[1].trim();
    console.log('\n🔍 Found block reference:', JSON.stringify(blockPath));
    
    // Test path resolution
    const mainFileDir = path.dirname(testFilePath);
    console.log('📂 Main file dir:', mainFileDir);
    
    const blockFileName = blockPath.endsWith('.recb') ? blockPath : `${blockPath}.recb`;
    const resolvedBlockPath = path.resolve(mainFileDir, blockFileName);
    console.log('📂 Resolved block path:', resolvedBlockPath);
    
    // Check if file exists
    try {
      await fs.access(resolvedBlockPath);
      console.log('✅ Block file exists!');
      
      const blockContent = await fs.readFile(resolvedBlockPath, 'utf8');
      console.log('📄 Block content length:', blockContent.length);
      console.log('📄 Block content (first 100 chars):', blockContent.substring(0, 100));
      
      // Show what key would be stored in fileMap
      console.log('🗝️  File map key would be:', JSON.stringify(blockPath));
      
    } catch (error) {
      console.log('❌ Block file does not exist:', error.message);
    }
  }
}

debugBlockResolution().catch(console.error);