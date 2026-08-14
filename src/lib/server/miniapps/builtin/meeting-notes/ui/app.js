const strings = {
  en: {
    title:"Meeting Notes", subtitle:"A calm record of every conversation.", live:"Live", history:"History",
    readyTitle:"Ready when you are", readyBody:"Record an in-person meeting. Audio is saved safely as you speak.", privacy:"Audio stays on this device until it is processed.",
    newMeeting:"Start meeting", pause:"Pause", resume:"Resume", endMeeting:"End meeting", finishNow:"End now", cancel:"Cancel",
    finishConfirm:"End recording and generate the final notes?", finishHint:"Your saved audio and transcript will be kept.", recording:"Recording", paused:"Paused", captureHealthy:"Microphone active", capturePaused:"Microphone paused", captureStopped:"Preparing your notes",
    historyTitle:"Meeting history", historyBody:"Search notes, transcripts, and recordings.", search:"Search meetings", meetingTitle:"Meeting title", filterLabel:"Meeting status",
    empty:"No meetings yet", emptyBody:"Finished meetings will stay here with their audio, transcript, and notes.", noResults:"No matching meetings.", filterAll:"All", filterProcessing:"Processing", filterComplete:"Complete", filterAttention:"Needs attention",
    backHistory:"← Back to history", today:"Today", yesterday:"Yesterday", earlier:"Earlier",
    delete:"Delete meeting", confirmAction:"Confirm permanent delete", regenerate:"Regenerate notes", retry:"Retry",
    transcript:"Transcript", notes:"Meeting notes", noTranscript:"Waiting for the first spoken segment…", noNotes:"Notes will grow here as the conversation continues.",
    audio:"Retained audio", sync:"Audio is saved every 10 seconds", pending:"Uploading saved audio…",
    confirmDelete:"Click confirm again to permanently delete this meeting and all retained audio.",
    interrupted:"This meeting was interrupted. Saved audio and completed text are still available.", incomplete:"Some audio could not be processed. The notes are marked partial.",
    transcriptionFailed:"Speech recognition failed for {count} audio block(s). Retained audio is safe; check Settings → Mini Apps → AI, then retry.",
    summaryFailed:"The notes model could not finish. Check the Mini App text model in Settings → Mini Apps → AI, then regenerate notes.", diagnostic:"Diagnostic code",
    state:{ recording:"Recording",paused:"Paused",finalizing:"Finishing",summarizing:"Writing notes",ready:"Ready",partial:"Partial",failed:"Failed",interrupted:"Interrupted",queued:"Queued",transcribing:"Transcribing" }
  },
  zh: {
    title:"会议纪要", subtitle:"安静地记录每一次重要对话。", live:"会议现场", history:"历史记录",
    readyTitle:"准备好了，随时开始", readyBody:"记录线下面对面会议，音频会在你说话时持续安全保存。", privacy:"音频会保留在本机，直到完成处理。",
    newMeeting:"开始会议", pause:"暂停", resume:"继续录音", endMeeting:"结束会议", finishNow:"确认结束", cancel:"取消",
    finishConfirm:"结束录音并生成最终纪要吗？", finishHint:"已经保存的音频和转写内容都会保留。", recording:"正在录音", paused:"已暂停", captureHealthy:"麦克风工作正常", capturePaused:"麦克风已暂停", captureStopped:"正在整理会议内容",
    historyTitle:"会议历史", historyBody:"查找会议纪要、转写内容和原始录音。", search:"搜索会议", meetingTitle:"会议标题", filterLabel:"会议状态",
    empty:"还没有历史会议", emptyBody:"完成的会议会连同音频、转写和纪要安全保存在这里。", noResults:"没有找到匹配的会议。", filterAll:"全部", filterProcessing:"处理中", filterComplete:"已完成", filterAttention:"需处理",
    backHistory:"← 返回历史记录", today:"今天", yesterday:"昨天", earlier:"更早",
    delete:"删除会议", confirmAction:"确认永久删除", regenerate:"重新生成纪要", retry:"重试",
    transcript:"会议转写", notes:"会议纪要", noTranscript:"正在等待第一段语音…", noNotes:"纪要会随着对话逐步出现在这里。",
    audio:"已保留音频", sync:"音频每 10 秒安全保存一次", pending:"正在上传已保存音频…",
    confirmDelete:"请再次点击确认，永久删除这场会议及全部原始音频。",
    interrupted:"会议曾被中断；已保存的音频和文字仍然可用。", incomplete:"部分音频未能处理，当前纪要已标记为不完整。",
    transcriptionFailed:"有 {count} 个音频块语音识别失败。原始音频仍然安全保留；请到“设置 → 小程序 → AI”检查语音识别模型后重试。",
    summaryFailed:"纪要模型未能完成生成。请到“设置 → 小程序 → AI”检查文本模型，然后重新生成纪要。", diagnostic:"诊断代码",
    state:{ recording:"录音中",paused:"已暂停",finalizing:"收尾中",summarizing:"整理纪要中",ready:"已完成",partial:"部分完成",failed:"失败",interrupted:"已中断",queued:"排队中",transcribing:"转写中" }
  }
};

