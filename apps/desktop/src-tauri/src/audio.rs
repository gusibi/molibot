//! Native microphone capture for the desktop host.
//!
//! Tauri's macOS WebView (WKWebView) does not expose `navigator.mediaDevices`,
//! so the renderer cannot record audio through `getUserMedia`. Instead the
//! renderer drives capture through these commands: the audio device is opened
//! natively via `cpal`, samples are buffered on a dedicated thread, and on stop
//! they are encoded to an in-memory WAV and returned as base64 for the renderer
//! to attach as a file.

use std::collections::VecDeque;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::Manager;

/// Shared recording state managed by Tauri. Holds the in-flight recording, if any.
#[derive(Default)]
pub struct AudioState {
    inner: Mutex<Option<ActiveRecording>>,
}

/// Long-running meeting capture is deliberately separate from short composer
/// voice messages. It rotates bounded WAV files on disk and keeps them until
/// the desktop service acknowledges each upload.
#[derive(Default)]
pub struct MeetingCaptureState {
    inner: Mutex<Option<ActiveMeetingCapture>>,
}

struct ActiveMeetingCapture {
    capture_id: String,
    app_id: String,
    meeting_id: String,
    track_id: String,
    directory: PathBuf,
    sample_rate: u32,
    stop_flag: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    flush_requested: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    pending: Arc<Mutex<VecDeque<MeetingPendingChunk>>>,
    next_seq: Arc<Mutex<u32>>,
    total_frames: Arc<Mutex<u64>>,
    error: Arc<Mutex<Option<String>>>,
}

#[derive(Clone)]
struct MeetingPendingChunk {
    seq: u32,
    start_ms: u64,
    end_ms: u64,
    path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingCaptureStarted {
    capture_id: String,
    sample_rate: u32,
    channels: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingCaptureChunk {
    capture_id: String,
    seq: u32,
    start_ms: u64,
    end_ms: u64,
    mime_type: String,
    audio_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingCaptureStatus {
    capture_id: String,
    app_id: String,
    meeting_id: String,
    track_id: String,
    state: String,
    pending_chunks: usize,
    expected_last_seq: Option<u32>,
    duration_ms: u64,
    error: Option<String>,
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

const MEETING_CHUNK_SECONDS: usize = 10;
const MEETING_CAPTURE_QUEUE_DEPTH: usize = 8;

fn write_meeting_chunk(
    directory: &Path,
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
    seq: u32,
    start_frame: u64,
) -> Result<MeetingPendingChunk, String> {
    let path = directory.join(format!("chunk-{seq:08}.wav"));
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&path, spec).map_err(|error| error.to_string())?;
    for sample in samples {
        writer
            .write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .map_err(|error| error.to_string())?;
    }
    writer.finalize().map_err(|error| error.to_string())?;
    let frames = samples.len() as u64 / channels.max(1) as u64;
    Ok(MeetingPendingChunk {
        seq,
        start_ms: start_frame * 1000 / sample_rate.max(1) as u64,
        end_ms: (start_frame + frames) * 1000 / sample_rate.max(1) as u64,
        path,
    })
}

fn set_capture_error(target: &Arc<Mutex<Option<String>>>, message: String) {
    if let Ok(mut error) = target.lock() {
        if error.is_none() {
            *error = Some(message);
        }
    }
}

fn capture_status(active: &ActiveMeetingCapture) -> MeetingCaptureStatus {
    let next_seq = active.next_seq.lock().map(|value| *value).unwrap_or(0);
    let frames = active.total_frames.lock().map(|value| *value).unwrap_or(0);
    MeetingCaptureStatus {
        capture_id: active.capture_id.clone(),
        app_id: active.app_id.clone(),
        meeting_id: active.meeting_id.clone(),
        track_id: active.track_id.clone(),
        state: if active.join.is_none() {
            "stopped"
        } else if active.paused.load(Ordering::Relaxed) {
            "paused"
        } else {
            "recording"
        }
        .into(),
        pending_chunks: active.pending.lock().map(|queue| queue.len()).unwrap_or(0),
        expected_last_seq: next_seq.checked_sub(1),
        duration_ms: frames * 1000 / active.sample_rate.max(1) as u64,
        error: active.error.lock().ok().and_then(|value| value.clone()),
    }
}

/// Start a disk-backed microphone capture. The audio callback only copies into
/// a bounded channel; file encoding happens on the capture owner thread.
#[tauri::command]
pub fn start_meeting_capture(
    app: tauri::AppHandle,
    app_id: String,
    meeting_id: String,
    track_id: String,
    state: tauri::State<'_, MeetingCaptureState>,
) -> Result<MeetingCaptureStarted, String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "meeting capture state unavailable")?;
    if guard.is_some() {
        return Err("a meeting capture already exists".into());
    }
    let valid_token = |value: &str| {
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    };
    if !valid_token(&app_id) || !valid_token(&meeting_id) || !valid_token(&track_id) {
        return Err("meeting capture target is invalid".into());
    }
    ensure_microphone_access()?;

    let capture_id = uuid::Uuid::new_v4().to_string();
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("meeting capture cache unavailable: {error}"))?
        .join("meeting-capture")
        .join(&capture_id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("meeting capture directory unavailable: {error}"))?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let flush_requested = Arc::new(AtomicBool::new(false));
    let pending = Arc::new(Mutex::new(VecDeque::new()));
    let next_seq = Arc::new(Mutex::new(0_u32));
    let total_frames = Arc::new(Mutex::new(0_u64));
    let error = Arc::new(Mutex::new(None));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(u32, u16), String>>();

