use wasm_bindgen::prelude::*;
use regex::Regex;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use once_cell::sync::Lazy;
use parser::{TestStructure, read_test_file, write_test_file, replace_test_structure, append_test_structure, get_patterns, read_test_file_from_map, write_test_file_to_map, validate_test_from_map, validate_test_from_map_with_patterns};

static VAR_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"%\{[A-Z]{1}[A-Z_0-9]*\}").unwrap()
});

// ===== EXISTING DIFF TYPES =====
#[derive(Serialize, Deserialize)]
pub struct DiffResult {
    has_diff: bool,
    diff_lines: Vec<DiffLine>,
}

#[derive(Serialize, Deserialize)]
pub struct DiffLine {
    line_type: String, // "same", "added", "removed", or "changed"
    content: String,
    old_content: Option<String>, // Only used for "changed" lines
    highlight_ranges: Option<Vec<HighlightRange>>,
}

#[derive(Serialize, Deserialize)]
pub struct HighlightRange {
    start: usize,
    end: usize,
}

// ===== EXISTING PATTERN MATCHER =====
#[wasm_bindgen]
pub struct PatternMatcher {
    config: HashMap<String, String>,
}

#[wasm_bindgen]
impl PatternMatcher {
    #[wasm_bindgen(constructor)]
    pub fn new(patterns_json: Option<String>) -> Self {
        let config = match patterns_json {
            Some(json) => {
                let patterns: HashMap<String, String> = serde_json::from_str(&json).unwrap_or_default();
                patterns.into_iter().map(|(k, v)| {
                    (k, format!("#!/{}/!#", v))
                }).collect()
            },
            None => HashMap::new(),
        };

        Self { config }
    }

    #[wasm_bindgen]
    pub fn diff_text(&self, expected: &str, actual: &str) -> String {
        let expected_lines: Vec<&str> = expected.lines().collect();
        let actual_lines: Vec<&str> = actual.lines().collect();

        let mut result = DiffResult {
            has_diff: false,
            diff_lines: Vec::new(),
        };

        let max_lines = std::cmp::max(expected_lines.len(), actual_lines.len());
        for i in 0..max_lines {
            match (expected_lines.get(i), actual_lines.get(i)) {
                (Some(exp), Some(act)) => {
                    if self.has_diff(exp.to_string(), act.to_string()) {
                        result.has_diff = true;
                        // Lines are different
                        let (_ranges1, ranges2) = self.compute_diff_ranges(exp, act);
                        
                        result.diff_lines.push(DiffLine {
                            line_type: "changed".to_string(),
                            content: act.to_string(),
                            old_content: Some(exp.to_string()),
                            highlight_ranges: Some(ranges2),
                        });
                    } else {
                        // Lines are same
                        result.diff_lines.push(DiffLine {
                            line_type: "same".to_string(),
                            content: act.to_string(),
                            old_content: None,
                            highlight_ranges: None,
                        });
                    }
                },
                (Some(exp), None) => {
                    // Line removed
                    result.has_diff = true;
                    result.diff_lines.push(DiffLine {
                        line_type: "removed".to_string(),
                        content: exp.to_string(),
                        old_content: None,
                        highlight_ranges: None,
                    });
                },
                (None, Some(act)) => {
                    // Line added
                    result.has_diff = true;
                    result.diff_lines.push(DiffLine {
                        line_type: "added".to_string(),
                        content: act.to_string(),
                        old_content: None,
                        highlight_ranges: None,
                    });
                },
                _ => {},
            }
        }

        serde_json::to_string(&result).unwrap_or_else(|_| "{\"error\": \"Failed to serialize diff result\"}".to_string())
    }

    fn has_diff(&self, rec_line: String, rep_line: String) -> bool {
        let rec_line = self.replace_vars_to_patterns(rec_line);
        let parts = self.split_into_parts(&rec_line);
        let mut last_index = 0;

        for part in parts {
            match part {
                MatchingPart::Static(static_part) => {
                    if rep_line[last_index..].starts_with(&static_part) {
                        last_index += static_part.len();
                    } else {
                        return true;
                    }
                }
                MatchingPart::Pattern(pattern) => {
                    let pattern_regex = Regex::new(&pattern).unwrap_or(Regex::new(".*").unwrap());
                    if let Some(mat) = pattern_regex.find(&rep_line[last_index..]) {
                        last_index += mat.end();
                    } else {
                        return true;
                    }
                }
            }
        }

        last_index != rep_line.len()
    }

