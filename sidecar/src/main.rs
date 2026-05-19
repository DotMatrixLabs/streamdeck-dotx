use std::env;
use std::time::Duration;
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, WPARAM};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioSessionControl2, IAudioSessionEnumerator,
    IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    Endpoints::IAudioEndpointVolume,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_APPCOMMAND,
};
use windows::core::ComInterface;

const APPCOMMAND_MEDIA_PLAY_PAUSE: i32 = 14;

fn main() {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("");
    let target = args.get(2).map(|s| s.as_str());

    let result: Result<(), Box<dyn std::error::Error>> = match cmd {
        "toggle"              => media_toggle().map_err(Into::into),
        "pause"               => media_pause().map_err(Into::into),
        "play"                => media_play().map_err(Into::into),
        "next"                => media_next().map_err(Into::into),
        "prev"                => media_previous().map_err(Into::into),
        "toggle-mute"         => toggle_master_mute().map_err(Into::into),
        "session-toggle"      => session_toggle_play(target.unwrap_or("")).map_err(Into::into),
        "session-toggle-mute" => session_toggle_mute(target.unwrap_or("")).map_err(Into::into),
        "list-sessions"       => { list_smtc_sessions(); Ok(()) },
        _ => {
            eprintln!("Usage: media-control <command> [target]");
            eprintln!("Commands: toggle, pause, play, next, prev, toggle-mute,");
            eprintln!("          session-toggle <app>, session-toggle-mute <app>,");
            eprintln!("          list-sessions");
            std::process::exit(1);
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(2);
    }
}

// ---------------------------------------------------------------------------
// SMTC helpers
// ---------------------------------------------------------------------------

fn get_smtc_manager() -> windows::core::Result<
    windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
> {
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()
}

fn media_toggle() -> windows::core::Result<()> {
    get_smtc_manager()?.GetCurrentSession()?.TryTogglePlayPauseAsync()?.get()?;
    Ok(())
}

fn media_pause() -> windows::core::Result<()> {
    get_smtc_manager()?.GetCurrentSession()?.TryPauseAsync()?.get()?;
    Ok(())
}

fn media_play() -> windows::core::Result<()> {
    get_smtc_manager()?.GetCurrentSession()?.TryPlayAsync()?.get()?;
    Ok(())
}

fn media_next() -> windows::core::Result<()> {
    get_smtc_manager()?.GetCurrentSession()?.TrySkipNextAsync()?.get()?;
    Ok(())
}

fn media_previous() -> windows::core::Result<()> {
    let session = get_smtc_manager()?.GetCurrentSession()?;

    // If more than 3 s in (30_000_000 × 100 ns ticks), first call restarts
    // the track — call twice to actually go to previous.
    let past_threshold = session
        .GetTimelineProperties()
        .and_then(|t| t.Position())
        .map(|p| p.Duration > 30_000_000)
        .unwrap_or(false);

    if past_threshold {
        let _ = session.TrySkipPreviousAsync().and_then(|op| op.get());
        std::thread::sleep(Duration::from_millis(150));
    }

    session.TrySkipPreviousAsync()?.get()?;
    Ok(())
}

/// Toggle play/pause for the SMTC session matching `app_name`.
/// If no SMTC session is found (browser dropped it while paused), falls back
/// to WM_APPCOMMAND so the browser process still receives the media key.
/// Never falls back to the generic "current" session to avoid controlling
/// unrelated apps like Spotify.
fn session_toggle_play(app_name: &str) -> windows::core::Result<()> {
    let manager = get_smtc_manager()?;
    let sessions = manager.GetSessions()?;
    let needle = normalise_name(app_name);

    for i in 0..sessions.Size()? {
        let session = sessions.GetAt(i)?;
        if let Ok(src) = session.SourceAppUserModelId() {
            if names_match(&src.to_string(), &needle) {
                let _ = session.TryTogglePlayPauseAsync().and_then(|op| op.get());
                return Ok(());
            }
        }
    }

    // No SMTC session found — do nothing. WM_APPCOMMAND would bubble through
    // DefWindowProc and reach the shell, triggering unrelated apps (e.g. Spotify).
    Ok(())
}

/// Prints all active SMTC sessions to stdout for debugging.
fn list_smtc_sessions() {
    let Ok(manager) = get_smtc_manager() else {
        println!("Could not get SMTC manager");
        return;
    };
    let Ok(sessions) = manager.GetSessions() else {
        println!("Could not get sessions");
        return;
    };
    let count = sessions.Size().unwrap_or(0);
    println!("{count} SMTC session(s):");
    for i in 0..count {
        if let Ok(session) = sessions.GetAt(i) {
            let id = session.SourceAppUserModelId()
                .map(|s| s.to_string())
                .unwrap_or_else(|_| "<error>".into());
            println!("  [{i}] {id}");
        }
    }
}

// ---------------------------------------------------------------------------
// Master audio endpoint mute
// ---------------------------------------------------------------------------

fn get_audio_endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        device.Activate(CLSCTX_ALL, None)
    }
}

