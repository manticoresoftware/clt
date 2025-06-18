use wasm_bindgen::prelude::*;
use regex::Regex;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use once_cell::sync::Lazy;

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

static VAR_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"%\{[A-Z]{1}[A-Z_0-9]*\}").unwrap()
});

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
                        let (ranges1, ranges2) = self.compute_diff_ranges(exp, act);
                        
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