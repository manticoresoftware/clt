<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { defaultKeymap } from '@codemirror/commands';
  import { StreamLanguage } from '@codemirror/language';
  import { shell } from '@codemirror/legacy-modes/mode/shell';
  
  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  
  const dispatch = createEventDispatcher();
  
  let editorView;
  let container;
  
  // Create CodeMirror editor
  function createEditor() {
    if (!container) return;
    
    try {
      const startState = EditorState.create({
        doc: value,
        extensions: [
          StreamLanguage.define(shell), // Shell/bash syntax highlighting
          oneDark, // Dark theme
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
    createEditor();
    
    return () => {
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