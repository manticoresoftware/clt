<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { EditorView, lineNumbers } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';

  export let value = '';
  export let placeholder = '';
  export let editable = true;
  export let syncScrollWith: EditorView | null = null;

  const dispatch = createEventDispatcher();

  let container: HTMLElement;
  let editorView: EditorView | null = null;
  let isDarkMode = false;
  let themeCompartment = new Compartment();
  let isScrollSyncing = false;

  // Detect system theme preference
  function detectThemePreference(): boolean {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Get theme based on current preference
  function getTheme() {
    return EditorView.theme({
      '&': {
        fontSize: '12px',
        fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
        height: 'auto'
      },
      '.cm-content': {
        padding: '8px 12px',
        minHeight: '60px',
        lineHeight: '1',
        fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
        fontSize: '12px'
      },
      '.cm-focused': {
        outline: 'none'
      },
      '.cm-editor': {
        borderRadius: '4px',
        border: '1px solid var(--color-border)',
        background: editable ? 'var(--color-bg-textarea)' : 'var(--color-bg-secondary)',
        height: 'auto'
      },
      '.cm-editor.cm-focused': {
        borderColor: 'var(--color-bg-accent)',
        boxShadow: '0 0 0 2px rgba(var(--color-accent-rgb), 0.2)'
      },
      '.cm-content': {
        color: 'var(--color-text-primary)',
        caretColor: 'var(--color-text-primary)',
        fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
        fontSize: '12px',
        lineHeight: '1'
      },
      '.cm-line': {
        padding: '0',
        fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
        fontSize: '12px',
        lineHeight: '1'
      },
      '.cm-lineNumbers': {
        color: 'var(--color-text-tertiary)',
        backgroundColor: 'transparent',
        fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
        fontSize: '12px',
        lineHeight: '1'
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none'
      },
      '.cm-scroller': {
        fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
        fontSize: '12px',
        lineHeight: '1'
      }
    }, { dark: isDarkMode });
  }

  // Create the editor
  function createEditor() {
    if (!container) return;

    try {
      const startState = EditorState.create({
        doc: value,
        extensions: [
          themeCompartment.of(getTheme()),
          lineNumbers(),
          EditorView.lineWrapping,
          // Disable all autocomplete and suggestions
          EditorState.languageData.of(() => []),
          EditorView.contentAttributes.of({'spellcheck': 'false', 'autocomplete': 'off', 'autocorrect': 'off', 'autocapitalize': 'off'}),
          // Make read-only if not editable
          EditorView.editable.of(editable),
          EditorState.readOnly.of(!editable),
          // Update callback for editable editors
          ...(editable ? [EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newValue = update.state.doc.toString();
              value = newValue;
              dispatch('input', { target: { value: newValue } });
            }
          })] : []),
          // Scroll sync only - no complex focus/blur handling
          EditorView.domEventHandlers({
            scroll: (event, view) => {
              if (!isScrollSyncing && syncScrollWith && syncScrollWith !== view) {
                syncScroll(view, syncScrollWith);
              }
            }
          })
        ]
      });

      editorView = new EditorView({
        state: startState,
        parent: container
      });

      console.log('OutputCodeMirror editor created successfully');
    } catch (error) {
      console.error('Failed to create OutputCodeMirror editor:', error);
    }
  }

  // Sync scroll between editors
  function syncScroll(fromView: EditorView, toView: EditorView) {
    if (isScrollSyncing) return;
    
    isScrollSyncing = true;
    
    try {
      // Get scroll info from source editor
      const fromScrollDOM = fromView.scrollDOM;
      const toScrollDOM = toView.scrollDOM;
      
      if (fromScrollDOM && toScrollDOM) {
        // Sync both vertical and horizontal scroll
        toScrollDOM.scrollTop = fromScrollDOM.scrollTop;
        toScrollDOM.scrollLeft = fromScrollDOM.scrollLeft;
      }
    } catch (error) {
      console.error('Error syncing scroll:', error);
    }
    
    // Use requestAnimationFrame for smooth sync
    requestAnimationFrame(() => {
      isScrollSyncing = false;
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

  // Expose the editor view for parent components
  export function getEditorView(): EditorView | null {
    return editorView;
  }

  onMount(() => {
    // Set initial theme preference
    isDarkMode = detectThemePreference();

    // Listen for theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e) => {
      isDarkMode = e.matches;
      if (editorView) {
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

  // Update sync target when it changes
  $: if (editorView && syncScrollWith) {
    // Re-setup scroll sync when target changes
    // This is handled in the scroll event handler
  }
</script>

<div class="codemirror-wrapper">
  <div bind:this={container} class="codemirror-container"></div>
  {#if !value && placeholder}
    <div class="placeholder {editable ? 'editable-placeholder' : 'readonly-placeholder'}">{placeholder}</div>
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
    opacity: 0.7;
    pointer-events: none;
    font-family: 'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace;
    font-size: 12px;
    line-height: 1;
    z-index: 1;
  }

  .placeholder.editable-placeholder {
    color: #a0aec0;
  }

  .placeholder.readonly-placeholder {
    color: var(--color-text-tertiary, #a0aec0);
    font-style: italic;
  }
</style>