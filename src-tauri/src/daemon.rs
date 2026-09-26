use crate::{
    diagnostics::Logs,
    provision::{command, provision, BACKEND_VERSION, CANCELLED},
};
use serde::Serialize;
use std::{
    fs::OpenOptions,
    net::TcpListener,
    process::{Child, Stdio},
    sync::{atomic::Ordering, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub base_url: String,
    pub token: String,
}

pub struct OwnedDaemon {
    child: Child,
    connection: Connection,
}

#[derive(Default)]
pub struct DaemonState(pub Mutex<Option<OwnedDaemon>>);

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())
}

impl OwnedDaemon {
    fn stop(&mut self) {
        if let Ok(client) = client() {
            let _ = client
                .post(format!("{}/_desktop/shutdown", self.connection.base_url))
                .bearer_auth(&self.connection.token)
                .send();
        }
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(12) {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for OwnedDaemon {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn stop(app: &AppHandle) {
    CANCELLED.store(true, Ordering::SeqCst);
    if let Ok(mut state) = app.state::<DaemonState>().0.lock() {
        state.take();
    }
}

fn start(app: AppHandle) -> Result<Connection, String> {
    let state = app.state::<DaemonState>();
    let mut owned = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(daemon) = owned.as_mut() {
        if daemon
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Ok(daemon.connection.clone());
        }
    }
    owned.take();
    let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
    let uv = resource
        .join("runtime")
        .join(if cfg!(windows) { "uv.exe" } else { "uv" });
    let logs = app.state::<Logs>();
    let python = provision(&data, &uv, &logs.runtime())?;
    if CANCELLED.load(Ordering::SeqCst) {
        return Err("Startup cancelled".into());
    }
    let port = TcpListener::bind("127.0.0.1:0")
        .and_then(|s| s.local_addr())
        .map_err(|e| e.to_string())?
        .port();
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let connection = Connection {
        base_url: format!("http://127.0.0.1:{port}"),
        token,
    };
    let log_path = logs.daemon();
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Cannot write {}: {e}", log_path.display()))?;
    let child = crate::daemon_command::configure(&mut command(&python), port)
        .env("MANDRI_DESKTOP_TOKEN", &connection.token)
        .env("MANDRI_DESKTOP_PARENT_PID", std::process::id().to_string())
        .env_remove("CUSTOM_TIKTOKEN_CACHE_DIR")
        .env("LITELLM_LOCAL_MODEL_COST_MAP", "True")
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut daemon = OwnedDaemon {
        child,
        connection: connection.clone(),
    };
    let http = client()?;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(90) {
        if CANCELLED.load(Ordering::SeqCst) {
            return Err("Startup cancelled".into());
        }
        if daemon
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err(format!(
                "The local daemon stopped during startup. Logs: {}",
                log_path.display()
            ));
        }
        if let Ok(response) = http
            .get(format!("{}/_desktop/status", connection.base_url))
            .bearer_auth(&connection.token)
            .send()
        {
            if let Ok(body) = response.json::<serde_json::Value>() {
                if body["version"] == BACKEND_VERSION {
                    *owned = Some(daemon);
                    return Ok(connection);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "The local daemon did not become ready within 90 seconds. Logs: {}",
        log_path.display()
    ))
}

#[tauri::command]
pub async fn ensure_daemon(app: AppHandle) -> Result<Connection, String> {
    tauri::async_runtime::spawn_blocking(move || start(app))
        .await
        .map_err(|e| e.to_string())?
}
