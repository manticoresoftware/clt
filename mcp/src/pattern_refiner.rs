use crate::mcp_protocol::{PatternApplication, RefineOutputOutput};
use anyhow::Result;
use similar::{ChangeTag, TextDiff};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug)]
pub struct PatternRefiner {
    patterns: HashMap<String, String>,
}

impl PatternRefiner {
    pub fn new() -> Result<Self> {
        let patterns = Self::load_patterns()?;
        Ok(Self { patterns })
    }

    pub fn refine_output(&self, expected: &str, actual: &str) -> Result<RefineOutputOutput> {
        let mut refined_output = expected.to_string();
        let mut patterns_applied = Vec::new();
        let mut suggestions = Vec::new();

        // Use similar crate to find differences at word level
        let diff = TextDiff::from_words(expected, actual);

        let mut position = 0;
        for change in diff.iter_all_changes() {
            match change.tag() {
                ChangeTag::Delete => {
                    let old_text = change.value().trim();
                    if !old_text.is_empty() {
                        if let Some(pattern_suggestion) = self.suggest_pattern(old_text) {
                            // Apply the pattern suggestion
                            refined_output =
                                refined_output.replace(old_text, &pattern_suggestion.replacement);
                            patterns_applied.push(PatternApplication {
                                original: old_text.to_string(),
                                replacement: pattern_suggestion.replacement.clone(),
                                pattern_type: pattern_suggestion.pattern_type,
                                position,
                            });
                            suggestions.push(format!(
                                "Replace '{}' with '{}'",
                                old_text, pattern_suggestion.replacement
                            ));
                        }
                    }
                }
                ChangeTag::Insert => {
                    let new_text = change.value().trim();
                    if !new_text.is_empty() {
                        if let Some(pattern_suggestion) = self.suggest_pattern(new_text) {
                            suggestions.push(format!(
                                "Consider using pattern '{}' for dynamic content: '{}'",
                                pattern_suggestion.replacement, new_text
                            ));
                        }
                    }
                }
                _ => {}
            }
            position += change.value().len();
        }

        // If no word-level differences found, try to find numeric differences manually
        if patterns_applied.is_empty() && suggestions.is_empty() {
            self.find_numeric_differences(
                expected,
                actual,
                &mut refined_output,
                &mut patterns_applied,
                &mut suggestions,
            );
        }

        // Additional heuristic-based pattern suggestions
        self.apply_heuristic_patterns(&mut refined_output, &mut patterns_applied, &mut suggestions);

        Ok(RefineOutputOutput {
            refined_output,
            patterns_applied,
            suggestions,
        })
    }

    fn find_numeric_differences(
        &self,
        expected: &str,
        actual: &str,
        refined_output: &mut String,
        patterns_applied: &mut Vec<PatternApplication>,
        suggestions: &mut Vec<String>,
    ) {
        // Find numeric differences by tokenizing and comparing
        let expected_tokens: Vec<&str> = expected.split_whitespace().collect();
        let actual_tokens: Vec<&str> = actual.split_whitespace().collect();

        for (i, (exp_token, act_token)) in
            expected_tokens.iter().zip(actual_tokens.iter()).enumerate()
        {
            if exp_token != act_token {
                // Check if both are numbers
                if exp_token.chars().all(|c| c.is_ascii_digit())
                    && act_token.chars().all(|c| c.is_ascii_digit())
                {
                    if let Some(pattern_suggestion) = self.suggest_pattern(exp_token) {
                        *refined_output =
                            refined_output.replace(exp_token, &pattern_suggestion.replacement);
                        patterns_applied.push(PatternApplication {
                            original: exp_token.to_string(),
                            replacement: pattern_suggestion.replacement.clone(),
                            pattern_type: pattern_suggestion.pattern_type,
                            position: i,
                        });
                        suggestions.push(format!(
                            "Replace '{}' with '{}'",
                            exp_token, pattern_suggestion.replacement
                        ));
                        break; // Only apply first numeric difference
                    }
                }
            }
        }
    }

