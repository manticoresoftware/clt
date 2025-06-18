// Simple test for block resolution regex
import fs from 'fs/promises';

async function testBlockRegex() {
  console.log('🧪 Testing block reference regex...');
  
  const testFilePath = '/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/bugs/3037-secondary-indexes-bug.rec';
  
  try {
    const content = await fs.readFile(testFilePath, 'utf8');
    console.log('📝 File content (first 300 chars):');
    console.log(content.substring(0, 300));
    console.log('...\n');
    
    // Test the regex pattern
    const blockRegex = /–––\s*block:\s*([^–]+)\s*–––/g;
    let match;
    const foundBlocks = [];
    
    while ((match = blockRegex.exec(content)) !== null) {
      const blockPath = match[1].trim();
      foundBlocks.push(blockPath);
      console.log(`🔍 Found block reference: "${blockPath}"`);
    }
    
    if (foundBlocks.length === 0) {
      console.log('❌ No block references found with regex');
      console.log('Let me try a simpler search...');
      
      // Try simpler search
      if (content.includes('block:')) {
        console.log('✅ Found "block:" in content');
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (line.includes('block:')) {
            console.log(`Line ${i + 1}: ${line}`);
          }
        });
      }
    } else {
      console.log(`✅ Found ${foundBlocks.length} block references:`, foundBlocks);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testBlockRegex();