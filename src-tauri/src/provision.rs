use std::{
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub const BACKEND_VERSION: &str = "0.2.0b0";
pub static CANCELLED: AtomicBool = AtomicBool::new(false);

pub fn command(program: &Path) -> Command {
    let command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = command;
        command.creation_flags(0x08000000);
        command
    }
    #[cfg(not(windows))]
    command
}

fn run(command: &mut Command, log_path: &Path, operation: &str) -> Result<(), String> {
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| format!("Cannot write {}: {e}", log_path.display()))?;
    writeln!(log, "\n{operation}").map_err(|e| e.to_string())?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log.try_clone().map_err(|e| e.to_string())?)
        .spawn()
        .map_err(|e| {
            let _ = writeln!(log, "Could not start: {e}");
            format!(
                "{operation} could not start: {e}. Logs: {}",
                log_path.display()
            )
        })?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let _ = writeln!(log, "Finished: {status}");
            return if status.success() {
                Ok(())
            } else {
                Err(format!(
                    "{operation} failed ({status}). Logs: {}",
                    log_path.display()
                ))
            };
        }
        if CANCELLED.load(Ordering::SeqCst) || started.elapsed() > Duration::from_secs(600) {
            let _ = child.kill();
            let _ = child.wait();
            let reason = if CANCELLED.load(Ordering::SeqCst) {
                "cancelled"
            } else {
                "timed out"
            };
            let _ = writeln!(log, "{operation} {reason}");
            return Err(format!(
                "{operation} {reason}. Logs: {}",
                log_path.display()
            ));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

pub fn python_path(root: &Path) -> PathBuf {
    root.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    })
}

fn runtime_command(data: &Path, uv: &Path) -> Command {
    let mut cmd = command(uv);
    cmd.env_clear();
    for key in [
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "HOME",
        "USERPROFILE",
        "LOCALAPPDATA",
        "PATH",
        "SSL_CERT_FILE",
    ] {
        if let Some(value) = std::env::var_os(key) {
            cmd.env(key, value);
        }
    }
    cmd.current_dir(data)
        .env("UV_PYTHON_INSTALL_DIR", data.join("python"))
        .env("UV_CACHE_DIR", data.join("cache"))
        .env("UV_PYTHON_PREFERENCE", "only-managed")
        .arg("--no-config");
    cmd
}

fn create_environment(data: &Path, uv: &Path, root: &Path, log_path: &Path) -> Result<(), String> {
    run(
        runtime_command(data, uv)
            .args(["venv", "--python", "3.13"])
            .arg(root),
        log_path,
        "Python installation",
    )
}

pub fn provision(data: &Path, uv: &Path, log_path: &Path) -> Result<PathBuf, String> {
    let root = data.join("runtime").join(BACKEND_VERSION);
    let python = python_path(&root);
    let marker = root.join("mandri-installed");
    if marker.is_file() && python.is_file() {
        return Ok(python);
    }
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    if !python.is_file() {
        create_environment(data, uv, &root, log_path)?;
    }
    run(
        runtime_command(data, uv)
            .args([
                "pip",
                "install",
                "--index-url",
                "https://pypi.org/simple",
                "--python",
            ])
            .arg(&python)
            .arg(format!("mandri=={BACKEND_VERSION}")),
        log_path,
        "Backend installation",
    )?;
    std::fs::write(marker, BACKEND_VERSION).map_err(|e| e.to_string())?;
    Ok(python)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Logs;

    fn output_command(fail: bool) -> Command {
        let mut cmd = command(Path::new(if cfg!(windows) { "cmd.exe" } else { "/bin/sh" }));
        if cfg!(windows) {
            cmd.args([
                "/D",
                "/C",
                if fail {
                    "echo standard-output & echo diagnostic-output 1>&2 & exit /b 2"
                } else {
                    "echo retry-output & exit /b 0"
                },
            ]);
        } else {
            cmd.args([
                "-c",
                if fail {
                    "echo standard-output; echo diagnostic-output >&2; exit 2"
                } else {
                    "echo retry-output; exit 0"
                },
            ]);
        }
        cmd
    }

    #[test]
    fn records_both_streams_and_retains_failed_attempts() {
        let logs = Logs::new().unwrap();
        let path = logs.runtime();
        let error = run(&mut output_command(true), &path, "Test installation").unwrap_err();
        assert!(error.contains(path.to_str().unwrap()));
        run(&mut output_command(false), &path, "Retry installation").unwrap();
        let contents = std::fs::read_to_string(path).unwrap();
        for message in [
            "standard-output",
            "diagnostic-output",
            "retry-output",
            "Finished:",
        ] {
            assert!(contents.contains(message), "Missing {message}: {contents}");
        }
    }

    #[test]
    fn records_spawn_failures_with_the_log_location() {
        let logs = Logs::new().unwrap();
        let path = logs.runtime();
        let error = run(
            &mut command(&logs.directory.join("missing-command")),
            &path,
            "Python installation",
        )
        .unwrap_err();
        assert!(error.contains(path.to_str().unwrap()));
        assert!(std::fs::read_to_string(path)
            .unwrap()
            .contains("Could not start:"));
    }

    #[test]
    #[ignore = "Downloads managed Python using the bundled uv executable"]
    fn creates_managed_python_with_bundled_uv() {
        let logs = Logs::new().unwrap();
        let uv = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("runtime")
            .join(if cfg!(windows) { "uv.exe" } else { "uv" });
        let root = logs.directory.join("runtime");
        create_environment(&logs.directory, &uv, &root, &logs.runtime()).unwrap();
        assert!(python_path(&root).is_file());
        assert!(std::fs::read_to_string(logs.runtime())
            .unwrap()
            .contains("Finished:"));
    }
}
