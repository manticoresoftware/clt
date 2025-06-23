pub use parser::{TestStep, TestStructure};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

/// Custom deserializer for TestStructure that handles both object and string formats
fn deserialize_test_structure<'de, D>(deserializer: D) -> Result<TestStructure, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;
    use serde_json::Value;

    let value = Value::deserialize(deserializer)?;

    match value {
        // Try to deserialize as TestStructure object first
        Value::Object(_) => TestStructure::deserialize(value).map_err(D::Error::custom),
        // If it's a string, try to parse it as JSON
        Value::String(s) => {
            let parsed_value: Value = serde_json::from_str(&s).map_err(|e| {
                D::Error::custom(format!("Invalid JSON string in test_structure: {}", e))
            })?;
            TestStructure::deserialize(parsed_value).map_err(D::Error::custom)
        }
        _ => Err(D::Error::custom(
            "test_structure must be an object or a JSON string",
        )),
    }
}

/// Wrapper for TestStructure that tracks if it was parsed from a string
#[derive(Debug)]
pub struct TestStructureWithWarning {
    pub structure: TestStructure,
    pub was_string: bool,
}

impl<'de> Deserialize<'de> for TestStructureWithWarning {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        use serde::de::Error;
        use serde_json::Value;

        let value = Value::deserialize(deserializer)?;

        match value {
            // Try to deserialize as TestStructure object first
            Value::Object(_) => {
                let structure = TestStructure::deserialize(value).map_err(D::Error::custom)?;
                Ok(TestStructureWithWarning {
                    structure,
                    was_string: false,
                })
            }
            // If it's a string, try to parse it as JSON
            Value::String(s) => {
                let parsed_value: Value = serde_json::from_str(&s).map_err(|e| {
                    D::Error::custom(format!("Invalid JSON string in test_structure: {}", e))
                })?;
                let structure =
                    TestStructure::deserialize(parsed_value).map_err(D::Error::custom)?;
                Ok(TestStructureWithWarning {
                    structure,
                    was_string: true,
                })
            }
            _ => Err(D::Error::custom(
                "test_structure must be an object or a JSON string",
            )),
        }
    }
}

/// MCP JSON-RPC 2.0 Request
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct McpRequest {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

/// MCP JSON-RPC 2.0 Response
#[derive(Debug, Serialize)]
pub struct McpResponse {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpError>,
}

/// MCP Error
#[derive(Debug, Serialize)]
pub struct McpError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// MCP Tool Definition
#[derive(Debug, Serialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

/// Initialize request parameters
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
    pub capabilities: ClientCapabilities,
    #[serde(rename = "clientInfo")]
    pub client_info: ClientInfo,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ClientCapabilities {
    pub tools: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

/// Initialize response
#[derive(Debug, Serialize)]
pub struct InitializeResult {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
    pub capabilities: ServerCapabilities,
    #[serde(rename = "serverInfo")]
    pub server_info: ServerInfo,
}

#[derive(Debug, Serialize)]
pub struct ServerCapabilities {
    pub tools: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Serialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
}

/// Tool call parameters
#[derive(Debug, Deserialize)]
pub struct ToolCallParams {
    pub name: String,
    pub arguments: Option<serde_json::Value>,
}

/// Tool call result
#[derive(Debug, Serialize)]
pub struct ToolCallResult {
    pub content: Vec<ToolContent>,
    #[serde(rename = "isError", skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ToolContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

/// Tool-specific input/output structures

#[derive(Debug, Deserialize)]
pub struct RunTestInput {
    pub test_file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docker_image: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunTestOutput {
    pub success: bool,
    pub errors: Vec<TestError>,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestError {
    pub command: String,
    pub expected: String,
    pub actual: String,
    pub step: usize,
}

#[derive(Debug, Deserialize)]
pub struct RefineOutputInput {
    pub expected: String,
    pub actual: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefineOutputOutput {
    pub refined_output: String,
    pub patterns_applied: Vec<PatternApplication>,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatternApplication {
    pub original: String,
    pub replacement: String,
    pub pattern_type: String,
    pub position: usize,
}

#[derive(Debug, Deserialize)]
pub struct TestMatchInput {
    pub expected: String,
    pub actual: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestMatchOutput {
    pub matches: bool,
    pub diff_lines: Vec<String>,
    pub summary: String,
}

/// New structured test format input/output structures

#[derive(Debug, Deserialize)]
pub struct ReadTestInput {
    pub test_file: String,
}

#[derive(Debug, Serialize)]
pub struct ReadTestOutput {
    pub steps: Vec<TestStep>,
}

#[derive(Debug, Deserialize)]
pub struct WriteTestInput {
    pub test_file: String,
    #[serde(deserialize_with = "deserialize_test_structure")]
    pub test_structure: TestStructure,
}

/// Version of WriteTestInput that tracks if test_structure was parsed from string
#[derive(Debug, Deserialize)]
pub struct WriteTestInputWithWarning {
    pub test_file: String,
    pub test_structure: TestStructureWithWarning,
}

#[derive(Debug, Serialize)]
pub struct WriteTestOutput {
    pub success: bool,
}
#[derive(Debug, Deserialize)]
pub struct TestReplaceInput {
    pub test_file: String,
    #[serde(deserialize_with = "deserialize_test_structure")]
    pub old_test_structure: TestStructure,
    #[serde(deserialize_with = "deserialize_test_structure")]
    pub new_test_structure: TestStructure,
}

/// Version of TestReplaceInput that tracks if test_structure was parsed from string
#[derive(Debug, Deserialize)]
pub struct TestReplaceInputWithWarning {
    pub test_file: String,
    pub old_test_structure: TestStructureWithWarning,
    pub new_test_structure: TestStructureWithWarning,
}

#[derive(Debug, Serialize)]
pub struct TestReplaceOutput {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct TestAppendInput {
    pub test_file: String,
    #[serde(deserialize_with = "deserialize_test_structure")]
    pub test_structure: TestStructure,
}

/// Version of TestAppendInput that tracks if test_structure was parsed from string
#[derive(Debug, Deserialize)]
pub struct TestAppendInputWithWarning {
    pub test_file: String,
    pub test_structure: TestStructureWithWarning,
}

#[derive(Debug, Serialize)]
pub struct TestAppendOutput {
    pub success: bool,
    pub message: String,
    pub steps_added: usize,
}

#[derive(Debug, Serialize)]
pub struct GetPatternsOutput {
    pub patterns: std::collections::HashMap<String, String>,
}

// TestStructure and TestStep are now imported from parser crate

impl McpResponse {
    pub fn success(id: Option<serde_json::Value>, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: Option<serde_json::Value>, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(McpError {
                code,
                message,
                data: None,
            }),
        }
    }
}