    let stop_thread = stop_flag.clone();
    let paused_thread = paused.clone();
    let flush_thread = flush_requested.clone();
    let pending_thread = pending.clone();
    let next_seq_thread = next_seq.clone();
    let total_frames_thread = total_frames.clone();
    let error_thread = error.clone();
    let directory_thread = directory.clone();
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
            Err(cause) => {
                let _ = ready_tx.send(Err(format!("input config error: {cause}")));
                return;
            }
        };
        let sample_rate = supported.sample_rate().0;
        let channels = supported.channels();
        let sample_format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let (audio_tx, audio_rx) = mpsc::sync_channel::<Vec<f32>>(MEETING_CAPTURE_QUEUE_DEPTH);
        let callback_error = error_thread.clone();
        let callback_paused = paused_thread.clone();
        let send_samples = move |samples: Vec<f32>| {
            if callback_paused.load(Ordering::Relaxed) {
                return;
            }
            if audio_tx.try_send(samples).is_err() {
                set_capture_error(
                    &callback_error,
                    "audio capture could not keep up; a gap may exist".into(),
                );
            }
        };
        let err_target = error_thread.clone();
        let err_fn = move |cause| {
            set_capture_error(&err_target, format!("audio input stream error: {cause}"))
        };
        let stream = match sample_format {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| send_samples(data.to_vec()),
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    send_samples(
                        data.iter()
                            .map(|sample| *sample as f32 / i16::MAX as f32)
                            .collect(),
                    )
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    send_samples(
                        data.iter()
                            .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
                            .collect(),
                    )
                },
                err_fn,
                None,
            ),
            other => {
                let _ = ready_tx.send(Err(format!("unsupported sample format: {other:?}")));
                return;
            }
        };
        let stream = match stream {
            Ok(stream) => stream,
            Err(cause) => {
                let _ = ready_tx.send(Err(format!("failed to open microphone: {cause}")));
                return;
            }
        };
        if let Err(cause) = stream.play() {
            let _ = ready_tx.send(Err(format!("failed to start microphone: {cause}")));
            return;
        }
        let _ = ready_tx.send(Ok((sample_rate, channels)));

        let chunk_samples = sample_rate as usize * channels as usize * MEETING_CHUNK_SECONDS;
        let mut buffer = Vec::<f32>::with_capacity(chunk_samples + chunk_samples / 4);
        let flush = |samples: Vec<f32>| {
            if samples.is_empty() {
                return;
            }
            let seq = next_seq_thread
                .lock()
                .map(|mut value| {
                    let seq = *value;
                    *value += 1;
                    seq
                })
                .unwrap_or(0);
            let start_frame = total_frames_thread.lock().map(|value| *value).unwrap_or(0);
            let frames_written = samples.len() as u64 / channels.max(1) as u64;
            match write_meeting_chunk(
                &directory_thread,
                &samples,
                sample_rate,
                channels,
                seq,
                start_frame,
            ) {
                Ok(chunk) => {
                    if let Ok(mut queue) = pending_thread.lock() {
                        queue.push_back(chunk);
                    }
                }
                Err(cause) => set_capture_error(
                    &error_thread,
                    format!("meeting chunk write failed: {cause}"),
                ),
            }
            // Advance the clock even when a file write failed. The skipped seq
            // then becomes an explicit missing block instead of making the next
            // chunk overlap the lost interval and falsely look complete.
            if let Ok(mut frames) = total_frames_thread.lock() {
                *frames += frames_written;
            }
        };

        while !stop_thread.load(Ordering::Relaxed) {
            if flush_thread.load(Ordering::Relaxed) {
                while let Ok(samples) = audio_rx.try_recv() {
                    buffer.extend(samples);
                }
                while buffer.len() >= chunk_samples {
                    let remainder = buffer.split_off(chunk_samples);
                    flush(std::mem::replace(&mut buffer, remainder));
                }
                flush(std::mem::take(&mut buffer));
                flush_thread.store(false, Ordering::Relaxed);
                continue;
            }
            match audio_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(samples) => buffer.extend(samples),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            while buffer.len() >= chunk_samples {
                let remainder = buffer.split_off(chunk_samples);
                flush(std::mem::replace(&mut buffer, remainder));
            }
        }
        drop(stream);
        while let Ok(samples) = audio_rx.try_recv() {
            buffer.extend(samples);
        }
        while buffer.len() >= chunk_samples {
            let remainder = buffer.split_off(chunk_samples);
            flush(std::mem::replace(&mut buffer, remainder));
        }
        flush(buffer);
    });

    match ready_rx.recv() {
        Ok(Ok((sample_rate, channels))) => {
            *guard = Some(ActiveMeetingCapture {
                capture_id: capture_id.clone(),
                app_id,
                meeting_id,
                track_id,
                directory,
                sample_rate,
                stop_flag,
                paused,
                flush_requested,
                join: Some(join),
                pending,
                next_seq,
                total_frames,
                error,
            });
            Ok(MeetingCaptureStarted {
                capture_id,
                sample_rate,
                channels,
            })
        }
        Ok(Err(cause)) => {
            let _ = join.join();
            let _ = fs::remove_dir_all(directory);
            Err(cause)
        }
        Err(_) => {
            let _ = join.join();
            let _ = fs::remove_dir_all(directory);
            Err("meeting capture thread terminated unexpectedly".into())
        }
    }
}

