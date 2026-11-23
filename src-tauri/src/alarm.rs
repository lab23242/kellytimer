//! Phase-end alarm. The webview's timers get throttled while the window is hidden, so the
//! end of each phase is also scheduled here: at the end time we show a toast, play the
//! chime and tell the frontend, even if the webview is asleep.
//!
//! The wait is done in short slices against the wall clock (not one long monotonic sleep),
//! so a laptop that slept past the end time is noticed on wake. A phase that ended more
//! than `STALE_AFTER_MS` ago is reported as stale and does not notify or chime.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

use crate::sound;

/// Matches STALE_AFTER_MS in src/core/timer.js.
const STALE_AFTER_MS: f64 = 90_000.0;
/// Longest single sleep, so suspend/resume is noticed within this time of waking.
const MAX_SLICE_MS: f64 = 5_000.0;
/// Alarms due within this window are never cancelled: the webview may notice the end a
/// few milliseconds before we do and reschedule, and the chime must still play.
const DUE_GRACE_MS: f64 = 1_500.0;

/// Pending alarms as (end time, task).
#[derive(Default)]
pub struct AlarmState(Mutex<Vec<(f64, JoinHandle<()>)>>);

/// Abort alarms that are still comfortably in the future; let due ones finish.
fn abort_future(alarms: &mut Vec<(f64, JoinHandle<()>)>) {
    let now = now_ms();
    alarms.retain(|(ends_at, task)| {
        if *ends_at > now + DUE_GRACE_MS {
            task.abort();
            false
        } else {
            *ends_at > now - STALE_AFTER_MS - MAX_SLICE_MS * 2.0 // drop long-finished entries
        }
    });
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlarmRequest {
    /// Real wall-clock time of the phase end, ms since the Unix epoch.
    pub ends_at_ms: f64,
    pub title: String,
    pub body: String,
    /// Chime to play, or None when muted.
    pub sound: Option<String>,
    pub volume: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AlarmFired {
    ends_at_ms: f64,
    stale: bool,
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Replace the pending alarm with `req` (alarms that are already due still fire).
pub fn schedule<R: Runtime>(app: &AppHandle<R>, req: AlarmRequest) {
    let state = app.state::<AlarmState>();
    let mut alarms = state.0.lock().unwrap_or_else(|e| e.into_inner());
    abort_future(&mut alarms);
    let ends_at = req.ends_at_ms;
    if alarms.iter().any(|(due, _)| (due - ends_at).abs() < 1.0) {
        return; // this exact end is already about to fire
    }
    let app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        loop {
            let left = req.ends_at_ms - now_ms();
            if left <= 0.0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(left.min(MAX_SLICE_MS).ceil() as u64)).await;
        }
        let stale = now_ms() - req.ends_at_ms > STALE_AFTER_MS;
        if !stale {
            if let Err(err) = app
                .notification()
                .builder()
                .title(&req.title)
                .body(&req.body)
                .silent() // the chime below is the sound; avoids two sounds at once
                .show()
            {
                eprintln!("shanshui: could not show notification: {err}");
            }
            if let Some(name) = &req.sound {
                sound::play(name, req.volume);
            }
        }
        if let Err(err) = app.emit("alarm", AlarmFired { ends_at_ms: req.ends_at_ms, stale }) {
            eprintln!("shanshui: could not emit alarm event: {err}");
        }
    });
    alarms.push((ends_at, task));
}

/// The user paused, reset or skipped: stop every pending alarm, even one due right now.
pub fn cancel<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AlarmState>();
    let mut alarms = state.0.lock().unwrap_or_else(|e| e.into_inner());
    for (_, task) in alarms.drain(..) {
        task.abort();
    }
}
