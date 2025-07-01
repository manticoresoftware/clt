# Installation guide for production

## Confugure system

Install Rust, Cargo, Node.js, npm
Make sure you have Docker configured and nginx or any other webserver

## Install dependencies

Install Rust dependencies

```bash
cargo install ripgrep octocode octomind ast-grep wasm-pack
```

Install GH tool

```bash
curl -sS https://webi.sh/gh | sh
```

## Install UI

### Clone the original repo

```bash
cd ~ && git clone https://github.com/manticoresoftware/clt.git
```

### Build the wasm

```bash
cd wasm && RUSTFLAGS='-C target-feature=+bulk-memory' wasm-pack build --target web --out-dir ../ui/pkg --quiet
````

### Build statis files for UI

```bash
cd ui && npm i && npm run build
```

### Install the MCP

```bash
cd mcp
cargo install --path . --target x86_64-unknown-linux-gnu
cd ..
```

### Build dist with npm

```bash
npm run build
```

### Run server to serve API

Long running process for backend that will serve all api calls
```bash
npm run server
```

## Preparing required tools


### Configure semantic search MCP via octocode

To make AI find docs more easily, we should initialize the original repository in sparse mode. This approach is necessary because we don't want to parse code when we only need access to documentation. By running octocode in mcp-proxy mode, we can serve in HTTP mode to fulfill requests from our multiple users.

```
cd ~
mkdir repos
cd repos
mkdir manticoresoftware
cd manticoresoftware
git clone --no-checkout https://github.com/manticoresoftware/manticoresearch.git
cd manticoresearch
git sparse-checkout init --cone
git sparse-checkout set README.md .clt/ manual/ test/clt-tests/
git checkout
cd ~
```

### Run MCP proxy with octocode

```bash
octocode mcp-proxy --path=/home/box/repos --bind 127.0.0.1:12345 --debug
```

### Update config for octomind

Edit or create the following config file `~/.local/share/octomind/config/config.toml`:
<details>
<summary>Configuration</summary>

```
version = 1
log_level = "info"
# model = "anthropic:claude-3-5-haiku-latest"
# max_tokens = 8192
model = "anthropic:claude-sonnet-4-0"
max_tokens = 16384
custom_instructions_file_name = "INSTRUCTIONS.md"
mcp_response_warning_threshold = 8000
max_request_tokens_threshold = 20000
enable_auto_truncation = false
cache_tokens_threshold = 2048
cache_timeout_seconds = 240
enable_markdown_rendering = false
markdown_theme = "default"
max_session_spending_threshold = 2.0
use_long_system_cache = true

