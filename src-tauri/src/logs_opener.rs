use std::path::Path;

pub fn open(directory: &Path) -> Result<(), String> {
    open_directory(directory).map_err(|error| {
        format!(
            "Cannot open the logs folder: {error}\nLogs: {}",
            directory.display()
        )
    })
}

#[cfg(not(target_os = "linux"))]
fn open_directory(directory: &Path) -> Result<(), String> {
    tauri_plugin_opener::open_path(directory, None::<&str>).map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
use std::{
    ffi::OsString,
    fs::File,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

// AppRun prepends bundled libraries, executables and GTK/Qt resources. System
// launchers must not inherit them: a newer host gio can crash against bundled GLib.
// Only change the child environment and preserve the user's host paths/session.
#[cfg(target_os = "linux")]
fn host_environment(
    command: &mut Command,
    app_dir: &Path,
    environment: impl IntoIterator<Item = (OsString, OsString)>,
) -> Result<(), String> {
    if !app_dir.is_absolute() {
        return Ok(());
    }
    const PATH_VARIABLES: &[&str] = &[
        "PATH",
        "LD_LIBRARY_PATH",
        "PYTHONPATH",
        "XDG_DATA_DIRS",
        "GSETTINGS_SCHEMA_DIR",
        "GI_TYPELIB_PATH",
        "GTK_DATA_PREFIX",
        "GTK_EXE_PREFIX",
        "GTK_PATH",
        "GTK_IM_MODULE_FILE",
        "GDK_PIXBUF_MODULE_FILE",
        "GIO_EXTRA_MODULES",
        "GIO_MODULE_DIR",
        "QT_PLUGIN_PATH",
        "QT_QPA_PLATFORM_PLUGIN_PATH",
        "GST_PLUGIN_SYSTEM_PATH",
        "GST_PLUGIN_SYSTEM_PATH_1_0",
    ];
    for (key, value) in environment {
        if !PATH_VARIABLES.iter().any(|name| key == *name) {
            continue;
        }
        let paths: Vec<_> = std::env::split_paths(&value).collect();
        if !paths.iter().any(|path| path.starts_with(app_dir)) {
            continue;
        }
        let host_paths: Vec<_> = paths
            .into_iter()
            .filter(|path| !path.as_os_str().is_empty() && !path.starts_with(app_dir))
            .collect();
        if host_paths.is_empty() {
            command.env_remove(&key);
        } else {
            command.env(
                &key,
                std::env::join_paths(host_paths).map_err(|error| error.to_string())?,
            );
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn open_directory(directory: &Path) -> Result<(), String> {
    let mut command = Command::new("xdg-open");
    command.arg(directory);
    if let Some(app_dir) = std::env::var_os("APPDIR") {
        host_environment(&mut command, Path::new(&app_dir), std::env::vars_os())?;
    }
    run_launcher(
        &mut command,
        &directory.join("opener.log"),
        Duration::from_secs(10),
    )
}

#[cfg(target_os = "linux")]
fn run_launcher(command: &mut Command, log_path: &Path, timeout: Duration) -> Result<(), String> {
    let log = File::create(log_path).map_err(|error| error.to_string())?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|error| format!("Unable to start the file manager: {error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                let details = std::fs::read_to_string(log_path).unwrap_or_default();
                return Err(format!(
                    "File manager launcher failed ({status}). {}",
                    details.trim()
                ));
            }
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50))
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(error) => error.to_string(),
                    _ => "The file manager launcher did not respond in time".into(),
                });
            }
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn removes_appimage_paths_but_preserves_host_paths_and_session() {
        let mut command = Command::new("/usr/bin/env");
        command.env_clear();
        let environment: Vec<(OsString, OsString)> = [
            ("PATH", "/tmp/app/usr/bin:/usr/bin:/bin"),
            (
                "LD_LIBRARY_PATH",
                "/tmp/app/usr/lib:/opt/host/lib:/tmp/application/lib:",
            ),
            ("GTK_PATH", "/tmp/app//usr/lib/gtk-3.0"),
            (
                "GSETTINGS_SCHEMA_DIR",
                "/tmp/app/usr/share/glib-2.0/schemas/:",
            ),
            ("GIO_EXTRA_MODULES", "/tmp/app/usr/lib/gio/modules"),
            (
                "XDG_DATA_DIRS",
                "/tmp/app/usr/share:/usr/local/share:/usr/share",
            ),
            ("DISPLAY", ":99"),
            ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
        ]
        .into_iter()
        .map(|(key, value)| (key.into(), value.into()))
        .collect();
        command.envs(environment.clone());
        host_environment(&mut command, Path::new("/tmp/app"), environment).unwrap();
        let output = String::from_utf8(command.output().unwrap().stdout).unwrap();
        assert!(output.lines().any(|line| line == "PATH=/usr/bin:/bin"));
        assert!(output
            .lines()
            .any(|line| line == "LD_LIBRARY_PATH=/opt/host/lib:/tmp/application/lib"));
        assert!(output
            .lines()
            .any(|line| line == "XDG_DATA_DIRS=/usr/local/share:/usr/share"));
        assert!(output.lines().any(|line| line == "DISPLAY=:99"));
        assert!(output
            .lines()
            .any(|line| line == "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus"));
        for key in ["GTK_PATH=", "GSETTINGS_SCHEMA_DIR=", "GIO_EXTRA_MODULES="] {
            assert!(!output.lines().any(|line| line.starts_with(key)));
        }
    }

    #[test]
    fn reports_launcher_failure_instead_of_silent_success() {
        let logs = crate::diagnostics::Logs::new().unwrap();
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "echo 'gio: symbol lookup error' >&2; exit 3"]);
        let error = run_launcher(
            &mut command,
            &logs.directory.join("opener.log"),
            Duration::from_secs(1),
        )
        .unwrap_err();
        assert!(error.contains("exit status: 3"));
        assert!(error.contains("gio: symbol lookup error"));
        std::fs::remove_dir_all(logs.directory).unwrap();
    }

    #[test]
    fn accepts_success_and_bounds_a_stuck_launcher() {
        let logs = crate::diagnostics::Logs::new().unwrap();
        let log_path = logs.directory.join("opener.log");
        run_launcher(
            &mut Command::new("/bin/true"),
            &log_path,
            Duration::from_secs(1),
        )
        .unwrap();
        let mut command = Command::new("/bin/sleep");
        command.arg("30");
        let started = Instant::now();
        let error = run_launcher(&mut command, &log_path, Duration::from_millis(50)).unwrap_err();
        assert!(error.contains("did not respond"));
        assert!(started.elapsed() < Duration::from_secs(2));
        std::fs::remove_dir_all(logs.directory).unwrap();
    }

    #[test]
    fn reports_a_missing_launcher_and_includes_the_log_path_on_failure() {
        let logs = crate::diagnostics::Logs::new().unwrap();
        let error = run_launcher(
            &mut Command::new(logs.directory.join("missing-launcher")),
            &logs.directory.join("opener.log"),
            Duration::from_secs(1),
        )
        .unwrap_err();
        assert!(error.contains("Unable to start the file manager"));
        let missing = logs.directory.join("missing-directory");
        let error = open(&missing).unwrap_err();
        assert!(error.contains("Cannot open the logs folder"));
        assert!(error.contains(&format!("Logs: {}", missing.display())));
        std::fs::remove_dir_all(logs.directory).unwrap();
    }
}
