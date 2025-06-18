# CodeMirror Theming Guide for CLT UI

This document provides comprehensive information about the theming system for command syntax highlighting in the CLT UI, including how to configure, customize, and extend themes.

## Overview

The CLT UI uses CodeMirror 6 for syntax highlighting in command input fields. The theming system automatically switches between light and dark themes based on the user's system preference (`prefers-color-scheme`).

## Architecture

### Theme Detection
- **Automatic Detection**: Uses `window.matchMedia('(prefers-color-scheme: dark)')` to detect user preference
- **Real-time Switching**: Listens for theme changes and updates the editor dynamically
- **Fallback**: Defaults to light theme if detection fails

### Theme Components
1. **Base Theme**: Foundation theme (oneDark for dark, basicLight for light)
2. **Custom Overrides**: Shell-specific syntax highlighting rules
3. **Dynamic Reconfiguration**: Uses CodeMirror's Compartment API for live theme switching

## File Structure

```
ui/src/components/
├── CodeMirrorInput.svelte    # Main command input with syntax highlighting
├── SimpleCodeMirror.svelte   # Simplified version for blocks/comments
```

## Current Theme Configuration

### Dark Mode Theme
Uses `@codemirror/theme-one-dark` with no additional customization.

### Light Mode Theme
Combines `@uiw/codemirror-theme-basic` with custom shell syntax highlighting:

```javascript
// Light theme configuration
return [basicLight, EditorView.theme({
  '&': {
    fontSize: '14px',
    fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace"
  },
  '.cm-content': {
    padding: '8px 12px',
    backgroundColor: '#ffffff'
  },
  // Shell syntax highlighting
  '.cm-string': { color: '#0d7377' },         // Teal for strings
  '.cm-comment': { color: '#6a737d', fontStyle: 'italic' },
  '.cm-keyword': { color: '#d73a49', fontWeight: 'bold' },
  '.cm-operator': { color: '#005cc5' },
  '.cm-variableName': { color: '#6f42c1' },
  // ... more syntax rules
})]
```

## Color Palette

### Light Mode Colors
| Element | Color | Usage |
|---------|-------|-------|
| Commands/Keywords | `#d73a49` (Red) | `docker`, `echo`, `grep`, etc. |
| Strings | `#0d7377` (Teal) | Quoted text, file paths in quotes |
| Operators | `#005cc5` (Blue) | `>`, `|`, `&&`, `||` |
| Variables | `#6f42c1` (Purple) | `$VAR`, environment variables |
| Comments | `#6a737d` (Gray) | `# comment text` |
| Numbers | `#005cc5` (Blue) | Port numbers, counts |
| Flags | `#005cc5` (Blue) | `-q`, `--verbose`, etc. |
| Paths | `#032f62` (Dark Blue) | File system paths |

### Dark Mode Colors
Uses the standard One Dark theme color palette:
- Keywords: `#c678dd` (Purple)
- Strings: `#98c379` (Green)
- Comments: `#5c6370` (Gray)
- Numbers: `#d19a66` (Orange)
- Operators: `#56b6c2` (Cyan)

## How to Customize Themes

### 1. Modifying Existing Colors

To change colors for light mode, edit the `getTheme()` function in both `CodeMirrorInput.svelte` and `SimpleCodeMirror.svelte`:

```javascript
// Example: Change string color to purple
'.cm-string': { color: '#6f42c1' }, // Changed from teal to purple
```

### 2. Adding New Syntax Rules

Add new CSS classes for specific shell elements:

```javascript
// Add new shell-specific highlighting
'.cm-shell-sudo': { color: '#d73a49', fontWeight: 'bold' },
'.cm-shell-env-var': { color: '#6f42c1', fontStyle: 'italic' },
'.cm-shell-glob': { color: '#22863a' },
```

### 3. Creating a Custom Theme

To create a completely custom theme:

```javascript
// 1. Install a new base theme
npm install @uiw/codemirror-theme-[theme-name]

// 2. Import in the component
import { customTheme } from '@uiw/codemirror-theme-custom';

// 3. Replace in getTheme() function
function getTheme() {
  if (isDarkMode) {
    return customDarkTheme;
  } else {
    return [customTheme, EditorView.theme({
      // Your custom overrides
    })];
  }
}
```

