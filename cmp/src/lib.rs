// Library functions for CLT comparison functionality

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use regex::Regex;

#[derive(Debug)]
pub enum MatchingPart {
    Static(String),
    Pattern(String),
}

pub struct PatternMatcher {
    config: HashMap<String, String>,
    var_regex: Regex,
}

impl PatternMatcher {
    /// Initialize struct by using file name of the variables description for patterns
    /// If the option is none, we just will have empty map of keys for patterns
    /// And in that case we will use only raw regexes to validate
    pub fn new(file_name: Option<String>) -> Result<Self, Box<dyn std::error::Error>> {
        let config = match file_name {
            Some(file_name) => Self::parse_config(file_name)?,
            None => HashMap::new(),
        };

        let var_regex = Regex::new(r"%\{[A-Z]{1}[A-Z_0-9]*\}")?;
        Ok(Self { config, var_regex })
    }

    /// Validate line from .rec file and line from .rep file
    /// by using open regex patterns and matched variables
    /// and return true or false in case if we have diff or not
    pub fn has_diff(&self, rec_line: String, rep_line: String) -> bool {
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
                    let pattern_regex = Regex::new(&pattern).unwrap();
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

    /// Helper method to split line into parts
    /// To make it possible to validate pattern matched vars and static parts
    pub fn split_into_parts(&self, rec_line: &str) -> Vec<MatchingPart> {
        let mut parts = Vec::new();

        let first_splits: Vec<&str> = rec_line.split("#!/").collect();
        for first_split in first_splits {
            let second_splits: Vec<&str> = first_split.split("/!#").collect();
            if second_splits.len() == 1 {
                parts.push(MatchingPart::Static(second_splits.first().unwrap().to_string()));
            } else {
                for (i, second_split) in second_splits.iter().enumerate() {
                    if i % 2 == 1 {
                        parts.push(MatchingPart::Static(second_split.to_string()));
                    } else {
                        parts.push(MatchingPart::Pattern(second_split.to_string()));
                    }
                }
            }
        }
        parts
    }

    /// Helper function that go through matched variable patterns in line
    /// And replace it all with values from our parsed config
    /// So we have raw regex to validate as an output
    pub fn replace_vars_to_patterns(&self, line: String) -> String {
        let result = self.var_regex.replace_all(&line, |caps: &regex::Captures| {
            let matched = &caps[0];
            let key = matched[2..matched.len() - 1].to_string();
            self.config.get(&key).unwrap_or(&matched.to_string()).clone()
        });

        result.into_owned()
    }

    /// Helper to parse the variables into config map when we pass path to the file
    fn parse_config(file_name: String) -> Result<HashMap<String, String>, Box<dyn std::error::Error>> {
        let mut config: HashMap<String, String> = HashMap::new();

        let file_path = std::path::Path::new(&file_name);
        let file = File::open(&file_path)?;
        let reader = BufReader::new(file);

        for line in reader.lines() {
            let line = line?.trim().to_string();
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 2 {
                config.insert(
                    parts[0].trim().to_string(),
                    format!("#!/{}/!#", parts[1].trim())
                );
            }
        }

        Ok(config)
    }
}