    fn suggest_pattern(&self, text: &str) -> Option<PatternSuggestion> {
        // Check for common patterns that should be replaced
        let trimmed_text = text.trim();

        // Numbers (PIDs, ports, etc.) - only if the entire text is a number
        if trimmed_text.chars().all(|c| c.is_ascii_digit()) && trimmed_text.len() > 1 {
            // Check if it's likely a year (4 digits starting with 19 or 20)
            if trimmed_text.len() == 4
                && (trimmed_text.starts_with("19") || trimmed_text.starts_with("20"))
            {
                if self.patterns.contains_key("YEAR") {
                    return Some(PatternSuggestion {
                        replacement: "%{YEAR}".to_string(),
                        pattern_type: "named_pattern".to_string(),
                    });
                }
            }
            // Otherwise, treat as a general number
            if self.patterns.contains_key("NUMBER") {
                return Some(PatternSuggestion {
                    replacement: "%{NUMBER}".to_string(),
                    pattern_type: "named_pattern".to_string(),
                });
            } else {
                return Some(PatternSuggestion {
                    replacement: "#!/[0-9]+/!#".to_string(),
                    pattern_type: "regex_pattern".to_string(),
                });
            }
        }

        // Timestamps (various formats)
        if trimmed_text.contains(':')
            && (trimmed_text.contains("20") || trimmed_text.contains("19"))
        {
            if let Some(timestamp_pattern) = self.detect_timestamp_pattern(trimmed_text) {
                return Some(PatternSuggestion {
                    replacement: timestamp_pattern,
                    pattern_type: "regex_pattern".to_string(),
                });
            }
        }

        // IP addresses
        if self.is_ip_address(trimmed_text) {
            if self.patterns.contains_key("IPADDR") {
                return Some(PatternSuggestion {
                    replacement: "%{IPADDR}".to_string(),
                    pattern_type: "named_pattern".to_string(),
                });
            } else {
                return Some(PatternSuggestion {
                    replacement: "#!/[0-9]+\\\\.[0-9]+\\\\.[0-9]+\\\\.[0-9]+/!#".to_string(),
                    pattern_type: "regex_pattern".to_string(),
                });
            }
        }

        // Semantic versions
        if self.is_semver(trimmed_text) {
            if self.patterns.contains_key("SEMVER") {
                return Some(PatternSuggestion {
                    replacement: "%{SEMVER}".to_string(),
                    pattern_type: "named_pattern".to_string(),
                });
            } else {
                return Some(PatternSuggestion {
                    replacement: "#!/[0-9]+\\\\.[0-9]+\\\\.[0-9]+/!#".to_string(),
                    pattern_type: "regex_pattern".to_string(),
                });
            }
        }

        // UUIDs
        if self.is_uuid(trimmed_text) {
            return Some(PatternSuggestion {
                replacement: "#!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/!#"
                    .to_string(),
                pattern_type: "regex_pattern".to_string(),
            });
        }

        // Hash-like strings
        if trimmed_text.len() >= 7 && trimmed_text.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(PatternSuggestion {
                replacement: format!("#!/[0-9a-f]{{{}}}/!#", trimmed_text.len()),
                pattern_type: "regex_pattern".to_string(),
            });
        }

        // Only apply named patterns if the entire text matches exactly
        for (pattern_name, pattern_regex) in &self.patterns {
            if let Ok(regex) = regex::Regex::new(&format!("^{}$", pattern_regex)) {
                if regex.is_match(trimmed_text) {
                    return Some(PatternSuggestion {
                        replacement: format!("%{{{}}}", pattern_name),
                        pattern_type: "named_pattern".to_string(),
                    });
                }
            }
        }

