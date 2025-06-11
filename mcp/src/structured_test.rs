use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use parser::{parse_statement, Statement};
use crate::mcp_protocol::{TestStructure, TestStep};

/// Convert a .rec file to structured JSON format
pub fn read_test_file(test_file_path: &str) -> Result<TestStructure> {
    let content = fs::read_to_string(test_file_path)?;
    let test_dir = Path::new(test_file_path).parent()
        .ok_or_else(|| anyhow!("Cannot determine parent directory of test file"))?;
    
    parse_rec_content(&content, test_dir)
}

/// Parse .rec content and convert to structured format
fn parse_rec_content(content: &str, base_dir: &Path) -> Result<TestStructure> {
    let lines: Vec<&str> = content.lines().collect();
    let mut steps = Vec::new();
    let mut i = 0;
    
    // First, extract description (everything before the first statement)
    let mut description_lines = Vec::new();
    
    while i < lines.len() {
        let line = lines[i].trim();
        
        // Check if this is a statement line
        if line.starts_with("––– ") && line.ends_with(" –––") {
            break;
        }
        
        // Skip empty lines at the beginning if no content yet
        if description_lines.is_empty() && line.is_empty() {
            i += 1;
            continue;
        }
        
        description_lines.push(lines[i]); // Keep original line with whitespace
        i += 1;
    }
    
    // Trim trailing empty lines from description
    while let Some(last) = description_lines.last() {
        if last.trim().is_empty() {
            description_lines.pop();
        } else {
            break;
        }
    }
    
    let description = if description_lines.is_empty() {
        None
    } else {
        Some(description_lines.join("\n"))
    };

    // Now parse the statements starting from where we left off
    while i < lines.len() {
        let line = lines[i].trim();
        
        // Skip empty lines
        if line.is_empty() {
            i += 1;
            continue;
        }

        // Check if this is a statement line
        if line.starts_with("––– ") && line.ends_with(" –––") {
            let (statement, arg) = parse_statement(line)?;
            let step = match statement {
                Statement::Input => {
                    // Collect input content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    TestStep {
                        step_type: "input".to_string(),
                        args: vec![],
                        content: Some(content),
                        steps: None,
                    }
                },
                Statement::Output => {
                    // Collect output content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    let args = if let Some(checker) = arg {
                        vec![checker]
                    } else {
                        vec![]
                    };
                    TestStep {
                        step_type: "output".to_string(),
                        args,
                        content: Some(content),
                        steps: None,
                    }
                },
                Statement::Comment => {
                    // Collect comment content until next statement
                    let (content, next_idx) = collect_content(&lines, i + 1)?;
                    i = next_idx;
                    TestStep {
                        step_type: "comment".to_string(),
                        args: vec![],
                        content: Some(content),
                        steps: None,
                    }
                },
                Statement::Block => {
                    let block_path = arg.ok_or_else(|| anyhow!("Block statement missing path argument"))?;
                    
                    // Resolve block file and parse recursively
                    let nested_steps = resolve_block(&block_path, base_dir)?;
                    i += 1; // Move past the block statement line
                    
                    TestStep {
                        step_type: "block".to_string(),
                        args: vec![block_path],
                        content: None,
                        steps: Some(nested_steps),
                    }
                },
                Statement::Duration => {
                    // Skip duration statements (they're auto-generated)
                    i += 1;
                    continue;
                }
            };
            steps.push(step);
        } else {
            // This shouldn't happen in a well-formed .rec file
            return Err(anyhow!("Unexpected line format: {}", line));
        }
    }

    Ok(TestStructure { description, steps })
}

/// Collect content lines until the next statement or end of file
fn collect_content(lines: &[&str], start_idx: usize) -> Result<(String, usize)> {
    let mut content_lines = Vec::new();
    let mut i = start_idx;

    while i < lines.len() {
        let line = lines[i];
        
        // Check if this is a statement line
        if line.trim().starts_with("––– ") && line.trim().ends_with(" –––") {
            break;
        }
        
        content_lines.push(line);
        i += 1;
    }

    // Join lines and trim trailing whitespace
    let content = content_lines.join("\n").trim_end().to_string();
    Ok((content, i))
}

/// Resolve a block reference by loading and parsing the .recb file
fn resolve_block(block_path: &str, base_dir: &Path) -> Result<Vec<TestStep>> {
    let block_file_path = base_dir.join(format!("{}.recb", block_path));
    
    if !block_file_path.exists() {
        return Err(anyhow!("Block file not found: {}", block_file_path.display()));
    }

    let block_content = fs::read_to_string(&block_file_path)?;
    let block_dir = block_file_path.parent()
        .ok_or_else(|| anyhow!("Cannot determine parent directory of block file"))?;
    
    let block_structure = parse_rec_content(&block_content, block_dir)?;
    Ok(block_structure.steps)
}

/// Convert structured JSON format back to .rec file content
pub fn write_test_file(test_file_path: &str, test_structure: &TestStructure) -> Result<()> {
    // Create parent directories if they don't exist
    if let Some(parent_dir) = Path::new(test_file_path).parent() {
        if !parent_dir.exists() {
            fs::create_dir_all(parent_dir)
                .map_err(|e| anyhow!("Failed to create directory {}: {}", parent_dir.display(), e))?;
        }
    }
    
    let rec_content = convert_structure_to_rec(test_structure)?;
    fs::write(test_file_path, rec_content)?;
    Ok(())
}

