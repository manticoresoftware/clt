use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    pub line_number: usize,
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
    pub test_structure: TestStructure,
}

#[derive(Debug, Serialize)]
pub struct WriteTestOutput {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct GetPatternsOutput {
    pub patterns: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestStructure {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub steps: Vec<TestStep>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestStep {
    #[serde(rename = "type")]
    pub step_type: String,
    pub args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<TestStep>>, // For nested blocks
}

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