const params = new URLSearchParams(location.search);
const locale = String(params.get("locale") || "en").startsWith("zh") ? "zh" : "en";
const t = strings[locale];
document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
document.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t[node.dataset.i18n] || node.textContent; });
document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => { node.placeholder = t[node.dataset.i18nPlaceholder] || node.placeholder; });

const el = Object.fromEntries([
  "view-tabs","live-tab","history-tab","status","live-view","history-view","live-empty","live-session","new","live-title","live-state-label","record-dot","timer","capture-health","recording-sync","pause","stop","finish-confirm","finish-now","finish-cancel","live-detail","history-list-pane","history-new","history-search","history-count","history-filters","meetings","empty","history-detail","history-back","detail"
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));
el.live_title.setAttribute("aria-label", t.meetingTitle);
el.history_filters.setAttribute("aria-label", t.filterLabel);

let meetings = [];
let historyResults = [];
let selected = "";
let activeCapture = null;
let view = "live";
let historyFilter = "all";
let refreshTimer = null;
let searchDebounce = null;
let searchSequence = 0;
let hostSequence = 0;
let captureObservedAt = Date.now();
const hostRequests = new Map();

{
  const parts = String(params.get("path") || "").split("/");
  if (parts[0] === "meeting" && parts[1]) { selected = parts[1]; view = "history"; }
}

function status(message, error = false) {
  el.status.hidden = !message;
  el.status.textContent = message || "";
  el.status.dataset.error = String(error);
}

function setBusy(button, busy, label = "") {
  button.disabled = busy;
  button.dataset.busy = String(busy);
  if (label) {
    if (busy) button.dataset.label = button.textContent;
    button.textContent = busy ? label : button.dataset.label || button.textContent;
  }
}

