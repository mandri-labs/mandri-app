#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

mod daemon;
mod daemon_command;
mod diagnostics;
mod logs_opener;
mod provision;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State, WindowEvent,
};

const PREFERENCES_FILE_NAME: &str = "preferences.json";

struct CloseToTrayState(AtomicBool);
static QUITTING: AtomicBool = AtomicBool::new(false);

fn request_quit(app: &AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    app.dialog()
        .message("Quit Mandri and stop its local sessions?")
        .title("Quit Mandri")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".into(),
            "Cancel".into(),
        ))
        .show(move |confirmed| {
            if confirmed {
                let app = handle.clone();
                std::thread::spawn(move || {
                    daemon::stop(&app);
                    app.exit(0);
                });
            } else {
                QUITTING.store(false, Ordering::SeqCst);
            }
        });
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn set_close_to_tray(state: State<'_, CloseToTrayState>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn preferences_read(app: AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::read_to_string(dir.join(PREFERENCES_FILE_NAME)).ok()
}

#[tauri::command]
fn preferences_write(app: AppHandle, value: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("unable to resolve app data directory: {}", error))?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("unable to create app data directory: {}", error))?;
    std::fs::write(dir.join(PREFERENCES_FILE_NAME), value)
        .map_err(|error| format!("unable to write preferences file: {}", error))?;
    Ok(())
}

#[tauri::command]
async fn open_logs(app: AppHandle) -> Result<(), String> {
    let directory = app.state::<diagnostics::Logs>().directory.clone();
    tauri::async_runtime::spawn_blocking(move || logs_opener::open(&directory))
        .await
        .map_err(|error| error.to_string())?
}

fn main() {
    let logs = diagnostics::Logs::new().expect("unable to create temporary log directory");
    let logger = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::Folder {
                path: logs.directory.clone(),
                file_name: Some("app".into()),
            },
        ))
        .max_file_size(5_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .build();
    tauri::Builder::default()
        .manage(logs)
        .manage(CloseToTrayState(AtomicBool::new(false)))
        .manage(daemon::DaemonState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(logger)
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app.state::<CloseToTrayState>().0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    api.prevent_close();
                    request_quit(app);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            preferences_read,
            preferences_write,
            daemon::ensure_daemon,
            open_logs
        ])
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let logs_item = MenuItem::with_id(app, "logs", "Open logs", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &logs_item, &quit_item])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("missing default window icon")?;
            TrayIconBuilder::with_id("mandri-tray")
                .icon(icon)
                .tooltip("Mandri")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "logs" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = open_logs(app.clone()).await {
                                app.dialog().message(error).title("Open logs").show(|_| {});
                            }
                        });
                    }
                    "quit" => request_quit(app),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                daemon::stop(app);
            }
        });
}
