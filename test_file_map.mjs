import fs from 'fs/promises';
import path from 'path';

// Copy the resolveBlockReferences function to test it
async function resolveBlockReferences(content, mainFilePath, baseDir, fileMap) {
	const blockRegex = /–––\s*block:\s*([^–]+)\s*–––/g;
	let match;
	
	while ((match = blockRegex.exec(content)) !== null) {
		const blockPath = match[1].trim();
		console.log(`🔍 Found block reference: "${blockPath}"`);
		
		const mainFileDir = path.dirname(mainFilePath);
		let resolvedBlockPath;
		
		if (blockPath.includes('/')) {
			const blockFileName = blockPath.endsWith('.recb') ? blockPath : `${blockPath}.recb`;
			resolvedBlockPath = path.resolve(mainFileDir, blockFileName);
		} else {
			const blockFileName = blockPath.endsWith('.recb') ? blockPath : `${blockPath}.recb`;
			resolvedBlockPath = path.join(mainFileDir, blockFileName);
		}
		
		console.log(`📂 Resolved block path: ${resolvedBlockPath}`);
		
		// Create the key that WASM expects (with .recb extension)
		const wasmExpectedKey = blockPath.endsWith('.recb') ? blockPath : `${blockPath}.recb`;
		console.log(`🗝️  WASM expected key: ${wasmExpectedKey}`);
		
		if (!fileMap[wasmExpectedKey]) {
			try {
				await fs.access(resolvedBlockPath);
				const blockContent = await fs.readFile(resolvedBlockPath, 'utf8');
				fileMap[wasmExpectedKey] = blockContent;
				console.log(`✅ Added block: ${wasmExpectedKey} (${blockContent.length} chars)`);
			} catch (error) {
				console.error(`❌ Could not read block file: ${error.message}`);
			}
		}
	}
}

async function testFileMapCreation() {
	console.log('🧪 Testing file map creation...');
	
	const testFilePath = '/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests/core/test-auto-schema.rec';
	const baseDir = '/Users/dk/Work/dev/manticore/clt/ui/workdir/donhardman/test/clt-tests';
	
	const fileMap = {};
	
	// Read main file
	const mainContent = await fs.readFile(testFilePath, 'utf8');
	const relativePath = path.relative(baseDir, testFilePath);
	fileMap[relativePath] = mainContent;
	console.log(`📄 Added main file: ${relativePath}`);
	
	// Resolve block references
	await resolveBlockReferences(mainContent, testFilePath, baseDir, fileMap);
	
	console.log('\n📋 Final file map:');
	Object.keys(fileMap).forEach(key => {
		console.log(`  - ${key} (${fileMap[key].length} chars)`);
	});
	
	// Test what WASM is looking for
	const wasmLookingFor = '../base/start-searchd.recb';
	if (fileMap[wasmLookingFor]) {
		console.log(`\n✅ SUCCESS: WASM key "${wasmLookingFor}" found in file map!`);
	} else {
		console.log(`\n❌ FAILURE: WASM key "${wasmLookingFor}" NOT found in file map`);
		console.log('Available keys:', Object.keys(fileMap));
	}
}

testFileMapCreation().catch(console.error);