# Manticore Test Editor

A UI application for editing and validating Manticore test files with .rec extension.

## Features

- File tree explorer for navigating and managing .rec files
- Editor for test commands and expected outputs
- Docker image configuration for test validation
- Support for subdirectories
- GitHub authentication with user access control

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- GitHub OAuth application (for authentication)

### Installation

```bash
# Navigate to the ui directory
cd ui

# Install dependencies
npm install

# Create .env file from the example
cp .env.example .env

# Edit the .env file with your GitHub OAuth credentials and allowed usernames

# Start the development server
npm run dev
```

The application will be available at http://localhost:5173/ (or another port if 5173 is in use).

## Authentication Configuration

The application uses GitHub OAuth for authentication. You need to configure the following:

1. Create a GitHub OAuth application at https://github.com/settings/developers
2. Set the callback URL to `http://localhost:3000/auth/github/callback` (or your custom domain)
3. Configure the `.env` file with your OAuth credentials:

```
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
ALLOWED_GITHUB_USERS=username1,username2,username3
```

### Development Mode

For development without authentication, you can set:

```
SKIP_AUTH=true
```

This will bypass the authentication check and allow you to access the application without logging in.

## Usage

1. Log in with your GitHub account (if authentication is enabled)
2. The file explorer on the left shows available .rec files
3. Click on a file to open it in the editor
4. Add commands and expected outputs
5. Configure the Docker image at the top for validation
6. Save files as needed

## Development

### Building for Production

```bash
npm run build
```

This will create a production-ready build in the `dist` directory.

### Running Tests

```bash
npm run test
```

## Project Structure

- `src/components/` - Svelte components
- `src/stores/` - Svelte stores for state management
- `src/lib/` - Utility functions
- `config/` - Application configuration