#[tauri::command]
pub fn pause_meeting_capture(
    capture_id: String,
    state: tauri::State<'_, MeetingCaptureState>,
) -> Result<MeetingCaptureStatus, String> {
    let flush_requested = {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "meeting capture state unavailable")?;
        let active = guard.as_ref().ok_or("no meeting capture exists")?;
        if active.capture_id != capture_id {
            return Err("meeting capture id does not match".into());
        }
        if active.join.is_none() {
            return Err("meeting capture has already stopped".into());
        }
        active.paused.store(true, Ordering::Relaxed);
        active.flush_requested.store(true, Ordering::Relaxed);
        active.flush_requested.clone()
    };
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while flush_requested.load(Ordering::Relaxed) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    if flush_requested.load(Ordering::Relaxed) {
        return Err("meeting capture pause timed out".into());
    }
    let guard = state
        .inner
        .lock()
        .map_err(|_| "meeting capture state unavailable")?;
    Ok(capture_status(
        guard.as_ref().ok_or("no meeting capture exists")?,
    ))
}

#[tauri::command]
pub fn resume_meeting_capture(
    capture_id: String,
    state: tauri::State<'_, MeetingCaptureState>,
) -> Result<MeetingCaptureStatus, String> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| "meeting capture state unavailable")?;
    let active = guard.as_ref().ok_or("no meeting capture exists")?;
    if active.capture_id != capture_id {
        return Err("meeting capture id does not match".into());
    }
    if active.join.is_none() {
        return Err("meeting capture has already stopped".into());
    }
    active.paused.store(false, Ordering::Relaxed);
    Ok(capture_status(active))
}

#[tauri::command]
pub fn meeting_capture_status(
    state: tauri::State<'_, MeetingCaptureState>,
) -> Result<Option<MeetingCaptureStatus>, String> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| "meeting capture state unavailable")?;
    Ok(guard.as_ref().map(capture_status))
}

