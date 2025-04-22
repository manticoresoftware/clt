// API endpoint to create GitHub PR
app.post('/api/create-pr', isAuthenticated, async (req, res) => {
	try {
		const { title, description } = req.body;
		
		if (!title) {
			return res.status(400).json({ error: 'PR title is required' });
		}

		// Check if user is authenticated with GitHub
		if (!req.user || !req.user.username) {
			return res.status(401).json({ error: 'GitHub authentication required' });
		}

		// Create a new branch name based on timestamp and username
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const branchName = `clt-ui-${req.user.username}-${timestamp}`;

		// Check if git and gh CLI are available
		const { exec } = await import('child_process');
		const execPromise = (cmd, options) => new Promise((resolve, reject) => {
			exec(cmd, options, (error, stdout, stderr) => {
				if (error) {
					console.error(`Command execution error: ${stderr}`);
					return reject(error);
				}
				resolve(stdout.trim());
			});
		});

		// Get the tests directory path and resolve if it's a symlink
		const testsDir = path.join(ROOT_DIR, 'tests');
		let actualTestsDir = testsDir;
		let isSymlink = false;

		try {
			// Check if tests dir is a symlink
			const testsDirStats = await fs.lstat(testsDir);
			if (testsDirStats.isSymbolicLink()) {
				isSymlink = true;
				// Get symlink target
				const symlinkTarget = await fs.readlink(testsDir);
				// Resolve to absolute path if needed
				actualTestsDir = path.isAbsolute(symlinkTarget) ? 
					symlinkTarget : path.resolve(path.dirname(testsDir), symlinkTarget);
				console.log(`Tests directory is a symlink pointing to ${actualTestsDir}`);
			}
		} catch (err) {
			console.error('Error checking tests directory:', err);
			return res.status(500).json({ error: 'Failed to access tests directory' });
		}

		// Check if tests directory is a git repository or inside one
		try {
			// Change to the actual tests directory
			process.chdir(actualTestsDir);

			// Check if git is available
			await execPromise('git --version');

			// Try to get the git repo root
			const gitRoot = await execPromise('git rev-parse --show-toplevel');
			console.log(`Git repository found at: ${gitRoot}`);

			// Change to the git root directory
			process.chdir(gitRoot);

			// Get the current branch
			const currentBranch = await execPromise('git rev-parse --abbrev-ref HEAD');
			console.log(`Current branch: ${currentBranch}`);

			// Get current repository information
			const remoteUrl = await execPromise('git config --get remote.origin.url');
			console.log(`Remote repository URL: ${remoteUrl}`);

			// Create a new branch
			await execPromise(`git checkout -b ${branchName}`);
			console.log(`Created and switched to new branch: ${branchName}`);

			// Stage all changes in the tests directory
			// If we're using a symlink, we need to stage the actual directory inside the repo
			const pathToStage = isSymlink ? 
				// If symlink, find the relative path from the git root to the actual tests directory
				path.relative(gitRoot, actualTestsDir) : 
				// If not symlink, use the standard relative path
				path.relative(gitRoot, testsDir);
			
			await execPromise(`git add ${pathToStage}`);
			console.log(`Staged changes in tests directory (${pathToStage})`);

			// Create a commit
			await execPromise(`git commit -m "${title}"`);
			console.log(`Created commit with message: ${title}`);

			// Check if gh CLI is available
			try {
				await execPromise('gh --version');
				console.log('GitHub CLI is available');

				// Push to the remote repository
				await execPromise(`git push -u origin ${branchName}`);
				console.log(`Pushed to remote branch: ${branchName}`);

				// Create a PR using gh CLI
				let prCommand = `gh pr create --title "${title}" --head ${branchName}`;
				
				// Add description if provided
				if (description) {
					prCommand += ` --body "${description}"`;
				}
				
				// Add default base branch
				prCommand += ` --base ${currentBranch}`;

				// Create the PR
				const prOutput = await execPromise(prCommand);
				console.log('PR created successfully');

				// Extract PR URL from the output
				const prUrlMatch = prOutput.match(/(https:\/\/github\.com\/[^\s]+)/);
				const prUrl = prUrlMatch ? prUrlMatch[0] : null;

				// Return success response with PR info
				return res.json({
					success: true,
					branch: branchName,
					commit: title,
					pr: prUrl,
					repoUrl: remoteUrl,
					message: 'Pull request created successfully'
				});
			} catch (ghError) {
				console.error('Error using GitHub CLI:', ghError);
				
				// Push to the remote repository anyway
				await execPromise(`git push -u origin ${branchName}`);
				console.log(`Pushed to remote branch: ${branchName}`);
				
				// GitHub CLI not available, but we still pushed the branch
				return res.json({
					success: true,
					branch: branchName,
					commit: title,
					repoUrl: remoteUrl,
					message: 'Changes pushed to new branch. Please create PR manually.',
					info: 'GitHub CLI not available for automatic PR creation'
				});
			}
		} catch (gitError) {
			console.error('Git operation error:', gitError);
			return res.status(500).json({
				error: 'Git operation failed',
				details: gitError.message
			});
		} finally {
			// Change back to the original directory
			process.chdir(ROOT_DIR);
		}
	} catch (error) {
		console.error('Error creating PR:', error);
		res.status(500).json({ error: `Failed to create PR: ${error.message}` });
	}
});