/// Convert TestStructure to .rec file format
fn convert_structure_to_rec(test_structure: &TestStructure) -> Result<String> {
    let mut lines = Vec::new();
    
    // Add description at the beginning if present
    if let Some(description) = &test_structure.description {
        lines.push(description.clone());
        // Add empty line after description if there are steps
        if !test_structure.steps.is_empty() {
            lines.push("".to_string());
        }
    }
    
    for step in &test_structure.steps {
        match step.step_type.as_str() {
            "input" => {
                lines.push("––– input –––".to_string());
                if let Some(content) = &step.content {
                    if !content.is_empty() {
                        lines.push(content.clone());
                    }
                }
            },
            "output" => {
                if step.args.is_empty() {
                    lines.push("––– output –––".to_string());
                } else {
                    lines.push(format!("––– output: {} –––", step.args[0]));
                }
                if let Some(content) = &step.content {
                    if !content.is_empty() {
                        lines.push(content.clone());
                    }
                }
            },
            "comment" => {
                lines.push("––– comment –––".to_string());
                if let Some(content) = &step.content {
                    if !content.is_empty() {
                        lines.push(content.clone());
                    }
                }
            },
            "block" => {
                if step.args.is_empty() {
                    return Err(anyhow!("Block step missing path argument"));
                }
                lines.push(format!("––– block: {} –––", step.args[0]));
                
                // Note: We don't write the nested steps to the .rec file
                // The block reference will be resolved when the file is read
            },
            _ => {
                return Err(anyhow!("Unknown step type: {}", step.step_type));
            }
        }
    }
    
    Ok(lines.join("\n"))
}

/// Get all available patterns from system and project .clt/patterns files
pub fn get_patterns(clt_binary_path: Option<&str>) -> Result<HashMap<String, String>> {
    let mut patterns = HashMap::new();
    
    // First, load system patterns from CLT binary directory
    if let Some(binary_path) = clt_binary_path {
        let binary_dir = Path::new(binary_path).parent()
            .ok_or_else(|| anyhow!("Cannot determine CLT binary directory"))?;
        let system_patterns_path = binary_dir.join(".clt/patterns");
        
        if system_patterns_path.exists() {
            load_patterns_from_file(&system_patterns_path, &mut patterns)?;
        }
    }
    
    // Then, load project patterns from current directory (these override system patterns)
    let project_patterns_path = Path::new(".clt/patterns");
    if project_patterns_path.exists() {
        load_patterns_from_file(project_patterns_path, &mut patterns)?;
    }
    
    Ok(patterns)
}

/// Load patterns from a specific file into the patterns map
fn load_patterns_from_file(file_path: &Path, patterns: &mut HashMap<String, String>) -> Result<()> {
    let content = fs::read_to_string(file_path)?;
    
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        
        // Parse pattern line: PATTERN_NAME REGEX_PATTERN
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() == 2 {
            patterns.insert(parts[0].to_string(), parts[1].to_string());
        }
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs;

    #[test]
    fn test_parse_simple_rec_content() {
        let content = r#"This is a test description
that spans multiple lines

––– input –––
echo "hello"
––– output –––
hello
"#;
        
        let temp_dir = tempdir().unwrap();
        let result = parse_rec_content(content, temp_dir.path()).unwrap();
        
        assert_eq!(result.description, Some("This is a test description\nthat spans multiple lines".to_string()));
        assert_eq!(result.steps.len(), 2);
        assert_eq!(result.steps[0].step_type, "input");
        assert_eq!(result.steps[0].content, Some("echo \"hello\"".to_string()));
        assert_eq!(result.steps[1].step_type, "output");
        assert_eq!(result.steps[1].content, Some("hello".to_string()));
    }

    #[test]
    fn test_convert_structure_to_rec() {
        let structure = TestStructure {
            description: Some("Test description\nwith multiple lines".to_string()),
            steps: vec![
                TestStep {
                    step_type: "input".to_string(),
                    args: vec![],
                    content: Some("echo \"hello\"".to_string()),
                    steps: None,
                },
                TestStep {
                    step_type: "output".to_string(),
                    args: vec![],
                    content: Some("hello".to_string()),
                    steps: None,
                },
            ],
        };
        
        let result = convert_structure_to_rec(&structure).unwrap();
        let expected = "Test description\nwith multiple lines\n\n––– input –––\necho \"hello\"\n––– output –––\nhello";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_convert_structure_to_rec_with_empty_content() {
        let structure = TestStructure {
            description: None,
            steps: vec![
                TestStep {
                    step_type: "input".to_string(),
                    args: vec![],
                    content: Some("echo \"hello\"".to_string()),
                    steps: None,
                },
                TestStep {
                    step_type: "output".to_string(),
                    args: vec![],
                    content: Some("".to_string()), // Empty content
                    steps: None,
                },
                TestStep {
                    step_type: "input".to_string(),
                    args: vec![],
                    content: Some("echo \"world\"".to_string()),
                    steps: None,
                },
            ],
        };
        
        let result = convert_structure_to_rec(&structure).unwrap();
        let expected = "––– input –––\necho \"hello\"\n––– output –––\n––– input –––\necho \"world\"";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_write_test_file_creates_directories() {
        let temp_dir = tempdir().unwrap();
        let test_file_path = temp_dir.path().join("nested/deep/directory/test.rec");
        
        let structure = TestStructure {
            description: Some("Test with nested directory".to_string()),
            steps: vec![
                TestStep {
                    step_type: "input".to_string(),
                    args: vec![],
                    content: Some("echo \"test\"".to_string()),
                    steps: None,
                },
            ],
        };
        
        // This should create the nested directory structure
        write_test_file(test_file_path.to_str().unwrap(), &structure).unwrap();
        
        // Verify the file was created
        assert!(test_file_path.exists());
        
        // Verify the content is correct
        let content = fs::read_to_string(&test_file_path).unwrap();
        assert!(content.starts_with("Test with nested directory"));
        assert!(content.contains("––– input –––"));
        assert!(content.contains("echo \"test\""));
    }
}