//! System tray icon and menu. Timer actions are forwarded to the frontend as a "tray"
//! event; window show/hide and quit are handled here.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const TRAY_ID: &str = "main";

struct TrayItems<R: Runtime> {
    start_pause: MenuItem<R>,
}

fn forward<R: Runtime>(app: &AppHandle<R>, action: &str) {
    if let Err(err) = app.emit("tray", action) {
        eprintln!("shanshui: could not forward tray action: {err}");
    }
}

pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle-window", "Show / hide", true, None::<&str>)?;
    let start_pause = MenuItem::with_id(app, "start-pause", "Start", true, None::<&str>)?;
    let skip = MenuItem::with_id(app, "skip", "Skip to next", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Shanshui", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &start_pause, &skip, &settings, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Shanshui")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle-window" => crate::toggle_main(app),
            "quit" => crate::quit(app),
            "settings" => {
                crate::show_main(app);
                forward(app, "settings");
            }
            other => forward(app, other),
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    app.manage(TrayItems { start_pause });
    Ok(())
}

/// Refresh the tooltip and the Start/Pause label.
pub fn update<R: Runtime>(app: &AppHandle<R>, tooltip: &str, running: bool) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(tooltip))?;
    }
    if let Some(items) = app.try_state::<TrayItems<R>>() {
        items.start_pause.set_text(if running { "Pause" } else { "Start" })?;
    }
    Ok(())
}
