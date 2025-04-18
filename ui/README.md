# Manticore Test Editor

A UI application for editing and validating Manticore test files with .rec extension.

## Features

- File tree explorer for navigating and managing .rec files
- Editor for test commands and expected outputs
- Docker image configuration for test validation
- Support for subdirectories

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

```bash
# Navigate to the ui directory
cd ui

# Install dependencies
npm install

# Start the development server
npm run dev
```

The application will be available at http://localhost:5173/ (or another port if 5173 is in use).

## Usage

1. The file explorer on the left shows available .rec files
2. Click on a file to open it in the editor
3. Add commands and expected outputs
4. Configure the Docker image at the top for validation
5. Save files as needed

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