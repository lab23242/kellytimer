//! kellytimer: a frameless Pomodoro timer. The timer logic and drawing live in the webview
//! (src/); this side owns the window, tray, phase-end alarm, notifications and sound.

mod alarm;
mod layout;
mod sound;
mod tray;

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalSize, Manager, Runtime, WebviewWindow, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt, DEFAULT_FILENAME};

/// Shared with the frontend (src/platform/bridge.js).
pub const STORE_FILE: &str = "kellytimer.json";
const MAIN: &str = "main";

static MOVE_GENERATION: AtomicU64 = AtomicU64::new(0);

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN)
}

fn log_err<T, E: std::fmt::Display>(what: &str, result: Result<T, E>) {
    if let Err(err) = result {
        eprintln!("shanshui: {what}: {err}");
    }
}

fn save_position<R: Runtime>(app: &AppHandle<R>) {
    log_err("save window position", app.save_window_state(StateFlags::POSITION));
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main_window(app) {
        log_err("show window", window.show());
        log_err("focus window", window.set_focus());
        log_err("emit visibility", app.emit("visibility", true));
    }
}

pub fn hide_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main_window(app) {
        save_position(app);
        log_err("hide window", window.hide());
        log_err("emit visibility", app.emit("visibility", false));
    }
}

pub fn toggle_main<R: Runtime>(app: &AppHandle<R>) {
    match main_window(app).map(|w| w.is_visible()) {
        Some(Ok(true)) => hide_main(app),
        _ => show_main(app),
    }
}

pub fn quit<R: Runtime>(app: &AppHandle<R>) {
    save_position(app);
    app.exit(0);
}

/// The first time the window is closed to the tray, say that the app is still running.
fn tray_notice_once<R: Runtime>(app: &AppHandle<R>) {
    let Ok(store) = app.store(STORE_FILE) else { return };
    if store.get("trayNoticeShown").and_then(|v| v.as_bool()) == Some(true) {
        return;
    }
    store.set("trayNoticeShown", true);
    log_err("save store", store.save());
    log_err(
        "show tray notice",
        app.notification()
            .builder()
            .title("kellytimer is still running")
            .body("It's waiting in the tray. Click the ^ arrow next to the clock to bring it back.")
            .show(),
    );
}

#[tauri::command]
fn schedule_alarm<R: Runtime>(app: AppHandle<R>, request: alarm::AlarmRequest) {
    alarm::schedule(&app, request);
}

#[tauri::command]
fn cancel_alarm<R: Runtime>(app: AppHandle<R>) {
    alarm::cancel(&app);
}

#[tauri::command]
fn play_sound(name: String, volume: f32) {
    sound::play(&name, volume);
}

#[tauri::command]
fn set_window_size<R: Runtime>(window: WebviewWindow<R>, width: f64, height: f64) -> Result<(), String> {
    layout::resize_anchored(&window, (width, height)).map_err(|e| e.to_string())
}

#[tauri::command]
fn snap_to_corner<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, corner: String) -> Result<(), String> {
    layout::snap(&window, layout::Corner::parse(&corner)).map_err(|e| e.to_string())?;
    save_position(&app);
    Ok(())
}

#[tauri::command]
fn set_always_on_top<R: Runtime>(window: WebviewWindow<R>, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_to_tray<R: Runtime>(app: AppHandle<R>, notice: bool) {
    hide_main(&app);
    if notice {
        tray_notice_once(&app);
    }
}

#[tauri::command]
fn quit_app<R: Runtime>(app: AppHandle<R>) {
    quit(&app);
}

#[tauri::command]
fn update_tray<R: Runtime>(app: AppHandle<R>, tooltip: String, running: bool) -> Result<(), String> {
    tray::update(&app, &tooltip, running).map_err(|e| e.to_string())
}

/// Size the window from the saved preset and put it where it was, or bottom-right.
fn place_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let Some(window) = main_window(app) else { return Ok(()) };
    let store = app.store(STORE_FILE).ok();
    let settings = store.as_ref().and_then(|s| s.get("settings"));
    let setting = |key: &str| settings.as_ref().and_then(|s| s.get(key).cloned());
    let preset = setting("windowSize").and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default();
    let on_top = setting("alwaysOnTop").and_then(|v| v.as_bool()).unwrap_or(true);
    // the saved position belongs to the size the window had, compact or not
    let compact = store.as_ref().and_then(|s| s.get("compact")).and_then(|v| v.as_bool()) == Some(true);
    let size = if compact { layout::COMPACT_SIZE } else { layout::preset_size(&preset) };

    window.set_always_on_top(on_top)?;
    let has_saved_position =
        app.path().app_config_dir().map(|dir| dir.join(DEFAULT_FILENAME).exists()).unwrap_or(false);
    let mut placed = false;
    if has_saved_position {
        window.restore_state(StateFlags::POSITION)?;
        window.set_size(LogicalSize::new(size.0, size.1))?;
        placed = layout::is_on_screen(&window)?;
    }
    if !placed {
        layout::place_initially(&window, size)?;
    }
    window.show()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // must be registered first so a second launch exits before doing anything else
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .skip_initial_state(MAIN)
                .build(),
        )
        .manage(alarm::AlarmState::default())
        .invoke_handler(tauri::generate_handler![
            schedule_alarm,
            cancel_alarm,
            play_sound,
            set_window_size,
            snap_to_corner,
            set_always_on_top,
            hide_to_tray,
            quit_app,
            update_tray,
        ])
        .setup(|app| {
            tray::create(app.handle())?;
            place_main_window(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // Alt+F4 and friends: keep running in the tray; "Quit" really exits.
                api.prevent_close();
                let app = window.app_handle();
                hide_main(app);
                tray_notice_once(app);
            }
            WindowEvent::Moved(_) => {
                // Save the position shortly after a drag ends.
                let generation = MOVE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(800)).await;
                    if MOVE_GENERATION.load(Ordering::SeqCst) == generation {
                        save_position(&app);
                    }
                });
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running kellytimer");
}