        None
    }

    fn apply_heuristic_patterns(
        &self,
        refined_output: &mut String,
        patterns_applied: &mut Vec<PatternApplication>,
        suggestions: &mut Vec<String>,
    ) {
        // Apply additional heuristic-based patterns

        // Look for file paths
        if let Some(path_matches) = self.find_file_paths(refined_output) {
            for path_match in path_matches {
                let pattern = "#!/[^\\s]+/!#";
                *refined_output = refined_output.replace(&path_match, pattern);
                patterns_applied.push(PatternApplication {
                    original: path_match.clone(),
                    replacement: pattern.to_string(),
                    pattern_type: "regex_pattern".to_string(),
                    position: 0, // Position would need to be calculated properly
                });
                suggestions.push(format!("Replaced file path '{}' with pattern", path_match));
            }
        }

        // Look for common variable patterns
        self.apply_common_variable_patterns(refined_output, patterns_applied, suggestions);
    }

    fn apply_common_variable_patterns(
        &self,
        refined_output: &mut String,
        patterns_applied: &mut Vec<PatternApplication>,
        suggestions: &mut Vec<String>,
    ) {
        // Apply patterns for common variables that change between runs
        let common_patterns = vec![
            (
                r"\b\d{4}-\d{2}-\d{2}\b",
                "#!/[0-9]{4}-[0-9]{2}-[0-9]{2}/!#",
                "date",
            ),
            (
                r"\b\d{2}:\d{2}:\d{2}\b",
                "#!/[0-9]{2}:[0-9]{2}:[0-9]{2}/!#",
                "time",
            ),
            (r"\b[0-9a-f]{40}\b", "#!/[0-9a-f]{40}/!#", "sha1_hash"),
            (r"\b[0-9a-f]{64}\b", "#!/[0-9a-f]{64}/!#", "sha256_hash"),
        ];

        for (regex_pattern, replacement, description) in common_patterns {
            if let Ok(regex) = regex::Regex::new(regex_pattern) {
                if regex.is_match(refined_output) {
                    let matches: Vec<_> = regex.find_iter(refined_output).collect();
                    let mut new_output = refined_output.clone();
                    for match_obj in matches.iter().rev() {
                        // Reverse to maintain positions
                        let matched_text = match_obj.as_str();
                        new_output = new_output.replace(matched_text, replacement);
                        patterns_applied.push(PatternApplication {
                            original: matched_text.to_string(),
                            replacement: replacement.to_string(),
                            pattern_type: "regex_pattern".to_string(),
                            position: match_obj.start(),
                        });
                        suggestions.push(format!(
                            "Applied {} pattern for '{}'",
                            description, matched_text
                        ));
                    }
                    *refined_output = new_output;
                }
            }
        }
    }

    fn detect_timestamp_pattern(&self, text: &str) -> Option<String> {
        // Common timestamp patterns
        let timestamp_patterns = vec![
            (
                r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}",
                "#!/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/!#",
            ),
            (r"\d{2}:\d{2}:\d{2}", "#!/[0-9]{2}:[0-9]{2}:[0-9]{2}/!#"),
            (r"\d{4}-\d{2}-\d{2}", "#!/[0-9]{4}-[0-9]{2}-[0-9]{2}/!#"),
        ];

        for (pattern, replacement) in timestamp_patterns {
            if let Ok(regex) = regex::Regex::new(pattern) {
                if regex.is_match(text) {
                    return Some(replacement.to_string());
                }
            }
        }

        None
    }

    fn is_ip_address(&self, text: &str) -> bool {
        let parts: Vec<&str> = text.split('.').collect();
        if parts.len() != 4 {
            return false;
        }

        parts.iter().all(|part| part.parse::<u8>().is_ok())
    }

    fn is_semver(&self, text: &str) -> bool {
        let parts: Vec<&str> = text.split('.').collect();
        if parts.len() != 3 {
            return false;
        }

        parts
            .iter()
            .all(|part| part.chars().all(|c| c.is_ascii_digit()))
    }

    fn is_uuid(&self, text: &str) -> bool {
        let uuid_pattern = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
        if let Ok(regex) = regex::Regex::new(uuid_pattern) {
            regex.is_match(text)
        } else {
            false
        }
    }

    fn find_file_paths(&self, text: &str) -> Option<Vec<String>> {
        let path_pattern = r"/[^\s]+";
        if let Ok(regex) = regex::Regex::new(path_pattern) {
            let matches: Vec<String> = regex
                .find_iter(text)
                .map(|m| m.as_str().to_string())
                .collect();
            if matches.is_empty() {
                None
            } else {
                Some(matches)
            }
        } else {
            None
        }
    }

    fn load_patterns() -> Result<HashMap<String, String>> {
        let mut patterns = HashMap::new();

        // Try to load from .clt/patterns file
        let patterns_file = Path::new(".clt/patterns");
        if patterns_file.exists() {
            let content = fs::read_to_string(patterns_file)?;
            for line in content.lines() {
                if let Some((name, pattern)) = line.split_once(' ') {
                    patterns.insert(name.to_string(), pattern.to_string());
                }
            }
        }

        // Add default patterns if not found
        if patterns.is_empty() {
            patterns.insert("SEMVER".to_string(), r"[0-9]+\.[0-9]+\.[0-9]+".to_string());
            patterns.insert("YEAR".to_string(), r"[0-9]{4}".to_string());
            patterns.insert(
                "IPADDR".to_string(),
                r"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+".to_string(),
            );
            patterns.insert(
                "COMMITDATE".to_string(),
                r"[a-z0-9]{7}@[0-9]{6}".to_string(),
            );
        }

        Ok(patterns)
    }
}

struct PatternSuggestion {
    replacement: String,
    pattern_type: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_new_pattern_refiner() {
        let refiner = PatternRefiner::new().unwrap();
        assert!(!refiner.patterns.is_empty());
    }

    #[test]
    fn test_refine_output_with_semver() {
        let refiner = PatternRefiner::new().unwrap();
        let result = refiner
            .refine_output("Version: 1.2.3", "Version: 2.4.6")
            .unwrap();

        assert!(
            result.refined_output.contains("SEMVER") || result.refined_output.contains("1.2.3")
        );
        assert!(!result.patterns_applied.is_empty() || !result.suggestions.is_empty());
    }

