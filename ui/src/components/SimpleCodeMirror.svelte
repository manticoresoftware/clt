<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { basicLight } from '@uiw/codemirror-theme-basic';
  import { defaultKeymap } from '@codemirror/commands';
  import { StreamLanguage } from '@codemirror/language';
  import { shell } from '@codemirror/legacy-modes/mode/shell';
  
  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  
  const dispatch = createEventDispatcher();
  
  let editorView;
  let container;
  let isDarkMode = false;
  let themeCompartment = new Compartment();
  
  // Detect user's theme preference
  function detectThemePreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  // Get appropriate theme based on user preference
  function getTheme() {
    if (isDarkMode) {
      return oneDark;
    } else {
      // Create a custom light theme with better contrast for shell syntax
      return [basicLight, EditorView.theme({
        '&': {
          fontSize: '14px',
          fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace"
        },
        '.cm-content': {
          padding: '8px 12px',
          backgroundColor: '#ffffff'
        },
        // Shell syntax highlighting improvements for light mode
        '.cm-string': { color: '#0d7377' },         // Teal for strings
        '.cm-comment': { color: '#6a737d', fontStyle: 'italic' }, // Gray for comments
        '.cm-keyword': { color: '#d73a49', fontWeight: 'bold' },   // Red for keywords
        '.cm-operator': { color: '#005cc5' },       // Blue for operators
        '.cm-variableName': { color: '#6f42c1' },   // Purple for variables
        '.cm-number': { color: '#005cc5' },         // Blue for numbers
        '.cm-atom': { color: '#005cc5' },           // Blue for atoms
        '.cm-builtin': { color: '#d73a49' },        // Red for builtins
        '.cm-meta': { color: '#6f42c1' },           // Purple for meta
        '.cm-tag': { color: '#22863a' },            // Green for tags
        '.cm-attribute': { color: '#6f42c1' },      // Purple for attributes
        '.cm-qualifier': { color: '#6f42c1' },      // Purple for qualifiers
        '.cm-property': { color: '#005cc5' },       // Blue for properties
        '.cm-variable': { color: '#24292e' },       // Dark gray for variables
        '.cm-def': { color: '#6f42c1' },            // Purple for definitions
        '.cm-bracket': { color: '#24292e' },        // Dark gray for brackets
        '.cm-type': { color: '#d73a49' },           // Red for types
        // Enhanced shell-specific highlighting
        '.cm-shell-command': { color: '#d73a49', fontWeight: 'bold' },
        '.cm-shell-flag': { color: '#005cc5' },
        '.cm-shell-path': { color: '#032f62' },
        '.cm-shell-redirect': { color: '#d73a49' },
        '.cm-shell-pipe': { color: '#d73a49', fontWeight: 'bold' }
      })];
    }
  }
  
  // Create CodeMirror editor
  function createEditor() {
    if (!container) return;
    
    try {
      const startState = EditorState.create({
        doc: value,
        extensions: [
          StreamLanguage.define(shell), // Shell/bash syntax highlighting
          themeCompartment.of(getTheme()), // Theme based on user preference
          keymap.of(defaultKeymap),
          EditorView.theme({
            '&': {
              fontSize: '14px',
              fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace"
            },
            '.cm-content': {
              padding: '8px 12px',
              minHeight: '40px',
              lineHeight: '1.5'
            },
            '.cm-focused': {
              outline: 'none'
            },
            '.cm-editor': {
              borderRadius: '4px',
              border: '1px solid #4a5568',
              background: '#2d3748'
            },
            '.cm-editor.cm-focused': {
              borderColor: '#61dafb',
              boxShadow: '0 0 0 1px #61dafb'
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newValue = update.state.doc.toString();
              if (newValue !== value) {
                value = newValue;
                dispatch('input', { target: { value: newValue } });
              }
            }
          }),
          EditorView.domEventHandlers({
            focus: () => dispatch('focus'),
            blur: () => dispatch('blur')
          })
        ]
      });
      
      editorView = new EditorView({
        state: startState,
        parent: container
      });
      
      console.log('CodeMirror editor created successfully');
    } catch (error) {
      console.error('Failed to create CodeMirror editor:', error);
    }
  }
  
  // Update editor when value changes externally
  function updateEditor() {
    if (editorView && editorView.state.doc.toString() !== value) {
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: value
        }
      });
    }
  }
  
  onMount(() => {
    // Set initial theme preference
    isDarkMode = detectThemePreference();
    
    // Listen for theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e) => {
      isDarkMode = e.matches;
      if (editorView) {
        // Reconfigure theme when preference changes
        editorView.dispatch({
          effects: themeCompartment.reconfigure(getTheme())
        });
      }
    };
    
    mediaQuery.addEventListener('change', handleThemeChange);
    
    createEditor();
    
    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
      if (editorView) {
        editorView.destroy();
      }
    };
  });
  
  // React to prop changes
  $: if (editorView && value !== undefined) {
    updateEditor();
  }
</script>

<div class="codemirror-wrapper">
  <div bind:this={container} class="codemirror-container"></div>
  {#if !value && placeholder}
    <div class="placeholder">{placeholder}</div>
  {/if}
</div>

<style>
  .codemirror-wrapper {
    position: relative;
    width: 100%;
  }
  
  .codemirror-container {
    width: 100%;
  }
  
  .placeholder {
    position: absolute;
    top: 9px;
    left: 13px;
    color: #a0aec0;
    opacity: 0.7;
    pointer-events: none;
    font-family: 'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace;
    font-size: 14px;
    line-height: 1.5;
    z-index: 1;
  }
</style>