### 4. Advanced Customization

For complex theming needs, you can create a completely custom theme:

```javascript
import { EditorView } from '@codemirror/view';

const myCustomTheme = EditorView.theme({
  '&': {
    color: '#333',
    backgroundColor: '#fff'
  },
  '.cm-content': {
    padding: '10px',
    fontFamily: 'Monaco, monospace'
  },
  '.cm-focused': {
    outline: 'none'
  },
  '.cm-editor': {
    border: '1px solid #ddd',
    borderRadius: '4px'
  },
  '.cm-editor.cm-focused': {
    borderColor: '#007acc',
    boxShadow: '0 0 0 2px rgba(0, 122, 204, 0.2)'
  },
  // Syntax highlighting
  '.cm-keyword': { color: '#0000ff', fontWeight: 'bold' },
  '.cm-string': { color: '#008000' },
  '.cm-comment': { color: '#808080', fontStyle: 'italic' },
  '.cm-number': { color: '#ff6600' },
  '.cm-operator': { color: '#000080' },
  '.cm-variableName': { color: '#800080' }
});
```

## Available Theme Packages

### Recommended Light Themes
- `@uiw/codemirror-theme-basic` - Clean, minimal light theme
- `@uiw/codemirror-theme-github` - GitHub-style light theme
- `@uiw/codemirror-theme-white` - Pure white background theme
- `@uiw/codemirror-theme-eclipse` - Eclipse IDE-style theme

### Recommended Dark Themes
- `@codemirror/theme-one-dark` - One Dark theme (current default)
- `@uiw/codemirror-theme-dracula` - Dracula theme
- `@uiw/codemirror-theme-monokai` - Monokai theme
- `@uiw/codemirror-theme-sublime` - Sublime Text theme

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

### Limitations
- Limited Docker-specific highlighting
- Basic pipe and redirection detection
- No advanced shell construct recognition (functions, arrays)

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

## Troubleshooting

### Common Issues

1. **Theme not switching**
   - Check browser support for `prefers-color-scheme`
   - Verify media query listener is attached
   - Check console for JavaScript errors

2. **Colors not applying**
   - Ensure CSS selectors are correct (`.cm-keyword`, not `.keyword`)
   - Check for CSS specificity conflicts
   - Verify theme is properly imported

3. **Performance issues**
   - Avoid complex CSS selectors in theme
   - Use CSS variables for consistent theming
   - Minimize theme reconfiguration frequency

### Debug Mode

To debug theme issues, add logging to the `getTheme()` function:

```javascript
function getTheme() {
  console.log('Theme switching to:', isDarkMode ? 'dark' : 'light');
  // ... rest of function
}
```

## Best Practices

### 1. Color Accessibility
- Ensure sufficient contrast ratios (WCAG 2.1 AA: 4.5:1 for normal text)
- Test with color blindness simulators
- Provide alternative indicators beyond color (bold, italic, underline)

### 2. Consistency
- Use consistent color meanings across light/dark themes
- Maintain visual hierarchy (commands > operators > variables)
- Follow existing UI color palette when possible

### 3. Performance
- Minimize theme complexity
- Use CSS variables for maintainable themes
- Avoid frequent theme reconfiguration

### 4. Maintenance
- Document custom color choices
- Use semantic color names in comments
- Test theme changes across different shell commands

## Future Improvements

### Planned Features
- [ ] Custom theme picker in UI settings
- [ ] Docker-specific syntax highlighting
- [ ] Enhanced shell construct recognition
- [ ] Theme export/import functionality
- [ ] High contrast accessibility theme

### Extension Points
- Plugin system for custom syntax modes
- User-defined color schemes
- Command-specific highlighting rules
- Integration with VS Code themes

## Contributing

When contributing theme improvements:

1. Test in both light and dark modes
2. Ensure accessibility compliance
3. Document color choices and rationale
4. Update this guide with new features
5. Add visual regression tests if possible

## References

- [CodeMirror 6 Theming Guide](https://codemirror.net/docs/guide/#theming)
- [CodeMirror Theme Extensions](https://codemirror.net/docs/ref/#view.EditorView^theme)
- [Shell Mode Documentation](https://codemirror.net/5/mode/shell/)
- [WCAG Color Contrast Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)