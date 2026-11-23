//! Window size and placement. Sizes are logical pixels so display scaling (125%, 150%)
//! is handled; placement uses the monitor's work area, i.e. above the taskbar.

use tauri::{Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// Gap between the window and the work-area edge, in logical pixels.
pub const MARGIN: f64 = 16.0;

/// Compact (time only) size. Keep in sync with COMPACT_SIZE in src/core/settings.js.
pub const COMPACT_SIZE: (f64, f64) = (156.0, 60.0);

/// Size presets, in logical pixels. Keep in sync with SIZE_PRESETS in src/core/settings.js.
pub fn preset_size(name: &str) -> (f64, f64) {
    match name {
        "M" => (420.0, 248.0),
        "L" => (520.0, 306.0),
        _ => (340.0, 200.0),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    pub fn parse(s: &str) -> Corner {
        match s {
            "top-left" => Corner::TopLeft,
            "top-right" => Corner::TopRight,
            "bottom-left" => Corner::BottomLeft,
            _ => Corner::BottomRight,
        }
    }
}

/// Top-left position that puts a window of `size` into `corner` of `monitor`'s work area.
pub fn corner_position(monitor: &Monitor, size: PhysicalSize<u32>, corner: Corner) -> PhysicalPosition<i32> {
    let area = monitor.work_area();
    let margin = (MARGIN * monitor.scale_factor()).round() as i32;
    let (ax, ay) = (area.position.x, area.position.y);
    let (aw, ah) = (area.size.width as i32, area.size.height as i32);
    let (w, h) = (size.width as i32, size.height as i32);
    let left = ax + margin;
    let right = ax + aw - w - margin;
    let top = ay + margin;
    let bottom = ay + ah - h - margin;
    match corner {
        Corner::TopLeft => PhysicalPosition::new(left, top),
        Corner::TopRight => PhysicalPosition::new(right, top),
        Corner::BottomLeft => PhysicalPosition::new(left, bottom),
        Corner::BottomRight => PhysicalPosition::new(right, bottom),
    }
}

fn monitor_for<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Option<Monitor>> {
    match window.current_monitor()? {
        Some(m) => Ok(Some(m)),
        None => window.primary_monitor(),
    }
}

/// Move the window into a corner of the work area of the monitor it is on.
pub fn snap<R: Runtime>(window: &WebviewWindow<R>, corner: Corner) -> tauri::Result<()> {
    if let Some(monitor) = monitor_for(window)? {
        let size = window.outer_size()?;
        window.set_position(corner_position(&monitor, size, corner))?;
    }
    Ok(())
}

/// First launch: bottom-right corner of the primary monitor.
pub fn place_initially<R: Runtime>(window: &WebviewWindow<R>, logical: (f64, f64)) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()? else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let size = PhysicalSize::new((logical.0 * scale).round() as u32, (logical.1 * scale).round() as u32);
    window.set_size(size)?;
    window.set_position(corner_position(&monitor, size, Corner::BottomRight))?;
    Ok(())
}

/// True if the window's top-left area lies on some monitor (e.g. not on an unplugged screen).
pub fn is_on_screen<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<bool> {
    let pos = window.outer_position()?;
    let size = window.outer_size()?;
    let probe = PhysicalPosition::new(pos.x + (size.width as i32) / 2, pos.y + (size.height as i32) / 2);
    Ok(window.available_monitors()?.iter().any(|m| {
        let a = m.work_area();
        probe.x >= a.position.x
            && probe.y >= a.position.y
            && probe.x < a.position.x + a.size.width as i32
            && probe.y < a.position.y + a.size.height as i32
    }))
}

/// Resize to `logical` while keeping the window's nearest work-area corner fixed, so a
/// timer tucked in the bottom-right grows up and to the left instead of off the screen.
pub fn resize_anchored<R: Runtime>(window: &WebviewWindow<R>, logical: (f64, f64)) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let new = PhysicalSize::new((logical.0 * scale).round() as u32, (logical.1 * scale).round() as u32);
    let pos = window.outer_position()?;
    let old = window.outer_size()?;
    if old == new {
        return Ok(());
    }
    let Some(monitor) = monitor_for(window)? else {
        return window.set_size(new);
    };
    let area = monitor.work_area();
    let (ax, ay) = (area.position.x, area.position.y);
    let (aw, ah) = (area.size.width as i32, area.size.height as i32);
    let anchor_right = pos.x + old.width as i32 / 2 > ax + aw / 2;
    let anchor_bottom = pos.y + old.height as i32 / 2 > ay + ah / 2;
    let mut x = if anchor_right { pos.x + old.width as i32 - new.width as i32 } else { pos.x };
    let mut y = if anchor_bottom { pos.y + old.height as i32 - new.height as i32 } else { pos.y };
    x = x.clamp(ax, (ax + aw - new.width as i32).max(ax));
    y = y.clamp(ay, (ay + ah - new.height as i32).max(ay));
    window.set_size(new)?;
    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}
