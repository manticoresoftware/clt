<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { bbedit } from '@uiw/codemirror-theme-bbedit';
  import { defaultKeymap, indentWithTab } from '@codemirror/commands';
  import { StreamLanguage } from '@codemirror/language';
  import { shell } from '@codemirror/legacy-modes/mode/shell';
  
  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  
  const dispatch = createEventDispatcher();
  
  let editor;
  let editorView;
  let container;
  let isDarkMode = false;\n  let themeCompartment = new Compartment();
  
  // Detect user's theme preference
  function detectThemePreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  // Get appropriate theme based on user preference
  function getTheme() {
    return isDarkMode ? oneDark : bbedit;
  }
  
  // Create CodeMirror editor
  function createEditor() {
    if (!container) return;
    
    const startState = EditorState.create({
      doc: value,
      extensions: [
        StreamLanguage.define(shell), // Shell/bash syntax highlighting using legacy mode
        themeCompartment.of(getTheme()), // Theme based on user preference
        keymap.of([
          ...defaultKeymap,
          indentWithTab
        ]),
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
            border: '1px solid #4a5568'
          },
          '.cm-editor.cm-focused': {
            borderColor: '#61dafb',
            boxShadow: '0 0 0 1px #61dafb'
          },
          '.cm-scroller': {
            fontFamily: 'inherit'
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
          blur: () => dispatch('blur'),
          keydown: (event) => dispatch('keydown', event),
          keyup: (event) => dispatch('keyup', event)
        })
      ]
    });
    
    editorView = new EditorView({
      state: startState,
      parent: container
    });
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
  
  // Handle disabled state
  function updateDisabled() {
    if (editorView) {
      editorView.dispatch({
        effects: EditorView.editable.reconfigure(!disabled)
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
  
  $: if (editorView && disabled !== undefined) {
    updateDisabled();
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
  
  /* Hide placeholder when editor has content */
  :global(.cm-content:not(:empty)) + .placeholder {
    display: none;
  }
  
  /* Ensure single line for command inputs */
  :global(.codemirror-wrapper .cm-line) {
    white-space: nowrap;
    overflow-x: auto;
  }
  
  /* Custom scrollbar for horizontal overflow */
  :global(.codemirror-wrapper .cm-scroller) {
    overflow-x: auto;
  }
  
  /* Make it look more like an input field */
  :global(.codemirror-wrapper .cm-editor) {
    background: #2d3748 !important;
  }
  
  :global(.codemirror-wrapper .cm-content) {
    white-space: nowrap;
    overflow-x: auto;
  }
</style>