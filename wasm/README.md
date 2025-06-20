# wasm-diff

This library provides a text-diffing solution with support for variable pattern matching. It is written in Rust and compiled to WebAssembly (WASM), enabling its use in both web and non-web JavaScript applications. The main functionality is exposed via the `PatternMatcher` struct which can compare two strings line-by-line, taking into account static parts and dynamic pattern segments.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Compilation to WASM](#compilation-to-wasm)
- [Usage in JavaScript](#usage-in-javascript)
- [API Overview](#api-overview)
- [How It Works](#how-it-works)
- [License](#license)

## Features

- **Pattern Replacement**: Replace variables matching `%{VAR_NAME}` syntax with configured patterns.
- **Line-by-Line Diff**: Compare two multi-line strings returning an object with detailed change information.
- **Highlighting**: Computes character-level diff ranges to highlight differences between lines.
- **WASM & JS Integration**: Easily compile to WASM and use the library from JavaScript.

## Installation

First, ensure you have the following tools installed:
- [Rust](https://www.rust-lang.org/tools/install)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) (for easy compilation to WebAssembly)

Clone this repository or include the source in your project.

## Compilation to WASM

There are two primary methods to compile the library to WebAssembly:

### 1. Using `wasm-pack`

The simplest way to compile and bundle your library is with `wasm-pack`.

1. **Install wasm-pack** (if not installed):

   ```bash
   cargo install wasm-pack
   ```

2. **Build the package**:

   In the project directory, run:

   ```bash
    RUSTFLAGS='-C target-feature=+bulk-memory' wasm-pack build --release --target web --out-dir ../ui/pkg --quiet
   ```

   This command compiles the Rust code to WASM and generates a `pkg/` directory with your WASM module and JavaScript bindings.

### 2. Using `cargo` Directly

If you prefer, you can compile using Cargo and then use a bundler (like webpack or rollup) along with [`wasm-bindgen`](https://github.com/rustwasm/wasm-bindgen).

1. **Compile to WASM**:

   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```

2. **Run wasm-bindgen**:

   ```bash
   wasm-bindgen target/wasm32-unknown-unknown/release/<your_crate_name>.wasm --out-dir pkg --target bundler
   ```

   Replace `<your_crate_name>` with the actual crate name.

## Usage in JavaScript

Once you have compiled your WASM module (using one of the methods above), you can use it in a JavaScript project.

### Example with ES Modules

Assuming you built the module with `wasm-pack` and have the `pkg` folder in your project:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>WASM Pattern Matcher Demo</title>
  </head>
  <body>
    <script type="module">
      // Import the default module
      import init, { PatternMatcher } from "./pkg/<your_crate_name>.js";

      async function run() {
        // Initialize the WASM module
        await init();

        // Optionally, pass configuration with variable patters in JSON format.
        // The configuration expects a JSON mapping with keys (pattern names) and values (regex strings).
        const patternsConfig = JSON.stringify({
          "A": "[a-zA-Z]+",    // Sample regex pattern for %{A}
          "B": "\\d+"         // Sample regex pattern for %{B}
        });

        // Create a new instance of PatternMatcher with the configuration.
        const matcher = new PatternMatcher(patternsConfig);

        // Example texts to compare
        const expectedText = "Hello %{A}\nThis is a test\nGoodbye %{B}";
        const actualText = "Hello World\nThis is a experiment\nGoodbye 1234";

        // Get the diff as a JSON string
        const diffJson = matcher.diff_text(expectedText, actualText);

        // Parse and log the result
        const diffResult = JSON.parse(diffJson);
        console.log(diffResult);
      }

      run();
    </script>
  </body>
</html>
```

### Example with Node.js

If you want to use the WASM module in a Node.js environment, ensure Node.js supports ES modules or configure proper bundling. With Node.js v14+ and using ES modules:

```javascript
// index.js
import init, { PatternMatcher } from "./pkg/<your_crate_name>.js";

async function run() {
  await init();

  // Create a new instance of PatternMatcher (with or without configuration)
  const matcher = new PatternMatcher(JSON.stringify({
    "A": "[a-zA-Z]+",
    "B": "\\d+"
  }));

  const expectedText = "Hello %{A}\nLine two\nBye %{B}";
  const actualText = "Hello Universe\nLine two updated\nBye 5678";

  const diffJson = matcher.diff_text(expectedText, actualText);
  console.log(JSON.parse(diffJson));
}

run();
```

Then simply run:

```bash
node index.js
```

## API Overview

### `new(patterns_json: Option<String>)`

- **Description**: Constructs a new `PatternMatcher` object.
- **Parameters**:
  - `patterns_json`: A JSON string representing a map of variable names to regex patterns. When provided, each occurrence of `%{VAR_NAME}` in the input text will be replaced by the corresponding pattern (wrapped with delimiters).
- **Returns**: A new instance of `PatternMatcher`.

### `diff_text(expected: &str, actual: &str) -> String`

- **Description**: Compares two multi-line strings line-by-line.
- **Parameters**:
  - `expected`: The expected text (can include variables like `%{A}`).
  - `actual`: The actual text to compare against.
- **Returns**: A JSON string representing a `DiffResult` object that includes:
  - `has_diff`: A boolean flag indicating whether any differences were found.
  - `diff_lines`: An array where each element represents a diff result for a line with the type:
    - `"same"`: Lines are identical.
    - `"added"`: Lines added in the actual text.
    - `"removed"`: Lines missing from the actual text.
    - `"changed"`: Lines that differ, along with highlighted ranges marking the differences.

### Internal Functions

The library also implements several helper functions:

- **`replace_vars_to_patterns`**: Replaces occurrences of `%{VAR_NAME}` in the text using the provided configuration.
- **`split_into_parts`**: Splits a line into alternating static and pattern parts based on custom delimiters (`#!/` and `/!#`).
- **`has_diff`**: Uses the aforementioned functions to determine if a line in the actual text differs from the expected text after applying variable replacements.
- **`compute_diff_ranges`**: Performs a simple character-level diff (via common prefix/suffix detection) to compute ranges for highlighting.

## How It Works

1. **Variable Replacement**:
   When calling `diff_text`, the expected text lines are processed to replace any variable patterns of the form `%{VAR_NAME}` with custom regex patterns sourced from the provided configuration. Each matching variable is transformed into a token with custom delimiters (`#!/` and `/!#`), allowing later splitting.

2. **Parsing and Matching**:
   Each processed expected line is split into static and pattern parts. The comparison function (`has_diff`) then iterates over these parts. For static parts, an exact match is expected at the corresponding location in the actual line. For dynamic pattern parts, the function builds a regex to match the expected content. If any segment does not match, the line is flagged as different.

3. **Line Diff Calculation**:
   Once a difference is found, the `compute_diff_ranges` function compares the two lines character-by-character. It determines the common prefix and suffix and highlights the middle “changed” segment in the result. This information is provided back in the `diff_lines` array inside the diff result.

4. **Result Serialization**:
   The final diff result is a JSON string that can be deserialized and easily used in JavaScript applications to render differences, e.g., with syntax highlighting or diff views.

## License

[MIT License](LICENSE)