    fn split_into_parts(&self, rec_line: &str) -> Vec<MatchingPart> {
        let mut parts = Vec::new();

        let first_splits: Vec<&str> = rec_line.split("#!/").collect();
        for (i, first_split) in first_splits.iter().enumerate() {
            if i == 0 {
                // First part is always static
                if !first_split.is_empty() {
                    parts.push(MatchingPart::Static(first_split.to_string()));
                }
                continue;
            }

            let second_splits: Vec<&str> = first_split.split("/!#").collect();
            if second_splits.len() >= 2 {
                // First part is the pattern
                parts.push(MatchingPart::Pattern(second_splits[0].to_string()));
                // Second part is static text
                if second_splits.len() > 1 && !second_splits[1].is_empty() {
                    parts.push(MatchingPart::Static(second_splits[1..].join("/!#")));
                }
            } else {
                // If no closing pattern delimiter, treat as static
                parts.push(MatchingPart::Static(format!("#!/{}", first_split)));
            }
        }
        parts
    }

    fn replace_vars_to_patterns(&self, line: String) -> String {
        VAR_REGEX.replace_all(&line, |caps: &regex::Captures| {
            let matched = &caps[0];
            let key = matched[2..matched.len() - 1].to_string();
            self.config.get(&key).unwrap_or(&matched.to_string()).clone()
        }).into_owned()
    }

    fn compute_diff_ranges(&self, old_line: &str, new_line: &str) -> (Vec<HighlightRange>, Vec<HighlightRange>) {
        // Simple char-by-char diff implementation
        let old_chars: Vec<char> = old_line.chars().collect();
        let new_chars: Vec<char> = new_line.chars().collect();

        // Compute common prefix length
        let prefix_len = old_chars
            .iter()
            .zip(new_chars.iter())
            .take_while(|(c1, c2)| c1 == c2)
            .count();

        // Compute common suffix length
        let mut suffix_len = 0;
        let max_suffix = std::cmp::min(
            old_chars.len().saturating_sub(prefix_len),
            new_chars.len().saturating_sub(prefix_len)
        );

        for i in 0..max_suffix {
            let old_idx = old_chars.len() - 1 - i;
            let new_idx = new_chars.len() - 1 - i;
            if old_chars[old_idx] != new_chars[new_idx] {
                break;
            }
            suffix_len += 1;
        }

        // Create highlight ranges
        let old_ranges = if prefix_len < old_chars.len().saturating_sub(suffix_len) {
            vec![HighlightRange {
                start: prefix_len,
                end: old_chars.len().saturating_sub(suffix_len),
            }]
        } else {
            vec![]
        };

        let new_ranges = if prefix_len < new_chars.len().saturating_sub(suffix_len) {
            vec![HighlightRange {
                start: prefix_len,
                end: new_chars.len().saturating_sub(suffix_len),
            }]
        } else {
            vec![]
        };

        (old_ranges, new_ranges)
    }
}

enum MatchingPart {
    Static(String),
    Pattern(String),
}

// ===== REC FILE PARSING WASM BINDINGS =====