fn toggle_master_mute() -> windows::core::Result<()> {
    let endpoint = get_audio_endpoint()?;
    let current = unsafe { endpoint.GetMute()? };
    unsafe { endpoint.SetMute(BOOL::from(!current.as_bool()), std::ptr::null()) }
}

// ---------------------------------------------------------------------------
// WASAPI per-session mute
// ---------------------------------------------------------------------------

/// Toggle mute on every audio session whose process name matches `app_name`.
fn session_toggle_mute(app_name: &str) -> windows::core::Result<()> {
    let needle = normalise_name(app_name);

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let session_enum: IAudioSessionEnumerator = session_manager.GetSessionEnumerator()?;
        let count = session_enum.GetCount()?;

        // Collect current mute state from first matching session, then flip all.
        let mut new_mute: Option<bool> = None;

        for i in 0..count {
            let control = session_enum.GetSession(i)?;
            let control2: IAudioSessionControl2 = control.cast()?;
            let pid = control2.GetProcessId()?;
            if pid == 0 {
                continue; // system session
            }
            if let Some(name) = process_name(pid) {
                if names_match(&name, &needle) {
                    let simple: ISimpleAudioVolume = control.cast()?;
                    let mute = new_mute.get_or_insert_with(|| {
                        !simple.GetMute().unwrap_or(BOOL(0)).as_bool()
                    });
                    let _ = simple.SetMute(BOOL::from(*mute), std::ptr::null());
                }
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// WM_APPCOMMAND — send media key directly to a process's windows
// ---------------------------------------------------------------------------

struct EnumCtx {
    pid: u32,
    cmd: i32,
}

unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &*(lparam.0 as *const EnumCtx);
    let mut window_pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
    if window_pid == ctx.pid {
        let msg_lparam = LPARAM((ctx.cmd << 16) as isize);
        let _ = PostMessageW(hwnd, WM_APPCOMMAND, WPARAM(hwnd.0 as usize), msg_lparam);
    }
    BOOL(1) // continue enumeration
}

/// Send a WM_APPCOMMAND media command to all top-level windows of every
/// process whose executable name matches `needle`.
fn send_media_cmd_to_process(needle: &str, cmd: i32) {
    for pid in find_pids_by_name(needle) {
        let ctx = EnumCtx { pid, cmd };
        unsafe {
            let _ = EnumWindows(Some(enum_windows_proc), LPARAM(&ctx as *const _ as isize));
        }
    }
}

fn find_pids_by_name(needle: &str) -> Vec<u32> {
    let mut pids = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return pids;
        };
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(260);
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                if names_match(&name, needle) {
                    pids.push(entry.th32ProcessID);
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    pids
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

fn normalise_name(s: &str) -> String {
    s.trim_end_matches(".exe").to_lowercase()
}

fn names_match(source: &str, needle: &str) -> bool {
    let src = normalise_name(source);
    src == *needle || src.contains(needle) || needle.contains(&src)
}

/// Returns the executable base name (without `.exe`) for the given PID.
fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&path)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }
}