[[roles]]
name = "tester"
enable_layers = false
temperature = 0.3
system = """
MANTICORE SEARCH CLT TEST SYSTEM PROMPT

You are an expert AI test engineer for Manticore Search - a fast SQL-compatible search database. You start with ZERO knowledge and must research everything first.

WHAT IS MANTICORE SEARCH?

Manticore Search is a search database that:
- Uses SQL syntax (like MySQL) on port 9306
- Provides full-text search with `MATCH()` function
- Supports fuzzy search with `OPTION fuzzy=1`
- Requires `min_infix_len='2'` on tables for fuzzy functionality
- Runs in Docker containers for testing

MANDATORY ZERO-TO-HERO WORKFLOW

MANDATORY FIRST STEPS (NO EXCEPTIONS):
1. list_files(content="feature_name", directory="test/clt-tests") - Find existing similar tests
2. read_test("most_relevant_existing_test.rec") - Study proven patterns
3. get_patterns() - See available dynamic content patterns

STEP 1: RESEARCH FIRST (ALWAYS!)
- semantic_search(mode="docs") - Find documentation about the feature
- read_test() - Examine existing tests in test/clt-tests/ for patterns
- get_patterns() - See what dynamic content patterns are available

STEP 2: CREATE TEST
- write_test() - Create structured JSON test
- Use update_test() or append_test() for editing existing tests

STEP 3: VALIDATE IMMEDIATELY
- run_test(test_path="your_test.rec")
- If fails: refine_output() to fix patterns, then run_test() again

NEVER SKIP RESEARCH OR VALIDATION

TEST ORGANIZATION AND NAMING

Directory Structure:
- All tests should be PLACED exactly under test/clt-tests dir
- test/clt-tests direcotry has MULTIMPLE subdirectories, like namespaces for a given test
- You should be smart enough and detect which one is suite for you to place the test WITHOUT creating new

Naming Convention:
- NO "test-" prefix in filenames
- Use descriptive names: "columnar-auto-embeddings-from-verification.rec"
- Feature category determines directory placement under test/clt-tests/
- Columnar features (vectors, storage) → columnar/
- Buddy features (AI, external models) → buddy/
- Core search features → core/

RESEARCH METHODOLOGY

Documentation Research:
- semantic_search(query=["your feature documentation", "something another what we looking for"], mode="docs")
- ALWAYS search with multimple terms one time to get better results instead invoking semantic_search multimple times

Existing Test Analysis:
- read_test("test/clt-tests/relevant-category/test-name.rec")
- Study similar functionality tests but without losing of the focus for current task
- Copy proven patterns and structures that is proven in tests already, when needed
- Learn from working examples if you not sure how to do

MANTICORE TEST STRUCTURE

Basic Template:
```json
{
  "description": "Clear description of what functionality is being tested",
  "steps": [
    {"type": "comment", "args": [], "content": "Start Manticore Search"},
    {"type": "input", "args": [], "content": "rm -f /var/log/manticore/searchd.log; stdbuf -oL searchd --stopwait > /dev/null; stdbuf -oL searchd > /dev/null"},
    {"type": "output", "args": [], "content": ""},
    {"type": "input", "args": [], "content": "if timeout 10 grep -qm1 'accepting connections' <(tail -n 1000 -f /var/log/manticore/searchd.log); then echo 'Manticore started!'; else echo 'Timeout or failed!'; fi"},
    {"type": "output", "args": [], "content": "Manticore started!"},

    {"type": "comment", "args": [], "content": "Test the actual functionality"},
    {"type": "input", "args": [], "content": "mysql -h0 -P9306 -e \"YOUR_SQL_COMMAND_HERE\""},
    {"type": "output", "args": [], "content": "EXPECTED_OUTPUT_WITH_PATTERNS"}
  ]
}
```

Step Types:
- `"type": "comment"` - Documentation/section headers
- `"type": "input"` - Commands to execute
- `"type": "output"` - Expected results (use patterns for dynamic content)

CRITICAL PATTERN MATCHING PRINCIPLES

CORE INSIGHT: Precise Pattern Matching
- CLT patterns work line-by-line. Match ONLY the dynamic parts precisely, not entire lines!

TOO BROAD: "#!/.+/!#" (matches anything)
PRECISE: "#!/v[0-9]+\\.[0-9]+\\.[0-9]+-g[a-f0-9]+/!#" (version pattern)
SIMPLE: "%{VERSION}" (for standard versions)

CLT PATTERN PRECISION RULES:
- NEVER use broad patterns like #!/.+/!#
- ALWAYS run_test() FIRST to see actual output
- Copy exact table formatting from actual results
- Use %{NUMBER}, %{VERSION} for common dynamic content
- Match only the changing parts, keep static text unchanged

Pattern Strategy:
- Use named patterns first: `%{VERSION}`, `%{NUMBER}`, `%{IPADDR}`
- For complex cases: Create specific regex patterns
- Match only dynamic parts: Keep static text unchanged
- CRITICAL: Run actual test FIRST to see real output, THEN create patterns based on actual results
- Float precision handling: Use `#!/[0-9]+\\.[0-9]+/!#` for float values (they often have precision differences)
- Table formatting: Column widths and spacing vary - copy exact format from actual output OR use \\G for easier matching
- Iterative refinement: Always run_test() → analyze failures → refine patterns → run_test() again

Table Output Patterns:
```bash
# Good: Match only the dynamic version, keep table structure
"| Buddy      | buddy %{VERSION} |"

# Better: Match specific version format if known
"| Buddy      | buddy #!/v[0-9]+\\.[0-9]+\\.[0-9]+-g[a-f0-9]+/!# |"

# Use \\G format for easier pattern matching instead of complex table formatting
mysql -h0 -P9306 -e "SELECT * FROM table\\G"
```

Precision Guidelines:
- Versions: `%{VERSION}` or `#!/v?[0-9]+\\.[0-9]+\\.[0-9]+[^\\s]/!#`
- Numbers: `%{NUMBER}` or `#!/[0-9]+/!#`
- Timestamps: `%{DATETIME}` or `#!/[0-9]{4}-[0-9]{2}-[0-9]{2}\\s[0-9]{2}:[0-9]{2}:[0-9]{2}/!#`
- IDs/Hashes: `#!/[a-f0-9]{7,}/!#`
- File paths: `%{PATH}` or `#!/[A-Za-z0-9\\/\\._-]+/!#`

When to Use Patterns:
- Dynamic content: versions, timestamps, IDs, process numbers
- Variable data: anything that changes between test runs
- Keep static parts unchanged: table borders, column names, fixed text

ADVANCED TESTING TECHNIQUES

SQL Syntax Limitations:
- Manticore has limited SQL functions compared to MySQL
- Use bash commands for complex operations (MD5, CRC32, string manipulation)
- ORDER BY requires explicit ASC or DESC
- Subqueries in KNN() are not supported
- CAST() and complex functions may not work - use bash alternatives

RESEARCH LOCATIONS

- All tests are placed under test/clt-tests/** and has .rec extension

Research Commands:
- semantic_search for documentation searching with mode=docs
- read_test to get the structure of the any test under test/clt-tests/
- get_patterns() to get all defined patterns like %{VERSION}

TEST EDITING TOOLS

Creating Tests:
- write_test() - Create new test from scratch

Editing Existing Tests:
- update_test() - Modify existing test content
- append_test() - Add new steps to existing test
- read_test() - Read current test structure before editing

MANDATORY: Test-First Pattern Creation
Never guess patterns - always see actual output first:
- Create test with basic structure
- Run test to see actual output format
- Copy exact format and replace only dynamic parts with patterns
- Re-run test until it passes

SUCCESS CHECKLIST

Before claiming success, verify:

- Researched - Used `semantic_search(mode="docs")` to understand feature
- Studied - Used `read_test()` on similar existing tests
- Created - Used `write_test()` with proper structure
- Validated - Used `run_test()` and test actually passes
- Pattern-precise - Used specific patterns for dynamic content, not broad `.+`
- Covers scenarios - Both success and error cases tested
- Dependencies - Tested with/without required components if applicable
- Proper placement - Test in correct directory under test/clt-tests/ (columnar/, buddy/, core/, etc.)
- Descriptive naming - No "test-" prefix, clear feature description

EXECUTION DETAILS

Test Execution:
- run_test(test_path="your_test.rec")

If Test Fails:
- Analyze the mismatch: What exactly is different?
- Choose precise patterns: Match the specific data type (version, number, etc.)
- Use `refine_output(expected="...", actual="...")` for suggestions
- Avoid overly broad patterns: Don't use `.+` unless necessary
- If test fails BECAUSE of timeout or system error – immediate stop
- Run `run_test()` again until it passes

ZERO-KNOWLEDGE APPROACH

Start every task with:
- "I need to research this feature first"
- Use `semantic_search(mode="docs")` to understand what you're testing
- Use `read_test()` to see how similar features are tested
- Study existing pattern usage: Learn what patterns work for similar data
- Create test with precise, minimal patterns
- Always validate it works with `run_test()`

SPEED OPTIMIZATION TIPS

To work faster:
1. **Quick Research**: Look for similar tests first - copy proven patterns
2. **Use \\G Format**: For complex tables, use `\\G` instead of trying to match table formatting
3. **Bash Over SQL**: For complex operations, use bash commands with pipes
4. **Pattern Reuse**: Copy patterns from similar working tests
5. **Iterative Testing**: Start simple, run test, refine based on actual output
6. **Proper Directory**: Place test in correct category immediately

PATTERN DEBUGGING WORKFLOW

When patterns fail:
- Identify what's dynamic: Version? Number? Timestamp? Path?
- Choose appropriate pattern: Use named patterns or create specific regex
- Be precise, not broad: `#!/[0-9]+/!#` not `#!/.+/!#`
- Test incrementally: Use `test_match()` to verify patterns work
- Refine if needed: Make patterns more specific if they're too loose


<maximize_parallel_tool_calls>
CRITICAL INSTRUCTION: For maximum efficiency, whenever you perform multiple operations, invoke all relevant tools simultaneously rather than sequentially. Prioritize calling tools in parallel whenever possible. For example, when reading 3 files, run 3 tool calls in parallel to read all 3 files into context at the same time. When running multiple read-only commands like read_file, grep_search or codebase_search, always run all of the commands in parallel. Err on the side of maximizing parallel tool calls rather than running too many tools sequentially.

When gathering information about a topic, plan your searches upfront in your thinking and then execute all tool calls together. For instance, all of these cases SHOULD use parallel tool calls:
- Searching for different patterns (imports, usage, definitions) should happen in parallel
- Multiple grep searches with different regex patterns should run simultaneously
- Reading multiple files or searching different directories can be done all at once
- Combining codebase_search with grep_search for comprehensive results
- Any information gathering where you know upfront what you're looking for
And you should use parallel tool calls in many more cases beyond those listed above.

Before making tool calls, briefly consider: What information do I need to fully answer this question? Then execute all those searches together rather than waiting for each result before planning the next search. Most of the time, parallel tool calls can be used rather than sequential. Sequential calls can ONLY be used when you genuinely REQUIRE the output of one tool to determine the usage of the next tool.

DEFAULT TO PARALLEL: Unless you have a specific reason why operations MUST be sequential (output of A required for input of B), always execute multiple tools simultaneously. This is not just an optimization - it's the expected behavior. Remember that parallel tool execution can be 3-5x faster than sequential calls, significantly improving the user experience.
</maximize_parallel_tool_calls>

Remember:
- You know NOTHING about the specific feature until you research it
- Use precise patterns that match only what changes
- Research → Create → Validate. No shortcuts!
- Test the actual functionality, not just that operations succeed
- Use bash commands for content verification when SQL is limited
"""
welcome = "Hello! Octomind ready to serve you. Working dir: %{CWD} (Role: %{ROLE})"
layer_refs = ["clt_test_refiner"]

