//! Native microphone capture for the desktop host.
//!
//! Tauri's macOS WebView (WKWebView) does not expose `navigator.mediaDevices`,
//! so the renderer cannot record audio through `getUserMedia`. Instead the
//! renderer drives capture through these commands: the audio device is opened
//! natively via `cpal`, samples are buffered on a dedicated thread, and on stop
//! they are encoded to an in-memory WAV and returned as base64 for the renderer
//! to attach as a file.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;

/// Shared recording state managed by Tauri. Holds the in-flight recording, if any.
#[derive(Default)]
pub struct AudioState {
    inner: Mutex<Option<ActiveRecording>>,
}

/// A recording currently in progress. The capture thread owns the `cpal::Stream`
/// (which is `!Send` on macOS) and writes into `samples`; the command thread only
/// holds handles to stop it and drain the buffer.
struct ActiveRecording {
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    channels: u16,
    stop_flag: Arc<AtomicBool>,
    join: JoinHandle<()>,
}

/// Ensure the app is allowed to capture audio. On macOS the WKWebView host
/// never triggers a microphone permission prompt on its own, so we explicitly
/// request authorization through AVFoundation and block until the user responds.
/// Without this the input stream opens but only delivers silence.
#[cfg(target_os = "macos")]
const MIC_DENIED_HINT: &str =
    "Microphone access denied. Enable Molibot under System Settings → Privacy & Security → Microphone, then try again.";

#[cfg(target_os = "macos")]
fn ensure_microphone_access() -> Result<(), String> {
    use block2::RcBlock;
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
    use std::sync::mpsc;

    let media_type = unsafe { AVMediaTypeAudio }.ok_or("AVMediaTypeAudio unavailable")?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };

    match status {
        AVAuthorizationStatus::Authorized => Ok(()),
        AVAuthorizationStatus::NotDetermined => {
            let (tx, rx) = mpsc::channel::<bool>();
            let handler = RcBlock::new(move |granted: objc2::runtime::Bool| {
                let _ = tx.send(granted.as_bool());
            });
            unsafe {
                AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &handler);
            }
            match rx.recv_timeout(Duration::from_secs(60)) {
                Ok(true) => Ok(()),
                Ok(false) => Err(MIC_DENIED_HINT.into()),
                Err(_) => Err("microphone permission request timed out".into()),
            }
        }
        AVAuthorizationStatus::Denied => Err(MIC_DENIED_HINT.into()),
        AVAuthorizationStatus::Restricted => {
            Err("microphone access is restricted on this device".into())
        }
        _ => Ok(()),
    }
}

#[cfg(not(target_os = "macos"))]
fn ensure_microphone_access() -> Result<(), String> {
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    /// Base64-encoded WAV (16-bit PCM) container.
    audio_base64: String,
    mime_type: String,
    duration_ms: u64,
    sample_rate: u32,
    channels: u16,
}

/// Begin capturing from the default input device. Returns once capture has
/// actually started (or with an error if no device/permission is available),
/// so the renderer only flips into the "recording" state on success.
#[tauri::command]
pub fn start_recording(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "audio state unavailable")?;
    if guard.is_some() {
        return Err("recording already in progress".into());
    }

    ensure_microphone_access()?;

    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let stop_flag = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(u32, u16), String>>();

    let samples_thread = samples.clone();
    let stop_thread = stop_flag.clone();

    // The device, config, and stream are all created on this thread because
    // `cpal::Stream` is not `Send` and cannot be moved into the shared state.
    let join = std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(device) => device,
            None => {
                let _ = ready_tx.send(Err("no microphone input device available".into()));
                return;
            }
        };
        let supported = match device.default_input_config() {
            Ok(config) => config,
            Err(error) => {
                let _ = ready_tx.send(Err(format!("input config error: {error}")));
                return;
            }
        };

        let sample_rate = supported.sample_rate().0;
        let channels = supported.channels();
        let sample_format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let err_fn = |error| eprintln!("audio input stream error: {error}");

        let build_result = match sample_format {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut buffer) = samples_thread.lock() {
                        buffer.extend_from_slice(data);
                    }
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut buffer) = samples_thread.lock() {
                        buffer.extend(data.iter().map(|sample| *sample as f32 / i16::MAX as f32));
                    }
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    if let Ok(mut buffer) = samples_thread.lock() {
                        buffer.extend(
                            data.iter()
                                .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0),
                        );
                    }
                },
                err_fn,
                None,
            ),
            other => {
                let _ = ready_tx.send(Err(format!("unsupported sample format: {other:?}")));
                return;
            }
        };

        let stream = match build_result {
            Ok(stream) => stream,
            Err(error) => {
                let _ = ready_tx.send(Err(format!("failed to open microphone: {error}")));
                return;
            }
        };
        if let Err(error) = stream.play() {
            let _ = ready_tx.send(Err(format!("failed to start microphone: {error}")));
            return;
        }

        let _ = ready_tx.send(Ok((sample_rate, channels)));
        while !stop_thread.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(50));
        }
        drop(stream);
    });

    match ready_rx.recv() {
        Ok(Ok((sample_rate, channels))) => {
            *guard = Some(ActiveRecording {
                samples,
                sample_rate,
                channels,
                stop_flag,
                join,
            });
            Ok(())
        }
        Ok(Err(error)) => {
            let _ = join.join();
            Err(error)
        }
        Err(_) => {
            let _ = join.join();
            Err("recording thread terminated unexpectedly".into())
        }
    }
}

/// Stop the active recording and return the captured audio as a base64 WAV.
#[tauri::command]
pub fn stop_recording(state: tauri::State<'_, AudioState>) -> Result<RecordingResult, String> {
    let active = {
        let mut guard = state.inner.lock().map_err(|_| "audio state unavailable")?;
        guard.take()
    }
    .ok_or("no active recording")?;

    active.stop_flag.store(true, Ordering::Relaxed);
    let _ = active.join.join();

    let samples = active
        .samples
        .lock()
        .map_err(|_| "audio buffer unavailable")?
        .clone();
    let sample_rate = active.sample_rate;
    let channels = active.channels;

    let frames = if channels > 0 {
        samples.len() as u64 / channels as u64
    } else {
        0
    };
    let duration_ms = if sample_rate > 0 {
        frames * 1000 / sample_rate as u64
    } else {
        0
    };

    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::<u8>::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
        for sample in &samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let value = (clamped * i16::MAX as f32) as i16;
            writer.write_sample(value).map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }

    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(cursor.into_inner());
    Ok(RecordingResult {
        audio_base64,
        mime_type: "audio/wav".into(),
        duration_ms,
        sample_rate,
        channels,
    })
}

/// Discard the active recording without returning audio.
#[tauri::command]
pub fn cancel_recording(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let active = {
        let mut guard = state.inner.lock().map_err(|_| "audio state unavailable")?;
        guard.take()
    };
    if let Some(active) = active {
        active.stop_flag.store(true, Ordering::Relaxed);
        let _ = active.join.join();
    }
    Ok(())
}