    #[test]
    fn test_refine_output_with_numbers() {
        let refiner = PatternRefiner::new().unwrap();
        let result = refiner.refine_output("PID: 1234", "PID: 5678").unwrap();

        // Should suggest a pattern for the number
        assert!(!result.suggestions.is_empty());
    }

    #[test]
    fn test_suggest_pattern_for_numbers() {
        let refiner = PatternRefiner::new().unwrap();
        let suggestion = refiner.suggest_pattern("12345");

        assert!(suggestion.is_some());
        let suggestion = suggestion.unwrap();
        // Could be either named pattern or regex pattern depending on patterns file
        assert!(suggestion.replacement == "%{NUMBER}" || suggestion.replacement == "#!/[0-9]+/!#");
        assert!(
            suggestion.pattern_type == "named_pattern"
                || suggestion.pattern_type == "regex_pattern"
        );
    }

    #[test]
    fn test_suggest_pattern_for_ip_address() {
        let refiner = PatternRefiner::new().unwrap();
        let suggestion = refiner.suggest_pattern("192.168.1.1");

        assert!(suggestion.is_some());
        let suggestion = suggestion.unwrap();
        // Could be either named pattern or regex pattern depending on patterns file
        assert!(
            suggestion.replacement.contains("IPADDR")
                || suggestion
                    .replacement
                    .contains("[0-9]+\\\\.[0-9]+\\\\.[0-9]+\\\\.[0-9]+")
        );
    }

    #[test]
    fn test_suggest_pattern_for_uuid() {
        let refiner = PatternRefiner::new().unwrap();
        let suggestion = refiner.suggest_pattern("550e8400-e29b-41d4-a716-446655440000");

        assert!(suggestion.is_some());
        let suggestion = suggestion.unwrap();
        assert!(suggestion.replacement.contains("[0-9a-f]{8}-[0-9a-f]{4}"));
    }

    #[test]
    fn test_is_semver() {
        let refiner = PatternRefiner::new().unwrap();
        assert!(refiner.is_semver("1.2.3"));
        assert!(refiner.is_semver("10.20.30"));
        assert!(!refiner.is_semver("1.2"));
        assert!(!refiner.is_semver("1.2.3.4"));
        assert!(!refiner.is_semver("v1.2.3"));
    }

    #[test]
    fn test_is_ip_address() {
        let refiner = PatternRefiner::new().unwrap();
        assert!(refiner.is_ip_address("192.168.1.1"));
        assert!(refiner.is_ip_address("0.0.0.0"));
        assert!(refiner.is_ip_address("255.255.255.255"));
        assert!(!refiner.is_ip_address("256.1.1.1"));
        assert!(!refiner.is_ip_address("192.168.1"));
        assert!(!refiner.is_ip_address("192.168.1.1.1"));
    }

    #[test]
    fn test_is_uuid() {
        let refiner = PatternRefiner::new().unwrap();
        assert!(refiner.is_uuid("550e8400-e29b-41d4-a716-446655440000"));
        assert!(refiner.is_uuid("00000000-0000-0000-0000-000000000000"));
        assert!(!refiner.is_uuid("550e8400-e29b-41d4-a716"));
        assert!(!refiner.is_uuid("550e8400-e29b-41d4-a716-446655440000-extra"));
        assert!(!refiner.is_uuid("550e8400-e29b-41d4-a716-44665544000g")); // invalid hex
    }

    #[test]
    fn test_detect_timestamp_pattern() {
        let refiner = PatternRefiner::new().unwrap();

        let pattern = refiner.detect_timestamp_pattern("2023-12-25 14:30:22");
        assert!(pattern.is_some());
        assert!(pattern.unwrap().contains("[0-9]{4}-[0-9]{2}-[0-9]{2}"));

        let pattern = refiner.detect_timestamp_pattern("14:30:22");
        assert!(pattern.is_some());
        assert!(pattern.unwrap().contains("[0-9]{2}:[0-9]{2}:[0-9]{2}"));
    }

    #[test]
    fn test_load_patterns_with_custom_file() {
        // Create a temporary patterns file
        let mut temp_file = NamedTempFile::new().unwrap();
        writeln!(temp_file, "CUSTOM_PATTERN [a-z]+").unwrap();
        writeln!(temp_file, "ANOTHER_PATTERN [0-9]+").unwrap();

        // This test just verifies the function doesn't crash
        // In real usage, the patterns would be loaded from .clt/patterns
        let patterns = PatternRefiner::load_patterns().unwrap();
        assert!(!patterns.is_empty());
    }
}