#[tauri::command]
pub fn next_meeting_capture_chunk(
    capture_id: String,
    state: tauri::State<'_, MeetingCaptureState>,
) -> Result<Option<MeetingCaptureChunk>, String> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| "meeting capture state unavailable")?;
    let active = guard.as_ref().ok_or("no meeting capture exists")?;
    if active.capture_id != capture_id {
        return Err("meeting capture id does not match".into());
    }
    let chunk = active
        .pending
        .lock()
        .map_err(|_| "meeting capture queue unavailable")?
        .front()
        .cloned();
    let Some(chunk) = chunk else {
        return Ok(None);
    };
    let bytes =
        fs::read(&chunk.path).map_err(|error| format!("meeting chunk unavailable: {error}"))?;
    Ok(Some(MeetingCaptureChunk {
        capture_id,
        seq: chunk.seq,
        start_ms: chunk.start_ms,
        end_ms: chunk.end_ms,
        mime_type: "audio/wav".into(),
        audio_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    }))
}

#[tauri::command]
pub fn acknowledge_meeting_capture_chunk(
    capture_id: String,
    seq: u32,
    state: tauri::State<'_, MeetingCaptureState>,
) -> Result<(), String> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| "meeting capture state unavailable")?;
    let active = guard.as_ref().ok_or("no meeting capture exists")?;
    if active.capture_id != capture_id {
        return Err("meeting capture id does not match".into());
    }
    let mut pending = active
        .pending
        .lock()
        .map_err(|_| "meeting capture queue unavailable")?;
    let chunk = pending
        .front()
        .ok_or("meeting capture chunk is not pending")?;
    if chunk.seq != seq {
        return Err("meeting capture chunks must be acknowledged in order".into());
    }
    let path = chunk.path.clone();
    pending.pop_front();
    fs::remove_file(path).map_err(|error| format!("meeting chunk cleanup failed: {error}"))
}

#[tauri::command]
pub fn stop_meeting_capture(
    capture_id: String,
    state: tauri::State<'_, MeetingCaptureState>,
) -> Result<MeetingCaptureStatus, String> {
    let join = {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "meeting capture state unavailable")?;
        let active = guard.as_mut().ok_or("no meeting capture exists")?;
        if active.capture_id != capture_id {
            return Err("meeting capture id does not match".into());
        }
        active.stop_flag.store(true, Ordering::Relaxed);
        active.join.take()
    };
    if let Some(join) = join {
        let _ = join.join();
    }
    let guard = state
        .inner
        .lock()
        .map_err(|_| "meeting capture state unavailable")?;
    Ok(capture_status(
        guard.as_ref().ok_or("no meeting capture exists")?,
    ))
}

#[tauri::command]
pub fn close_meeting_capture(
    capture_id: String,
    state: tauri::State<'_, MeetingCaptureState>,
) -> Result<(), String> {
    let directory = {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "meeting capture state unavailable")?;
        let active = guard.as_ref().ok_or("no meeting capture exists")?;
        if active.capture_id != capture_id {
            return Err("meeting capture id does not match".into());
        }
        if active.join.is_some() {
            return Err("meeting capture is still recording".into());
        }
        if !active
            .pending
            .lock()
            .map_err(|_| "meeting capture queue unavailable")?
            .is_empty()
        {
            return Err("meeting capture still has pending chunks".into());
        }
        let directory = active.directory.clone();
        *guard = None;
        directory
    };
    fs::remove_dir_all(directory)
        .map_err(|error| format!("meeting capture cleanup failed: {error}"))
}

#[cfg(test)]
mod meeting_capture_tests {
    use super::*;

    #[test]
    fn wav_chunks_preserve_sequence_and_timing_on_disk() {
        let directory =
            std::env::temp_dir().join(format!("molibot-meeting-wav-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create capture fixture");
        let samples = vec![0.25_f32; 16_000];
        let chunk = write_meeting_chunk(&directory, &samples, 16_000, 1, 4, 32_000)
            .expect("write meeting chunk");
        assert_eq!(chunk.seq, 4);
        assert_eq!(chunk.start_ms, 2_000);
        assert_eq!(chunk.end_ms, 3_000);
        let reader = hound::WavReader::open(&chunk.path).expect("read meeting chunk");
        assert_eq!(reader.spec().sample_rate, 16_000);
        assert_eq!(reader.duration(), 16_000);
        fs::remove_dir_all(directory).expect("remove capture fixture");
    }
}
