<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { EditorView, keymap, lineNumbers } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { bbedit } from '@uiw/codemirror-theme-bbedit';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { StreamLanguage } from '@codemirror/language';
  import { shell } from '@codemirror/legacy-modes/mode/shell';

  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  export let readOnly = false;

  const dispatch = createEventDispatcher();

  let editorView;
  let container;
  let isDarkMode = false;
  let themeCompartment = new Compartment();
  let readOnlyCompartment = new Compartment();
  
  // Variables to manage editor state and prevent update loops
  let isInternalUpdate = false;
  let isUserTyping = false;
  let lastUserValue = '';

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

    try {
      const startState = EditorState.create({
        doc: value,
        extensions: [
          StreamLanguage.define(shell), // Shell/bash syntax highlighting
          themeCompartment.of(getTheme()), // Theme based on user preference
          readOnlyCompartment.of([
            EditorView.editable.of(!readOnly),
            EditorState.readOnly.of(readOnly)
          ]),
          history(), // Enable undo/redo history
          keymap.of([...historyKeymap, ...defaultKeymap]), // Include history keymaps (CMD+Z, CMD+Shift+Z)
          lineNumbers(), // Add line numbers
          EditorView.lineWrapping, // Enable line wrapping
          // Disable all autocomplete and suggestions
          EditorState.languageData.of(() => []),
          EditorView.contentAttributes.of({'spellcheck': 'false', 'autocomplete': 'off', 'autocorrect': 'off', 'autocapitalize': 'off'}),
          EditorView.theme({
            '&': {
              fontSize: '12px',
              fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace"
            },
            '.cm-content': {
              padding: '8px 12px',
              minHeight: '40px',
              lineHeight: '1'
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
            },
            '.cm-lineNumbers': {
              fontSize: '10px',
              color: 'inherit',
              backgroundColor: 'inherit !important',
              borderRight: 'none',
              paddingRight: '4px',
              minWidth: '16px',
              opacity: '0.4'
            },
            '.cm-gutters': {
              backgroundColor: 'inherit !important',
              border: 'none !important',
              minWidth: '20px'
            },
            '.cm-gutter': {
              backgroundColor: 'inherit !important'
            },

          }),
          EditorView.updateListener.of((update) => {
            // Block all updates if readOnly
            if (readOnly) return;
            
            if (update.docChanged) {
              const newValue = update.state.doc.toString();
              if (newValue !== value) {
                // Set flag to prevent external update loop
                isInternalUpdate = true;
                isUserTyping = true;
                lastUserValue = newValue;
                value = newValue;
                dispatch('input', { target: { value: newValue } });
                // Reset flag after a short delay to allow parent to process
                setTimeout(() => {
                  isInternalUpdate = false;
                  // Keep user typing flag for longer to prevent external updates
                  setTimeout(() => {
                    isUserTyping = false;
                  }, 500);
                }, 0);
              }
            }
          }),
          EditorView.domEventHandlers({
            focus: () => {
              if (readOnly) return;
              isUserTyping = true;
              dispatch('focus');
            },
            blur: () => {
              // Delay clearing typing flag to allow for quick refocus
              setTimeout(() => {
                isUserTyping = false;
              }, 1000);
              dispatch('blur');
            }
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
    if (editorView && editorView.state.doc.toString() !== value && !isInternalUpdate && !isUserTyping) {
      // Only update if:
      // 1. Not in internal update cycle
      // 2. User is not actively typing (preserves undo history)
      // 3. The value actually changed
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

  // React to readOnly prop changes - FORCE UPDATE WHEN IT CHANGES
  $: if (editorView) {
    console.log('🔒 SimpleCodeMirror readOnly prop changed to:', readOnly);
    editorView.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly)
      ])
    });
  }
</script>

<div class="codemirror-wrapper">
  <div bind:this={container} class="codemirror-container"></div>
  {#if !value?.trim() && placeholder}
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
    font-size: 12px;
    line-height: 1;
    z-index: 1;
  }
</style>
