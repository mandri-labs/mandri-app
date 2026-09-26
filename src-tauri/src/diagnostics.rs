use std::{fs, path::PathBuf};

pub struct Logs {
    pub directory: PathBuf,
}

impl Logs {
    pub fn new() -> std::io::Result<Self> {
        let directory = std::env::temp_dir()
            .join("mandri")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory)?;
        Ok(Self { directory })
    }

    pub fn runtime(&self) -> PathBuf {
        self.directory.join("runtime.log")
    }

    pub fn daemon(&self) -> PathBuf {
        self.directory.join("daemon.log")
    }
}