/// Convert a .rec file to structured JSON format
#[wasm_bindgen]
pub fn read_test_file_wasm(test_file_path: &str) -> String {
    match read_test_file(test_file_path) {
        Ok(structure) => serde_json::to_string(&structure).unwrap_or_else(|e| {
            format!("{{\"error\": \"Failed to serialize result: {}\"}}", e)
        }),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}

/// Convert structured JSON format back to .rec file content
#[wasm_bindgen]
pub fn write_test_file_wasm(test_file_path: &str, test_structure_json: &str) -> String {
    let test_structure: TestStructure = match serde_json::from_str(test_structure_json) {
        Ok(s) => s,
        Err(e) => return format!("{{\"error\": \"Invalid JSON: {}\"}}", e),
    };
    
    match write_test_file(test_file_path, &test_structure) {
        Ok(()) => "{\"success\": true}".to_string(),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}

/// Replace old test structure with new test structure in existing file
#[wasm_bindgen]
pub fn replace_test_structure_wasm(
    test_file_path: &str,
    old_structure_json: &str,
    new_structure_json: &str,
) -> String {
    let old_structure: TestStructure = match serde_json::from_str(old_structure_json) {
        Ok(s) => s,
        Err(e) => return format!("{{\"error\": \"Invalid old structure JSON: {}\"}}", e),
    };
    
    let new_structure: TestStructure = match serde_json::from_str(new_structure_json) {
        Ok(s) => s,
        Err(e) => return format!("{{\"error\": \"Invalid new structure JSON: {}\"}}", e),
    };
    
    match replace_test_structure(test_file_path, &old_structure, &new_structure) {
        Ok(()) => "{\"success\": true}".to_string(),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}

/// Append test structure to existing file
#[wasm_bindgen]
pub fn append_test_structure_wasm(test_file_path: &str, append_structure_json: &str) -> String {
    let append_structure: TestStructure = match serde_json::from_str(append_structure_json) {
        Ok(s) => s,
        Err(e) => return format!("{{\"error\": \"Invalid structure JSON: {}\"}}", e),
    };
    
    match append_test_structure(test_file_path, &append_structure) {
        Ok(steps_added) => format!("{{\"success\": true, \"steps_added\": {}}}", steps_added),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}

/// Get all available patterns from system and project .clt/patterns files
#[wasm_bindgen]
pub fn get_patterns_wasm(clt_binary_path: Option<String>) -> String {
    match get_patterns(clt_binary_path.as_deref()) {
        Ok(patterns) => serde_json::to_string(&patterns).unwrap_or_else(|e| {
            format!("{{\"error\": \"Failed to serialize patterns: {}\"}}", e)
        }),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}

/// Validate a test by comparing .rec file with its .rep result file (WASM binding)
#[wasm_bindgen]
pub fn validate_test_wasm(rec_file_path: &str) -> String {
    match parser::validate_test(rec_file_path) {
        Ok(result) => serde_json::to_string(&result).unwrap_or_else(|e| {
            format!("{{\"error\": \"Failed to serialize result: {}\"}}", e)
        }),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}

// ===== NEW WASM-COMPATIBLE FUNCTIONS (NO FILE SYSTEM OPERATIONS) =====

/// WASM-compatible function to parse .rec file using file content map
/// This avoids file system operations that are not supported in WASM
#[wasm_bindgen]
pub fn read_test_file_from_map_wasm(main_file_path: &str, file_map_json: &str) -> String {
    // Parse the file map from JSON
    let file_map: HashMap<String, String> = match serde_json::from_str(file_map_json) {
        Ok(map) => map,
        Err(e) => return format!("{{\"error\": \"Invalid file map JSON: {}\"}}", e),
    };

    match read_test_file_from_map(main_file_path, &file_map) {
        Ok(structure) => serde_json::to_string(&structure).unwrap_or_else(|e| {
            format!("{{\"error\": \"Failed to serialize result: {}\"}}", e)
        }),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}

/// WASM-compatible function to convert test structure to file content map
/// Returns a JSON object with file paths as keys and content as values
#[wasm_bindgen]
pub fn write_test_file_to_map_wasm(test_file_path: &str, test_structure_json: &str) -> String {
    let test_structure: TestStructure = match serde_json::from_str(test_structure_json) {
        Ok(s) => s,
        Err(e) => return format!("{{\"error\": \"Invalid JSON: {}\"}}", e),
    };
    
    match write_test_file_to_map(test_file_path, &test_structure) {
        Ok(file_map) => serde_json::to_string(&file_map).unwrap_or_else(|e| {
            format!("{{\"error\": \"Failed to serialize file map: {}\"}}", e)
        }),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}

/// WASM-compatible function to validate test using file content map
/// This avoids file system operations that are not supported in WASM
#[wasm_bindgen]
pub fn validate_test_from_map_wasm(
    rec_file_path: &str,
    file_map_json: &str,
    patterns_json: Option<String>
) -> String {
    // Parse the file map from JSON
    let file_map: HashMap<String, String> = match serde_json::from_str(file_map_json) {
        Ok(map) => map,
        Err(e) => return format!("{{\"error\": \"Invalid file map JSON: {}\"}}", e),
    };

    // Parse patterns if provided
    let patterns = if let Some(patterns_str) = patterns_json {
        match serde_json::from_str::<HashMap<String, String>>(&patterns_str) {
            Ok(p) => Some(p),
            Err(e) => return format!("{{\"error\": \"Invalid patterns JSON: {}\"}}", e),
        }
    } else {
        None
    };

    match validate_test_from_map_with_patterns(rec_file_path, &file_map, patterns) {
        Ok(result) => serde_json::to_string(&result).unwrap_or_else(|e| {
            format!("{{\"error\": \"Failed to serialize validation result: {}\"}}", e)
        }),
        Err(e) => format!("{{\"error\": \"{}\"}}", e),
    }
}