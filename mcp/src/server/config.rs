use anyhow::Result;

/// Server configuration extracted from command line arguments
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub docker_image: String,
    pub clt_binary_path: Option<String>,
    pub workdir_path: String,
}

impl ServerConfig {
    pub fn new(
        docker_image: String,
        clt_binary_path: Option<String>,
        workdir_path: Option<String>,
    ) -> Result<Self> {
        // Resolve working directory - use provided path or current directory
        let workdir_path = match workdir_path {
            Some(path) => {
                let path_buf = std::path::PathBuf::from(&path);
                if !path_buf.exists() {
                    return Err(anyhow::anyhow!(
                        "Working directory does not exist: {}",
                        path
                    ));
                }
                if !path_buf.is_dir() {
                    return Err(anyhow::anyhow!(
                        "Working directory path is not a directory: {}",
                        path
                    ));
                }
                // Convert to absolute path
                std::fs::canonicalize(path_buf)
                    .map_err(|e| {
                        anyhow::anyhow!("Failed to resolve working directory path: {}", e)
                    })?
                    .to_string_lossy()
                    .to_string()
            }
            None => {
                // Use current working directory
                std::env::current_dir()
                    .map_err(|e| anyhow::anyhow!("Failed to get current working directory: {}", e))?
                    .to_string_lossy()
                    .to_string()
            }
        };

        Ok(Self {
            docker_image,
            clt_binary_path,
            workdir_path,
        })
    }
}