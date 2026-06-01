use std::env;
use std::time::Duration;
use windows::core::ComInterface;
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
use windows::Win32::Foundation::BOOL;
use windows::Win32::Media::Audio::{
    eConsole, eRender, Endpoints::IAudioEndpointVolume, IAudioSessionControl2,
    IAudioSessionEnumerator, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

fn main() {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("");
    let target = args.get(2).map(|s| s.as_str()).unwrap_or("");

    let result: Result<(), Box<dyn std::error::Error>> = match cmd {
        "toggle" => media_toggle().map_err(Into::into),
        "next" => media_next().map_err(Into::into),
        "prev" => media_previous().map_err(Into::into),
        "toggle-mute" => toggle_master_mute().map_err(Into::into),
        "session-toggle-mute" => session_toggle_mute(target).map_err(Into::into),
        _ => {
            eprintln!("Usage: media-control <command> [target]");
            eprintln!("Commands: toggle, next, prev, toggle-mute, session-toggle-mute <app>");
            std::process::exit(1);
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(2);
    }
}

fn get_smtc_manager(
) -> windows::core::Result<windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager>
{
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()
}

fn media_toggle() -> windows::core::Result<()> {
    get_smtc_manager()?
        .GetCurrentSession()?
        .TryTogglePlayPauseAsync()?
        .get()?;
    Ok(())
}

fn media_next() -> windows::core::Result<()> {
    get_smtc_manager()?
        .GetCurrentSession()?
        .TrySkipNextAsync()?
        .get()?;
    Ok(())
}

fn media_previous() -> windows::core::Result<()> {
    let session = get_smtc_manager()?.GetCurrentSession()?;

    // If more than 3 seconds into a track, Windows media controls often restart
    // the track on the first previous command. Send it twice to move back.
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

fn session_toggle_mute(app_name: &str) -> windows::core::Result<()> {
    let needle = normalise_name(app_name);
    if needle.is_empty() {
        return Ok(());
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let session_enum: IAudioSessionEnumerator = session_manager.GetSessionEnumerator()?;
        let count = session_enum.GetCount()?;

        let mut new_mute: Option<bool> = None;

        for i in 0..count {
            let control = session_enum.GetSession(i)?;
            let control2: IAudioSessionControl2 = control.cast()?;
            let pid = control2.GetProcessId()?;
            if pid == 0 {
                continue;
            }

            if let Some(name) = process_name(pid) {
                if names_match(&name, &needle) {
                    let simple: ISimpleAudioVolume = control.cast()?;
                    let mute = new_mute
                        .get_or_insert_with(|| !simple.GetMute().unwrap_or(BOOL(0)).as_bool());
                    let _ = simple.SetMute(BOOL::from(*mute), std::ptr::null());
                }
            }
        }
    }

    Ok(())
}

fn normalise_name(s: &str) -> String {
    s.trim_end_matches(".exe").to_lowercase()
}

fn names_match(source: &str, needle: &str) -> bool {
    let src = normalise_name(source);
    src == *needle || src.contains(needle) || needle.contains(&src)
}

fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&path)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }
}
