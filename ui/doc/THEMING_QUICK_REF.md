# Quick Theme Customization Reference

## Common Theme Modifications

### Change Light Mode Colors
```javascript
// In CodeMirrorInput.svelte or SimpleCodeMirror.svelte
// Edit the getTheme() function:

'.cm-keyword': { color: '#YOUR_COLOR', fontWeight: 'bold' },  // Commands
'.cm-string': { color: '#YOUR_COLOR' },                       // Strings
'.cm-operator': { color: '#YOUR_COLOR' },                     // Operators
'.cm-variableName': { color: '#YOUR_COLOR' },                 // Variables
'.cm-comment': { color: '#YOUR_COLOR', fontStyle: 'italic' }, // Comments
```

### Add New Theme Package
```bash
# Install theme
npm install @uiw/codemirror-theme-[name]

# Import in component
import { themeName } from '@uiw/codemirror-theme-[name]';

# Use in getTheme() function
return themeName;
```

### Test Theme Changes
```bash
cd ui
npm run dev  # Test in development
npm run build  # Verify build works
```

### Color Palette Quick Reference

#### Light Mode (Current)
- **Commands**: `#d73a49` (Red)
- **Strings**: `#0d7377` (Teal) 
- **Operators**: `#005cc5` (Blue)
- **Variables**: `#6f42c1` (Purple)
- **Comments**: `#6a737d` (Gray)

#### Dark Mode
Uses standard One Dark theme colors

### Accessibility Guidelines
- Minimum contrast ratio: 4.5:1 for normal text
- Test with color blindness simulators
- Provide non-color indicators (bold, italic) for important elements

### Files to Modify
- `ui/src/components/CodeMirrorInput.svelte` - Main command input
- `ui/src/components/SimpleCodeMirror.svelte` - Block/comment input

### Full Documentation
See [THEMING.md](./THEMING.md) for complete guide