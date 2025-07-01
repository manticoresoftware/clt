mod mcp_protocol;
mod pattern_refiner;
mod test_runner;
mod server;

// External crates
use cmp;
use parser;

use anyhow::Result;
use clap::Parser;
use server::McpServer;

/// CLT MCP Server - Model Context Protocol server for Command Line Tester
#[derive(Parser, Debug)]
#[command(
    name = "clt-mcp",
    version = "0.1.0",
    about = "MCP server for CLT (Command Line Tester) integration",
    long_about = "A Model Context Protocol server that provides tools for automated testing \
                  of CLI applications in Docker containers with pattern matching support."
)]
struct Args {
    /// Docker image to use for test execution
    #[arg(
        long = "docker-image",
        help = "Docker image to use for test execution (e.g., ubuntu:20.04)",
        value_name = "IMAGE"
    )]
    docker_image: String,

    /// Path to CLT binary (optional, auto-discovered if not provided)
    #[arg(
        long = "bin",
        help = "Path to CLT binary. If not provided, CLT will be auto-discovered in PATH",
        value_name = "PATH"
    )]
    clt_binary_path: Option<String>,

    /// Working directory path for test resolution (defaults to current directory)
    #[arg(
        long = "workdir-path",
        help = "Working directory path for test file resolution. If not specified, uses current working directory",
        value_name = "PATH"
    )]
    workdir_path: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let mut server = McpServer::new(args.docker_image, args.clt_binary_path, args.workdir_path)?;

    server.run().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    use serde_json::json;
    use crate::mcp_protocol::*;

    fn create_fake_clt_binary() -> NamedTempFile {
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, "#!/bin/bash\necho 'fake clt binary'").unwrap();
        temp_file
    }

    #[test]
    fn test_mcp_server_new_with_valid_bin() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let server = McpServer::new("test-image".to_string(), Some(temp_path), None);

        assert!(server.is_ok());
    }

    #[test]
    fn test_mcp_server_new_with_invalid_bin() {
        let server = McpServer::new(
            "test-image".to_string(),
            Some("/nonexistent/path".to_string()),
            None,
        );

        assert!(server.is_err());
        assert!(server
            .unwrap_err()
            .to_string()
            .contains("CLT binary not found"));
    }

    #[tokio::test]
    async fn test_execute_unknown_tool() {
        let temp_file = create_fake_clt_binary();
        let temp_path = temp_file.path().to_string_lossy().to_string();

        let mut server = McpServer::new("test-image".to_string(), Some(temp_path), None).unwrap();

        let result = server.execute_tool("unknown_tool", None).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unknown tool"));
    }

    #[test]
    fn test_mcp_response_constructors() {
        let success_response = McpResponse::success(Some(json!(1)), json!({"test": "data"}));
        assert_eq!(success_response.jsonrpc, "2.0");
        assert_eq!(success_response.id, Some(json!(1)));
        assert!(success_response.result.is_some());
        assert!(success_response.error.is_none());

        let error_response =
            McpResponse::error(Some(json!(2)), -32602, "Invalid params".to_string());
        assert_eq!(error_response.jsonrpc, "2.0");
        assert_eq!(error_response.id, Some(json!(2)));
        assert!(error_response.result.is_none());
        assert!(error_response.error.is_some());
        assert_eq!(error_response.error.unwrap().code, -32602);
    }
}

#[cfg(test)]
mod test_string_format {
    use super::*;
    use serde_json::json;
    use crate::mcp_protocol;

    #[test]
    fn test_test_structure_object_format() {
        let json_input = json!({
            "test_file": "test.rec",
            "test_structure": {
                "description": "Test description",
                "steps": [
                    {
                        "type": "input",
                        "args": [],
                        "content": "echo hello"
                    }
                ]
            }
        });

        let result: mcp_protocol::WriteTestInputWithWarning =
            serde_json::from_value(json_input).unwrap();
        assert_eq!(result.test_file, "test.rec");
        assert!(!result.test_structure.was_string);
        assert_eq!(
            result.test_structure.structure.description,
            Some("Test description".to_string())
        );
    }

    #[test]
    fn test_test_structure_string_format() {
        let test_structure_json = json!({
            "description": "Test description",
            "steps": [
                {
                    "type": "input",
                    "args": [],
                    "content": "echo hello"
                }
            ]
        });

        let json_input = json!({
            "test_file": "test.rec",
            "test_structure": serde_json::to_string(&test_structure_json).unwrap()
        });

        let result: mcp_protocol::WriteTestInputWithWarning =
            serde_json::from_value(json_input).unwrap();
        assert_eq!(result.test_file, "test.rec");
        assert!(result.test_structure.was_string); // Should be true for string format
        assert_eq!(
            result.test_structure.structure.description,
            Some("Test description".to_string())
        );
    }

    #[test]
    fn test_test_replace_input_string_format() {
        let test_structure_json = json!({
            "description": "Test description",
            "steps": [
                {
                    "type": "input",
                    "args": [],
                    "content": "echo hello"
                }
            ]
        });

        let json_input = json!({
            "test_file": "test.rec",
            "old_test_structure": serde_json::to_string(&test_structure_json).unwrap(),
            "new_test_structure": test_structure_json
        });

        let result: mcp_protocol::TestReplaceInputWithWarning =
            serde_json::from_value(json_input).unwrap();
        assert_eq!(result.test_file, "test.rec");
        assert!(result.old_test_structure.was_string); // String format
        assert!(!result.new_test_structure.was_string); // Object format
    }

    #[test]
    fn test_invalid_json_string() {
        let json_input = json!({
            "test_file": "test.rec",
            "test_structure": "invalid json string"
        });

        let result: Result<mcp_protocol::WriteTestInputWithWarning, _> =
            serde_json::from_value(json_input);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid JSON string"));
    }

    #[test]
    fn test_invalid_type() {
        let json_input = json!({
            "test_file": "test.rec",
            "test_structure": 123  // Invalid type
        });

        let result: Result<mcp_protocol::WriteTestInputWithWarning, _> =
            serde_json::from_value(json_input);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must be an object or a JSON string"));
    }
}