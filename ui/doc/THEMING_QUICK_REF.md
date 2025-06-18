# Quick Theme Customization Reference

## Current Implementation

**Light Mode**: BBEdit Theme (`@uiw/codemirror-theme-bbedit`)  
**Dark Mode**: One Dark Theme (`@codemirror/theme-one-dark`)

Uses pre-built themes from [@uiw/codemirror-themes](https://www.npmjs.com/package/@uiw/codemirror-themes) package.

## Quick Theme Changes

### 1. Switch to Different Pre-built Themes

```bash
# Install new theme package
cd ui
npm install @uiw/codemirror-theme-[theme-name]
```

```javascript
// Update imports in CodeMirrorInput.svelte and SimpleCodeMirror.svelte
import { newTheme } from '@uiw/codemirror-theme-[theme-name]';

// Update getTheme() function
function getTheme() {
  return isDarkMode ? darkTheme : lightTheme;
}
```

### 2. Popular Theme Combinations

```javascript
// GitHub Style
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';

// Material Design
import { materialLight, materialDark } from '@uiw/codemirror-theme-material';

// VS Code Style
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { bbedit } from '@uiw/codemirror-theme-bbedit'; // Light alternative
```

## Available Themes

### Light Themes
- `@uiw/codemirror-theme-bbedit` ⭐ **Current**
- `@uiw/codemirror-theme-github`
- `@uiw/codemirror-theme-xcode`
- `@uiw/codemirror-theme-eclipse`
- `@uiw/codemirror-theme-material`

### Dark Themes  
- `@codemirror/theme-one-dark` ⭐ **Current**
- `@uiw/codemirror-theme-atom-one`
- `@uiw/codemirror-theme-dracula`
- `@uiw/codemirror-theme-tokyo-night`
- `@uiw/codemirror-theme-nord`

## Testing Changes

```bash
cd ui
npm run dev    # Test in development
npm run build  # Verify build works
```

## Files to Modify

- `ui/src/components/CodeMirrorInput.svelte` - Main command input
- `ui/src/components/SimpleCodeMirror.svelte` - Block/comment input

## Theme Gallery

Visit [Theme Gallery](https://uiwjs.github.io/react-codemirror/#/theme/doc) to preview all available themes.

## Custom Themes

For advanced customization, use the `createTheme` function:

```javascript
import { createTheme } from '@uiw/codemirror-themes';

const customTheme = createTheme({
  theme: 'light', // or 'dark'
  settings: {
    background: '#ffffff',
    foreground: '#333333',
    // ... more settings
  },
  styles: [
    { tag: t.keyword, color: '#d73a49' },
    { tag: t.string, color: '#032f62' },
    // ... more styles
  ],
});
```

## Full Documentation

See [THEMING.md](./THEMING.md) for complete guide with examples, troubleshooting, and best practices.