async function api(path, init = {}) {
  const response = await fetch(`./api${path}`, { ...init, headers:{ "content-type":"application/json", ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function hostAudio(action, payload = {}) {
  const requestId = `meeting_${Date.now()}_${hostSequence++}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { hostRequests.delete(requestId); reject(new Error("Desktop audio host did not respond.")); }, action === "audio.stop" ? 120000 : 15000);
    hostRequests.set(requestId, { resolve, reject, timeout });
    parent.postMessage({ protocol:"molibot-miniapp-host-capability", version:1, requestId, action, ...payload }, "*");
  });
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (event.source !== parent || message?.protocol !== "molibot-miniapp-host-capability" || message?.type !== "result") return;
  const pending = hostRequests.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  hostRequests.delete(message.requestId);
  if (message.ok) pending.resolve(message.payload || {});
  else pending.reject(new Error(message.error || "Desktop audio request failed."));
});

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[character]);
}
function stateLabel(value) { return t.state[value] || String(value || ""); }
function stateTone(value) {
  if (value === "ready") return "done";
  if (["failed", "interrupted", "partial"].includes(value)) return "alert";
  if (["recording", "paused", "transcribing", "finalizing", "summarizing", "queued"].includes(value)) return "busy";
  return "neutral";
}
function chip(value) { return `<span class="chip" data-tone="${stateTone(value)}">${escapeHtml(stateLabel(value))}</span>`; }
function clock(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function displayDuration(meeting) {
  const trackEnd = Math.max(0, ...(meeting.tracks || []).map((track) => track.endMs || 0));
  if (trackEnd) return clock(trackEnd);
  const start = Date.parse(meeting.startedAt || meeting.createdAt || 0);
  const end = Date.parse(meeting.endedAt || meeting.updatedAt || 0);
  return Number.isFinite(start) && Number.isFinite(end) ? clock(Math.max(0, end - start)) : "00:00";
}
function timecode(milliseconds) { return clock(milliseconds); }
function formatDay(value) { return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { month:"short", day:"numeric" }).format(new Date(value)); }
function formatTime(value) { return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { hour:"2-digit", minute:"2-digit" }).format(new Date(value)); }
function dayKey(value) {
  const date = new Date(value); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const key = (item) => `${item.getFullYear()}-${item.getMonth()}-${item.getDate()}`;
  if (key(date) === key(today)) return t.today;
  if (key(date) === key(yesterday)) return t.yesterday;
  return formatDay(value);
}
function diagnosticMessage(template, code, count = 0) { return `${template.replace("{count}", String(count))} ${t.diagnostic}: ${code || "provider_failed"}`; }

function setView(next) {
  view = next;
  el.live_view.hidden = next !== "live";
  el.history_view.hidden = next !== "history";
  el.live_tab.setAttribute("aria-selected", String(next === "live"));
  el.history_tab.setAttribute("aria-selected", String(next === "history"));
  if (next === "history") renderHistory();
}

function captureElapsed() {
  if (!activeCapture) return 0;
  return (activeCapture.durationMs || 0) + (activeCapture.state === "recording" ? Date.now() - captureObservedAt : 0);
}

function renderCapture() {
  const active = Boolean(activeCapture);
  el.live_empty.hidden = active;
  el.live_session.hidden = !active;
  if (!active) return;
  const meeting = meetings.find((item) => item.id === activeCapture.meetingId);
  if (document.activeElement !== el.live_title) el.live_title.value = meeting?.title || (locale === "zh" ? "未命名会议" : "Untitled meeting");
  el.live_state_label.textContent = stateLabel(activeCapture.state);
  el.live_session.dataset.state = activeCapture.state;
  el.timer.textContent = clock(captureElapsed());
  el.recording_sync.textContent = activeCapture.uploadError || (activeCapture.state === "stopped" ? t.pending : t.sync);
  el.capture_health.textContent = activeCapture.state === "paused" ? t.capturePaused : activeCapture.state === "stopped" ? t.captureStopped : t.captureHealthy;
  el.pause.textContent = activeCapture.state === "paused" ? t.resume : t.pause;
  el.pause.disabled = activeCapture.state === "stopped";
}

async function syncMeetingCaptureState() {
  if (!activeCapture || !["recording", "paused"].includes(activeCapture.state)) return;
  const meeting = meetings.find((item) => item.id === activeCapture.meetingId);
  if (meeting && meeting.status !== activeCapture.state) {
    await api(`/meetings/${meeting.id}/${activeCapture.state === "paused" ? "pause" : "resume"}`, { method:"POST", body:"{}" });
  }
}

async function refreshCapture() {
  const capture = await hostAudio("audio.status");
  activeCapture = capture.active === false ? null : capture;
  captureObservedAt = Date.now();
  if (activeCapture?.meetingId) {
    selected = activeCapture.meetingId;
    await syncMeetingCaptureState();
  }
  renderCapture();
}

async function load() {
  meetings = (await api("/meetings")).meetings;
  historyResults = meetings;
  if (el.history_search.value.trim()) await searchHistory();
  renderHistory();
  if (activeCapture?.meetingId) await renderLiveDetail(activeCapture.meetingId);
  if (view === "history" && selected && !el.history_detail.hidden) await showHistoryDetail(selected);
}

function renderHistory() {
  const query = el.history_search.value.trim();
  const visible = historyResults.filter((meeting) => {
    if (meeting.id === activeCapture?.meetingId) return false;
    if (historyFilter === "processing") return ["finalizing", "summarizing"].includes(meeting.status);
    if (historyFilter === "complete") return ["ready", "partial"].includes(meeting.status);
    if (historyFilter === "attention") return ["failed", "interrupted"].includes(meeting.status);
    return true;
  });
  el.history_count.textContent = String(visible.length);
  el.empty.hidden = visible.length > 0;
  el.empty.querySelector("h3").textContent = meetings.length && query ? t.noResults : t.empty;
  const groups = new Map();
  for (const meeting of visible) {
    const key = dayKey(meeting.startedAt || meeting.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(meeting);
  }
  el.meetings.replaceChildren(...[...groups].map(([label, items]) => {
    const section = document.createElement("section"); section.className = "meeting-group";
    section.innerHTML = `<h3>${escapeHtml(label)}</h3>`;
    for (const meeting of items) {
      const button = document.createElement("button"); button.type = "button"; button.className = "meeting-item";
      button.innerHTML = `<span class="meeting-symbol" data-tone="${stateTone(meeting.status)}" aria-hidden="true"><i></i></span><span class="meeting-main"><strong>${escapeHtml(meeting.title)}</strong><span>${escapeHtml(formatTime(meeting.startedAt || meeting.createdAt))} · ${clock(meeting.durationMs || 0)}</span></span><span class="meeting-meta">${chip(meeting.status)}<span class="chevron">›</span></span>`;
      button.onclick = () => void showHistoryDetail(meeting.id);
      section.append(button);
    }
    return section;
  }));
}

async function searchHistory() {
  const sequence = ++searchSequence;
  const query = el.history_search.value.trim();
  const results = (await api(`/meetings${query ? `?q=${encodeURIComponent(query)}` : ""}`)).meetings;
  if (sequence !== searchSequence) return;
  historyResults = results;
  renderHistory();
}

function transcriptMarkup(meeting) {
  if (!meeting.utterances.length) return `<p class="content-empty">${escapeHtml(t.noTranscript)}</p>`;
  return `<ol class="timeline">${meeting.utterances.map((utterance) => `<li><time>${timecode(utterance.startMs)}</time><div><strong>${escapeHtml(utterance.speakerLabel || (locale === "zh" ? "现场" : "Room"))}</strong><p>${escapeHtml(utterance.text)}</p></div></li>`).join("")}</ol>`;
}

function meetingContent(meeting, history) {
  const bytes = meeting.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  const failedCodes = [...new Set(meeting.completeness.failedChunks.map((chunk) => chunk.error).filter(Boolean))].join(", ");
  const incomplete = meeting.status === "partial" || meeting.captureWarning || meeting.completeness.missingChunks.length || meeting.completeness.failedChunks.length;
  const notes = meeting.summary || meeting.liveNotes;
  return `
    ${history ? `<div class="detail-heading"><div><input id="meeting-title" class="detail-title" value="${escapeHtml(meeting.title)}"><p>${escapeHtml(formatDay(meeting.startedAt || meeting.createdAt))} · ${displayDuration(meeting)} · ${(bytes / 1024 / 1024).toFixed(1)} MiB</p></div>${chip(meeting.status)}</div>` : ""}
    ${meeting.status === "interrupted" ? `<p class="banner" data-error="true">${t.interrupted}</p>` : ""}
    ${meeting.status === "failed" ? `<p class="banner" data-error="true">${escapeHtml(diagnosticMessage(t.summaryFailed, meeting.error))}</p>` : ""}
    ${meeting.completeness.failedChunks.length ? `<p class="banner" data-error="true">${escapeHtml(diagnosticMessage(t.transcriptionFailed, failedCodes, meeting.completeness.failedChunks.length))}</p>` : ""}
    ${incomplete ? `<p class="banner" data-error="true">${t.incomplete}</p>` : ""}
    <div class="content-grid">
      <section><h2>${t.notes}${meeting.liveNotes && !meeting.summary ? ` · ${timecode(meeting.liveNotesThroughMs)}` : ""}</h2><div class="notes-body">${notes ? `<pre>${escapeHtml(notes)}</pre>` : `<p class="content-empty">${t.noNotes}</p>`}</div></section>
      <section><h2>${t.transcript}</h2>${transcriptMarkup(meeting)}</section>
    </div>
    ${history ? `<div class="detail-actions"><button id="regenerate" class="btn btn-secondary">${t.regenerate}</button><button id="delete" class="btn btn-tertiary btn-danger-text">${t.delete}</button></div>` : ""}`;
}

async function renderLiveDetail(id) {
  const { meeting } = await api(`/meetings/${encodeURIComponent(id)}`);
  el.live_detail.innerHTML = meetingContent(meeting, false);
}

async function showHistoryDetail(id) {
  selected = id;
  const { meeting } = await api(`/meetings/${encodeURIComponent(id)}`);
  el.history_list_pane.hidden = true;
  el.history_detail.hidden = false;
  el.detail.innerHTML = meetingContent(meeting, true);
  document.getElementById("meeting-title").onchange = (event) => void api(`/meetings/${id}`, { method:"PATCH", body:JSON.stringify({ title:event.target.value }) }).then(load).catch((cause) => status(cause.message, true));
  document.getElementById("regenerate").onclick = () => void api(`/meetings/${id}/regenerate`, { method:"POST", body:"{}" }).then(load).catch((cause) => status(cause.message, true));
  const deleteButton = document.getElementById("delete");
  deleteButton.onclick = () => {
    if (deleteButton.dataset.armed !== "true") { deleteButton.dataset.armed = "true"; deleteButton.textContent = t.confirmAction; status(t.confirmDelete, true); return; }
    void api(`/meetings/${id}`, { method:"DELETE" }).then(() => { selected = ""; el.history_detail.hidden = true; el.history_list_pane.hidden = false; status(""); return load(); }).catch((cause) => status(cause.message, true));
  };
}

async function begin() {
  for (const button of [el.new, el.history_new]) setBusy(button, true);
  let created = null;
  try {
    status("");
    created = await api("/meetings", { method:"POST", body:"{}" });
    selected = created.meeting.id;
    activeCapture = await hostAudio("audio.start", { meetingId:created.meeting.id, trackId:created.track.id });
    captureObservedAt = Date.now();
    setView("live");
    await load();
    renderCapture();
  } catch (cause) {
    if (created?.meeting?.id) await api(`/meetings/${created.meeting.id}`, { method:"DELETE" }).catch(() => {});
    activeCapture = null; renderCapture(); status(cause.message, true);
  } finally {
    for (const button of [el.new, el.history_new]) setBusy(button, false);
  }
}

async function togglePause() {
  if (!activeCapture || activeCapture.state === "stopped") return;
  setBusy(el.pause, true);
  try {
    const next = activeCapture.state === "paused" ? "recording" : "paused";
    activeCapture = await hostAudio(next === "paused" ? "audio.pause" : "audio.resume");
    captureObservedAt = Date.now();
    await api(`/meetings/${activeCapture.meetingId}/${next === "paused" ? "pause" : "resume"}`, { method:"POST", body:"{}" });
    await load(); renderCapture(); status("");
  } catch (cause) { status(cause.message, true); await refreshCapture().catch(() => {}); await load(); }
  finally { setBusy(el.pause, false); }
}

async function stop() {
  if (!activeCapture) return;
  setBusy(el.finish_now, true);
  el.recording_sync.textContent = t.pending;
  try {
    const meetingId = activeCapture.meetingId;
    await hostAudio("audio.stop");
    activeCapture = null; selected = meetingId;
    await load(); renderCapture(); setView("history"); await showHistoryDetail(meetingId); status("");
  } catch (cause) { status(cause.message, true); await refreshCapture().catch(() => {}); await load(); }
  finally { setBusy(el.finish_now, false); }
}

el.live_tab.onclick = () => setView("live");
el.history_tab.onclick = () => setView("history");
el.view_tabs.onkeydown = (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [el.live_tab, el.history_tab];
  const current = Math.max(0, tabs.indexOf(document.activeElement));
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
};
el.new.onclick = el.history_new.onclick = () => void begin();
el.pause.onclick = () => void togglePause();
el.stop.onclick = () => { el.finish_confirm.hidden = false; el.stop.setAttribute("aria-expanded", "true"); el.finish_cancel.focus(); };
el.finish_cancel.onclick = () => { el.finish_confirm.hidden = true; el.stop.setAttribute("aria-expanded", "false"); el.stop.focus(); };
el.finish_now.onclick = () => void stop();
el.history_search.oninput = () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => void searchHistory().catch((cause) => status(cause.message, true)), 220);
};
el.history_filters.onclick = (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  historyFilter = button.dataset.filter;
  for (const item of el.history_filters.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item === button));
  renderHistory();
};
el.history_back.onclick = () => { selected = ""; el.history_detail.hidden = true; el.history_list_pane.hidden = false; renderHistory(); };
el.live_title.onchange = (event) => { if (activeCapture) void api(`/meetings/${activeCapture.meetingId}`, { method:"PATCH", body:JSON.stringify({ title:event.target.value }) }).then(load).catch((cause) => status(cause.message, true)); };
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el.finish_confirm.hidden) {
    el.finish_confirm.hidden = true;
    el.stop.setAttribute("aria-expanded", "false");
    el.stop.focus();
  }
});

await load().catch((cause) => status(cause.message, true));
await refreshCapture().catch((cause) => status(cause.message, true));
if (view === "history" && selected) await showHistoryDetail(selected).catch((cause) => status(cause.message, true));
setView(view);
refreshTimer = setInterval(async () => {
  try { if (activeCapture) await refreshCapture(); await load(); renderCapture(); } catch { /* Retained audio remains safe; retry on the next tick. */ }
}, 2_000);
window.addEventListener("pagehide", () => { clearInterval(refreshTimer); clearTimeout(searchDebounce); for (const request of hostRequests.values()) clearTimeout(request.timeout); hostRequests.clear(); });