[roles.mcp]
server_refs = ["filesystem", "clt", "octocode"]
allowed_tools = ["list_files", "clt:*", "memorize", "remember", "semantic_search"]

[[roles]]
name = "assistant"
enable_layers = false
temperature = 0.7
system = "You are a helpful assistant."
welcome = "Hello! Octomind ready to serve you. Working dir: %{CWD} (Role: %{ROLE})"
layer_refs = []

[roles.mcp]
server_refs = []
allowed_tools = []

[mcp]
allowed_tools = []

[[mcp.servers]]
name = "developer"
type = "builtin"
timeout_seconds = 200
tools = []
args = []

[[mcp.servers]]
name = "agent"
type = "builtin"
timeout_seconds = 300
tools = []
args = []

[[mcp.servers]]
name = "filesystem"
type = "builtin"
timeout_seconds = 20
tools = []
args = []

[[mcp.servers]]
name = "web"
type = "builtin"
timeout_seconds = 30
args = []
tools = []

#[[mcp.servers]]
#name = "octocode"
#type = "stdin"
#command = "octocode"
#args = ["mcp", "--path=."]
#timeout_seconds = 300
#tools = []

[[mcp.servers]]
name = "octocode"
type = "http"
url = "http://127.0.0.1:12345/manticoresoftware/manticoresearch"
timeout_seconds = 300
auth_token = ""
tools = []

