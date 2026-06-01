use std::env;
use std::time::Duration;
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
use windows::Win32::Foundation::BOOL;
use windows::Win32::Media::Audio::{
    eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

fn main() {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("");

    let result: Result<(), Box<dyn std::error::Error>> = match cmd {
        "toggle" => media_toggle().map_err(Into::into),
        "next" => media_next().map_err(Into::into),
        "prev" => media_previous().map_err(Into::into),
        "toggle-mute" => toggle_master_mute().map_err(Into::into),
        _ => {
            eprintln!("Usage: media-control <command>");
            eprintln!("Commands: toggle, next, prev, toggle-mute");
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
