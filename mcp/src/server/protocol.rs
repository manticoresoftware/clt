use anyhow::Result;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as AsyncBufReader};

use crate::mcp_protocol::*;

use super::config::ServerConfig;
use super::handlers::ToolHandlers;
use super::tools::ToolDefinitions;

/// MCP Protocol server implementation
#[derive(Debug)]
pub struct McpServer {
    tool_handlers: ToolHandlers,
    tool_definitions: ToolDefinitions,
}

impl McpServer {
    pub fn new(
        docker_image: String,
        clt_binary_path: Option<String>,
        workdir_path: Option<String>,
    ) -> Result<Self> {
        let config = ServerConfig::new(docker_image.clone(), clt_binary_path, workdir_path)?;
        let tool_handlers = ToolHandlers::new(config.clone())?;
        let tool_definitions = ToolDefinitions::new(docker_image);

        Ok(Self {
            tool_handlers,
            tool_definitions,
        })
    }

    pub async fn run(&mut self) -> Result<()> {
        let stdin = tokio::io::stdin();
        let mut reader = AsyncBufReader::new(stdin);
        let mut stdout = tokio::io::stdout();

        let mut line = String::new();
        loop {
            line.clear();

            // Handle EOF or read errors gracefully
            let bytes_read = match reader.read_line(&mut line).await {
                Ok(0) => break, // EOF - client disconnected
                Ok(n) => n,
                Err(e) => {
                    // Check if it's a broken pipe or connection reset
                    if e.kind() == std::io::ErrorKind::BrokenPipe
                        || e.kind() == std::io::ErrorKind::ConnectionReset
                        || e.kind() == std::io::ErrorKind::ConnectionAborted
                    {
                        // Client disconnected - exit gracefully
                        break;
                    }
                    // For other errors, continue trying
                    continue;
                }
            };

            if bytes_read == 0 {
                break; // EOF
            }

            // Parse JSON and handle errors properly
            let response = match serde_json::from_str::<McpRequest>(line.trim()) {
                Ok(request) => self.handle_request(request).await,
                Err(_) => {
                    // Send error response for malformed JSON
                    McpResponse::error(None, -32700, "Parse error: Invalid JSON".to_string())
                }
            };

            // Send response with proper error handling
            if let Err(e) = self.send_response(&mut stdout, &response).await {
                // Check if it's a broken pipe or connection issue
                if e.kind() == std::io::ErrorKind::BrokenPipe
                    || e.kind() == std::io::ErrorKind::ConnectionReset
                    || e.kind() == std::io::ErrorKind::ConnectionAborted
                {
                    // Client disconnected - exit gracefully
                    break;
                }
                // For other errors, continue trying
                continue;
            }
        }

        Ok(())
    }

    async fn send_response(
        &self,
        stdout: &mut tokio::io::Stdout,
        response: &McpResponse,
    ) -> std::io::Result<()> {
        let response_json = serde_json::to_string(response)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        stdout.write_all(response_json.as_bytes()).await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;

        Ok(())
    }

    async fn handle_request(&mut self, request: McpRequest) -> McpResponse {
        match request.method.as_str() {
            "initialize" => self.handle_initialize(request.id, request.params),
            "tools/list" => self.handle_tools_list(request.id),
            "tools/call" => self.handle_tools_call(request.id, request.params).await,
            _ => McpResponse::error(
                request.id,
                -32601,
                format!("Method not found: {}", request.method),
            ),
        }
    }

    fn handle_initialize(&self, id: Option<Value>, _params: Option<Value>) -> McpResponse {
        let result = InitializeResult {
            protocol_version: "2024-11-05".to_string(),
            capabilities: ServerCapabilities {
                tools: Some(std::collections::HashMap::new()),
            },
            server_info: ServerInfo {
                name: "CLT MCP Server".to_string(),
                version: "0.1.0 - Command Line Tester integration for automated testing of CLI applications in Docker containers with pattern matching support".to_string(),
            },
        };

        McpResponse::success(id, json!(result))
    }

    fn handle_tools_list(&self, id: Option<Value>) -> McpResponse {
        let tools = self.tool_definitions.get_tools();
        let result = json!({
            "tools": tools
        });

        McpResponse::success(id, result)
    }

    async fn handle_tools_call(&mut self, id: Option<Value>, params: Option<Value>) -> McpResponse {
        let params = match params {
            Some(p) => p,
            None => return McpResponse::error(id, -32602, "Missing parameters".to_string()),
        };

        let tool_call: ToolCallParams = match serde_json::from_value(params) {
            Ok(tc) => tc,
            Err(e) => return McpResponse::error(id, -32602, format!("Invalid parameters: {}", e)),
        };

        let result = match self
            .execute_tool(&tool_call.name, tool_call.arguments)
            .await
        {
            Ok(content) => ToolCallResult {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: content,
                }],
                is_error: None,
            },
            Err(e) => ToolCallResult {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: format!("Error: {}", e),
                }],
                is_error: Some(true),
            },
        };

        McpResponse::success(id, json!(result))
    }

    pub async fn execute_tool(&mut self, tool_name: &str, arguments: Option<Value>) -> Result<String> {
        // Wrap the entire tool execution in a comprehensive error handler
        match tool_name {
            "run_test" => self.tool_handlers.handle_run_test(arguments).await,
            "refine_output" => self.tool_handlers.handle_refine_output(arguments),
            "test_match" => self.tool_handlers.handle_test_match(arguments),
            "clt_help" => self.tool_handlers.handle_clt_help(arguments),
            "get_patterns" => self.tool_handlers.handle_get_patterns(arguments),
            "read_test" => self.tool_handlers.handle_read_test(arguments),
            "write_test" => self.tool_handlers.handle_write_test(arguments),
            "update_test" => self.tool_handlers.handle_update_test(arguments),
            "append_test" => self.tool_handlers.handle_append_test(arguments),
            _ => Err(anyhow::anyhow!("Unknown tool: {}", tool_name)),
        }
    }
}