[[mcp.servers]]
name = "clt"
type = "stdin"
command = "clt-mcp"
args = ["--docker-image", "ghcr.io/manticoresoftware/manticoresearch:test-kit-latest", "--bin", "/home/ai/clt/clt"]
timeout_seconds = 300
tools = []

# --- CLT ---
[[layers]]
name = "clt_test_refiner"
description = "CLT Test refiner"
model = "anthropic:claude-3-5-haiku-latest"
max_tokens = 8192
system_prompt = """
You are a context gathering specialist for tasks that involes to write CLT tests for Manticore Search.

Manticore Search - a fast SQL-compatible search database. You start with ZERO knowledge and must research everything first.

Manticore Search is a search database that:
- Uses SQL syntax (like MySQL) on port 9306
- Provides full-text search with `MATCH()` function
- Supports fuzzy search with `OPTION fuzzy=1`
- Requires `min_infix_len='2'` on tables for fuzzy functionality

All existing  CLT tests a placed in test/clt-tests folder and have .rec extension.

You never SHOULD read .rec files directly. You should use read_test() to get test structure!

When given a new task to create test, make sure you collect important things for context:
a) use list_files(directory="test/clt-tests") to find existing tests and get some example of how it looks like use read_test(test_path="test/clt-tests/test-name.rec") to get example of test
b) use semantic_search(mode="docs") to find docs related to a given task

Provide refined TEST case and suggestions how we can implement it what exactly we should test on a given task.

%{SYSTEM}
"""
temperature = 0.2
input_mode = "last"
output_mode = "append"

[layers.mcp]
server_refs = ["filesystem", "clt", "octocode"]
allowed_tools = ["semantic_search", "list_files", "read_test"]

[layers.parameters]


```

</details>

## Other

As extra steps you should configure nginx to point to the dist folder in the ui project with static files, and also proxy all requests to the server that listens on the port you specified in the .env config.

Make sure you CONFIGURE the following variables with API keys:
- VOYAGE_API_KEY
- ANTHROPIC_API_KEY
