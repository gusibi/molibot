# Meeting Notes Mini App - Production Architecture & Implementation Plan

**Status**: Draft / prototype (草稿状态).  
**Goal**: Transform this into a **minimal viable production-grade meeting notes app** that can handle 1-hour+ recordings with real-time transcription, summarization, and structured output (notes, action items, speaker identification, timestamps).

## 1. High-Level Architecture (Production-Grade Meeting Notes System)

### Core Flow (End-to-End)
```
User → Mini App UI → Host Bash / Tauri → Service → STT + LLM → Summary → UI
```

### Layered Design (following AGENTS.md & pitfalls)

**1. Storage Layer**
- Audio: `dataDir/miniapps/apps/meeting-notes/audio/{sessionId}/{timestamp}.webm/m4a`
- Transcript: `dataDir/miniapps/apps/meeting-notes/transcript/{sessionId}.jsonl` (timestamped chunks)
- Summary: `dataDir/miniapps/apps/meeting-notes/summary/{sessionId}.md` (final structured notes)
- Metadata: SQLite `meeting_notes.db` (sessions, status, stats)

**2. Processing Pipeline**
```mermaid
graph TD
    A[Record Audio] --> B[Chunk Audio (15-30s)]
    B --> C{STT Service}
    C --> D[Timestamped Transcript JSONL]
    D --> E{LLM Summarization}
    E --> F[Structured Notes (MD/JSON)]
    F --> G[UI Dashboard]
```

**3. Real-time vs Batch (Critical for 1h+ recordings)**

| Approach | Latency | Token Cost | Production Fit |
|----------|---------|------------|----------------|
| **Batch (full file at once)** | 10-60 min | High (1h = ~15k-20k tokens) | Acceptable for final summary |
| **Chunked + Incremental** | Real-time (per 30s) | Medium | **Recommended** |

**Recommended Hybrid**:
- **Live**: 30s chunks → incremental summarization (use `gpt-4o-mini` or `claude-3-5-sonnet` streaming)
- **On-demand full summary**: After recording ends, re-process entire file with `gpt-4o` for higher quality

**STT Options (2026)**:
1. **OpenAI Whisper** (local or via API) - Best accuracy, supports long files
2. **Deepgram** - Real-time + low latency
3. **AssemblyAI** - Best for meetings (speaker diarization out of box)
4. **Local Whisper.cpp** or **faster-whisper** - Zero cost, good enough for internal use

## 2. Implementation Roadmap (Minimal Viable Product)

### Phase 1: Core Recording + Basic Transcription (1-2 days)

**Backend**:
- Add `meeting-notes` miniapp to `miniapps.json`
- Host Bash endpoint: `bash -c "ffmpeg -i input.webm -ar 16000 output.wav"` (for Whisper)
- Use `faster-whisper` Python package (pip install faster-whisper) for local processing
- Chunk audio, transcribe each chunk, store with timestamps

**UI** (Svelte + Shadcn):
- Recording button (stop/start)
- Live transcription pane (scrolling text)
- "End recording" button
- Simple "Download transcript" button

### Phase 2: Real-time Incremental Summarization (2-3 days)

**Key Feature**: Show summary updating in real-time as meeting progresses.

**Implementation**:
1. On each 30s chunk:
   - Transcribe
   - Append to session transcript
   - Prompt: `Summarize the last 30 seconds in 1-2 sentences, keep bullet points for key points`
   - Stream summary to UI
2. Maintain a running "current summary" state
3. On "End meeting" button:
   - Re-run full summary pass
   - Generate structured output

**Structured Output** (use JSON mode):
```json
{
  "title": "Q3 Planning Meeting",
  "date": "2026-08-13",
  "participants": ["Alice", "Bob", "Charlie"],
  "summary": "bullets...",
  "actionItems": [
    {"id": 1, "text": "Review PR #123", "owner": "Alice", "deadline": "2026-08-20"}
  ],
  "speakers": {...}
}
```

### Phase 3: Polish & Production Features (2-3 days)

**Must-Have**:
- Speaker identification (via diarization)
- Timestamped transcript (click to jump)
- "Regenerate summary" button
- Export to Markdown / PDF / DOCX
- Settings for: meeting name, participants list, custom instructions

**Nice-to-Have**:
- AI action item extraction
- Calendar integration (suggest meeting follow-up)
- Theme switching (light/dark)
- Keyboard shortcuts (like existing app)

## 3. UI/UX Recommendations

**Layout** (Desktop-first, matches Geist design system):
```
┌─────────────────────────────────────────────┐
│ [Meeting Title] [Participants] [Duration]   │
├─────────────────────────────────────────────┤
│ [Live Transcription Pane]                   │
│ (scrollable, timestamps)                    │
├─────────────────────────────────────────────┤
│ [Current Summary] [Key Points] [Action Items]│
│ (updates live)                              │
├─────────────────────────────────────────────┤
│ [Record Button] [Stop] [Export] [Delete]    │
└─────────────────────────────────────────────┘
```

**Recording UX**:
- Big red "Start Recording" button
- Live feedback: "Recording... 12:34"
- "End recording" when done
- Auto-save every 30s

**Visual Hierarchy** (per DESIGN.md):
- Use `IosSwitch` for any toggles
- Semantic classes: `meeting-transcript`, `summary-box`, `action-list`

## 4. Technical Decisions (Per AGENTS.md)

**Language**: Python (for Whisper/faster-whisper) + Svelte for UI

**Storage**: Use existing `dataDir` pattern + SQLite for metadata

**LLM**: Default to `claude-3-5-sonnet` (or configured provider), with fallback to local Whisper

**Cost Guardrails**:
- Chunk size: 30s
- Summarization prompt engineering (use `gpt-4o-mini` for incremental, `gpt-4o` for final)

## Next Steps

1. Create `src/lib/server/miniapps/meeting-notes/` directory
2. Add `host.ts` for Python/Whisper processing
3. Implement UI components in `apps/desktop/src/lib/miniapps/meeting-notes.svelte`
4. Update `miniapps.json` to register the app
5. Test with 5-10 min recordings first

Would you like me to:
1. Start implementing **Phase 1** (basic recording + transcription)?
2. Design the **structured JSON output format** in more detail?
3. Create a **prompt template** for the incremental summarization?

Just say the word and I'll generate the code/files. This can become a real product! 🚀
> Archived: 2026-08-22 (early draft/snapshot; authority is docs/requirements/miniapp-ai-facade-prd.md and the shipped built-in app)
