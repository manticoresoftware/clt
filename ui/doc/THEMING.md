# CodeMirror Theming Guide for CLT UI

This document provides comprehensive information about the theming system for command syntax highlighting in the CLT UI, including how to configure, customize, and extend themes.

## Overview

The CLT UI uses CodeMirror 6 for syntax highlighting in command input fields. The theming system automatically switches between light and dark themes based on the user's system preference (`prefers-color-scheme`).

**Current Implementation**: Uses pre-built themes from the [@uiw/codemirror-themes](https://www.npmjs.com/package/@uiw/codemirror-themes) package for optimal shell syntax highlighting.

## Architecture

### Theme Detection
- **Automatic Detection**: Uses `window.matchMedia('(prefers-color-scheme: dark)')` to detect user preference
- **Real-time Switching**: Listens for theme changes and updates the editor dynamically
- **Fallback**: Defaults to light theme if detection fails

### Current Theme Selection
- **Light Mode**: **BBEdit Theme** - Clean, professional light theme optimized for code readability
- **Dark Mode**: **One Dark Theme** - Popular dark theme with excellent contrast

### Theme Components
1. **Base Theme**: Pre-built themes from @uiw packages
2. **Dynamic Reconfiguration**: Uses CodeMirror's Compartment API for live theme switching
3. **Shell Syntax Support**: Themes are optimized for shell/bash syntax highlighting

## File Structure

```
ui/src/components/
├── CodeMirrorInput.svelte    # Main command input with syntax highlighting
├── SimpleCodeMirror.svelte   # Simplified version for blocks/comments
```

## Current Theme Configuration

### Implementation
```javascript
// Theme imports
import { oneDark } from '@codemirror/theme-one-dark';
import { bbedit } from '@uiw/codemirror-theme-bbedit';

// Dynamic theme selection
function getTheme() {
  return isDarkMode ? oneDark : bbedit;
}

// Real-time theme switching
mediaQuery.addEventListener('change', (e) => {
  isDarkMode = e.matches;
  editorView.dispatch({
    effects: themeCompartment.reconfigure(getTheme())
  });
});
```

### Why These Themes?

#### BBEdit Theme (Light Mode)
- ✅ **Professional appearance** - Clean, minimal design
- ✅ **Excellent contrast** - High readability for shell commands
- ✅ **Optimized syntax colors** - Well-balanced color palette
- ✅ **Shell-friendly** - Good highlighting for commands, strings, operators

#### One Dark Theme (Dark Mode)  
- ✅ **Popular choice** - Widely used and tested
- ✅ **Eye-friendly** - Reduced strain in low-light environments
- ✅ **Comprehensive highlighting** - Full syntax support
- ✅ **Consistent experience** - Matches many developer tools

## Available Pre-built Themes

All themes from [@uiw/codemirror-themes](https://www.npmjs.com/package/@uiw/codemirror-themes) are available:

### Recommended Light Themes
| Theme | Package | Best For |
|-------|---------|----------|
| **BBEdit** ⭐ | `@uiw/codemirror-theme-bbedit` | **Current choice** - Professional, clean |
| GitHub Light | `@uiw/codemirror-theme-github` | GitHub-style interface |
| XCode Light | `@uiw/codemirror-theme-xcode` | Apple ecosystem integration |
| Eclipse | `@uiw/codemirror-theme-eclipse` | IDE-style appearance |
| Material Light | `@uiw/codemirror-theme-material` | Material Design aesthetic |

### Recommended Dark Themes
| Theme | Package | Best For |
|-------|---------|----------|
| **One Dark** ⭐ | `@codemirror/theme-one-dark` | **Current choice** - Popular, well-tested |
| Atom One | `@uiw/codemirror-theme-atom-one` | Atom editor style |
| Dracula | `@uiw/codemirror-theme-dracula` | High contrast, vibrant |
| Tokyo Night | `@uiw/codemirror-theme-tokyo-night` | Modern, stylish |
| Nord | `@uiw/codemirror-theme-nord` | Cool, arctic-inspired |

## How to Change Themes

### 1. Using Different Pre-built Themes

**Step 1**: Install the desired theme package
```bash
cd ui
npm install @uiw/codemirror-theme-[theme-name]
```

**Step 2**: Update imports in both components
```javascript
// In CodeMirrorInput.svelte and SimpleCodeMirror.svelte
import { newLightTheme } from '@uiw/codemirror-theme-[light-theme]';
import { newDarkTheme } from '@uiw/codemirror-theme-[dark-theme]';
```

**Step 3**: Update the getTheme() function
```javascript
function getTheme() {
  return isDarkMode ? newDarkTheme : newLightTheme;
}
```

### 2. Popular Theme Combinations

```javascript
// GitHub-style combination
import { githubLight } from '@uiw/codemirror-theme-github';
import { githubDark } from '@uiw/codemirror-theme-github';

// VS Code-style combination  
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { bbedit } from '@uiw/codemirror-theme-bbedit'; // Light alternative

// Material Design combination
import { materialLight } from '@uiw/codemirror-theme-material';
import { materialDark } from '@uiw/codemirror-theme-material';
```

### 3. Creating Custom Themes

For advanced customization, use the `createTheme` function:

```javascript
import { createTheme } from '@uiw/codemirror-themes';
import { tags as t } from '@lezer/highlight';

const customLightTheme = createTheme({
  theme: 'light',
  settings: {
    background: '#ffffff',
    foreground: '#333333',
    caret: '#5d00ff',
    selection: '#036dd626',
    gutterBackground: '#f5f5f5',
    gutterForeground: '#999999',
  },
  styles: [
    { tag: t.comment, color: '#6a737d' },
    { tag: t.keyword, color: '#d73a49' },
    { tag: t.string, color: '#032f62' },
    { tag: t.operator, color: '#005cc5' },
    { tag: t.variableName, color: '#6f42c1' },
  ],
});
```

## Shell Syntax Highlighting Details

The CLT UI uses the shell mode from `@codemirror/legacy-modes/mode/shell` which provides:

### Recognized Elements
- **Commands**: Built-in shell commands (`ls`, `grep`, `awk`, etc.)
- **Keywords**: Shell keywords (`if`, `then`, `else`, `fi`, etc.)
- **Strings**: Single and double-quoted strings
- **Comments**: Lines starting with `#`
- **Variables**: `$VAR`, `${VAR}`, `$1`, `$@`, etc.
- **Operators**: `|`, `>`, `>>`, `<`, `&&`, `||`, `;`
- **Numbers**: Numeric literals
- **Flags**: Command-line options (`-v`, `--verbose`)

### Theme Color Mapping
Pre-built themes automatically handle these elements with appropriate colors:
- Commands and keywords get primary accent colors
- Strings use secondary colors for distinction
- Comments are typically muted/gray
- Operators use bright colors for visibility
- Variables get special highlighting

## Testing Theme Changes

### 1. Development Testing
```bash
cd ui
npm run dev
```

### 2. Build Testing
```bash
cd ui
npm run build
```

### 3. Visual Testing Checklist
- [ ] Light mode syntax highlighting is readable
- [ ] Dark mode syntax highlighting is readable
- [ ] Theme switches properly when system preference changes
- [ ] All shell elements are properly colored
- [ ] No CSS conflicts with main UI theme
- [ ] Sufficient contrast for accessibility

## Troubleshooting

### Common Issues

1. **Theme not switching**
   - Check browser support for `prefers-color-scheme`
   - Verify media query listener is attached
   - Check console for JavaScript errors

2. **Theme not loading**
   - Ensure theme package is installed: `npm install @uiw/codemirror-theme-[name]`
   - Check import path matches package exports
   - Verify build process completes without errors

3. **Colors not as expected**
   - Different themes have different color philosophies
   - Test with various shell commands to see full palette
   - Consider switching to a different pre-built theme

### Debug Mode

To debug theme issues, add logging to the `getTheme()` function:

```javascript
function getTheme() {
  console.log('Theme switching to:', isDarkMode ? 'dark' : 'light');
  const theme = isDarkMode ? oneDark : bbedit;
  console.log('Using theme:', theme);
  return theme;
}
```

## Best Practices

### 1. Theme Selection
- **Choose popular themes** - Better tested and maintained
- **Test with real content** - Use actual shell commands for evaluation
- **Consider user base** - Match your audience's preferences
- **Maintain consistency** - Use themes from the same family when possible

### 2. Accessibility
- **Verify contrast ratios** - WCAG 2.1 AA: 4.5:1 for normal text
- **Test with color blindness simulators**
- **Ensure themes work in both light and dark modes**

### 3. Performance
- **Use pre-built themes** - Faster than custom themes
- **Minimize theme complexity** - Simpler themes load faster
- **Avoid frequent theme reconfiguration**

### 4. Maintenance
- **Keep packages updated** - Themes receive bug fixes and improvements
- **Document theme choices** - Record why specific themes were chosen
- **Test after updates** - Verify themes still work after package updates

## Package Management

### Installing Themes
```bash
# Install specific theme
npm install @uiw/codemirror-theme-[name]

# Install multiple themes
npm install @uiw/codemirror-theme-github @uiw/codemirror-theme-dracula

# Install the full theme collection
npm install @uiw/codemirror-themes
```

### Keeping Themes Updated
```bash
# Update specific theme
npm update @uiw/codemirror-theme-bbedit

# Update all theme packages
npm update @uiw/codemirror-theme-*
```

## Future Improvements

### Planned Features
- [ ] User theme selection in UI settings
- [ ] Theme preview functionality
- [ ] High contrast accessibility themes
- [ ] Custom theme import/export

### Extension Points
- Theme picker component
- User preference persistence
- Custom theme builder interface
- Integration with system accent colors

## Contributing

When contributing theme improvements:

1. **Use pre-built themes when possible** - Avoid custom themes unless necessary
2. **Test in both light and dark modes**
3. **Ensure accessibility compliance**
4. **Document theme choices and rationale**
5. **Update this guide with new features**

## References

- [CodeMirror 6 Theming Guide](https://codemirror.net/docs/guide/#theming)
- [@uiw/codemirror-themes Package](https://www.npmjs.com/package/@uiw/codemirror-themes)
- [Theme Gallery](https://uiwjs.github.io/react-codemirror/#/theme/doc)
- [Shell Mode Documentation](https://codemirror.net/5/mode/shell/)
- [WCAG Color Contrast Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)