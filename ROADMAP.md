# NiX Companion — Desktop App Roadmap

## Goal

A Windows desktop assistant inspired by Claude Cowork and Codex Work, powered by local models without per-token API charges. Use text or voice to complete tasks on this PC, call MCP tools, and control paired nearby devices. Local inference still has context, memory, and speed limits.

## Work capabilities

- **Coding:** inspect repositories, implement changes, debug, run tests, and explain results with file diffs.
- **Read and summarize:** extract text from PDF, DOCX, PPTX, and text files; use local OCR for scans. Summarize long files in sections and cite source pages/slides where available.
- **Create deliverables:** draft and edit reports, letters, and meeting notes as DOCX/PDF; create editable PPTX presentations from instructions or source documents. Return actual files with previews and open links.

These require file-processing and rendering tools alongside the model; terminal access alone does not complete the document workflow.

## Target PC and model downloads

Detected September 10, 2026: Windows 11 Home, Intel Core Ultra 9 275HX, 32 GB RAM, RTX 5070 Ti Laptop GPU (12 GB VRAM), approximately 38 GiB free on C:.

Install [Ollama](https://ollama.com/download/windows). Download the default model first; optional models and Docker images need additional disk space. Sizes below are download sizes, not total runtime memory.

| Model | Download | Intended use on this PC |
| --- | --- | --- |
| [Qwen3 8B](https://ollama.com/library/qwen3) | `ollama pull qwen3:8b` (~5.2 GB) | Default chat and tool agent; best starting headroom. |
| [Qwen3 14B](https://ollama.com/library/qwen3) | `ollama pull qwen3:14b` (~9.3 GB) | Optional quality experiment; tight VRAM once context is included. |
| [Qwen3-Coder 30B](https://ollama.com/library/qwen3-coder) | `ollama pull qwen3-coder:30b` (~19 GB) | Optional coding model; requires CPU/RAM offloading and benchmarking. Expect slower responses. |
| [faster-whisper small](https://huggingface.co/Systran/faster-whisper-small) | Download through `faster-whisper` during voice setup | Local speech recognition; start with CPU INT8. |
| [Kokoro 82M](https://huggingface.co/hexgrad/Kokoro-82M) | Download weights and a voice during voice setup | Local spoken replies; start on CPU. |

Start with one loaded LLM and a 4K context; try 8K after measuring memory and latency. These are fit estimates, not measured performance. Small models need short tasks and verified tool results. The 30B model's sparse activation does not eliminate storage for all its weights.

## Architecture

- **Desktop:** Electron + React + TypeScript; SQLite for tasks, settings, and event history. Keep execution in the main process; sandbox the renderer and expose narrow, validated IPC.
- **Model adapter:** Ollama first, replaceable behind a streaming chat/tool-call interface. No required cloud inference.
- **Runtime:** `Task` = user goal; `Run` = execution attempt; `Turn` = one model response and its tool results.
- **Loop:** load context → model → validate tool arguments → route → permission check → execute → observe output/errors/artifacts → continue or verify completion.
- **Execution adapters:** host PowerShell/files/processes and Docker shell/files/processes behind the same interface. Use [Open Terminal / Open WebUI](https://docs.openwebui.com/features/open-terminal/) as the execution-environment reference; evaluate reuse separately from NiX's UI/runtime.

## Implementation milestones

Implement in order; each milestone must work before the next begins. Complete milestone 4's work-deliverable checks before adding integrations.

1. [x] **Desktop + local chat:** Scaffold the app, model selector, streaming chat, connection errors, and persistent history. **Done:** restart the app and continue an offline conversation. Implemented and tested with local `qwen3:14b`, including code-word recall after a full desktop restart; see `README.md` for run and verification commands.
2. [x] **Agent loop + permissions:** Add typed tool registry, argument validation, allow/ask/deny policies, run-scoped approvals, audit events, cancellation, timeouts, and retry/turn limits. Start with mock tools. **Done:** a denied action never executes; a failing tool returns feedback and the loop stops at its limit. Covered by `tests/agent.test.ts`.
3. [x] **Host and Docker execution:** Implement file operations, full terminal sessions, package/CLI execution, process polling, and termination. Host mode uses the current Windows user's rights; elevation is separate. Docker uses WSL2/Linux containers with selected workspace mounts, configurable network access, and no Docker socket mount. Never silently fall back to host. **Done:** create, run, and repair a script in either mode; cancellation stops its process tree. Covered by `tests/execution.test.ts` and the opt-in real Docker acceptance in `tests/docker.test.ts`.
4. [x] **Context + reliable tasks:** Persist run events, tool results, artifacts, and checkpoints. Bound tool output; summarize older turns while preserving goals, permissions, and file references. Resume interrupted runs without blindly repeating side effects. **Done:** recover a task after restart and show evidence of completion. Covered by `tests/recovery.test.ts` and the task UI restart test.
   - [x] **Work deliverables:** Add document extraction, local OCR, source-linked summaries, DOCX/PDF/PPTX generation, and rendered previews. **Done:** summarize a long document with traceable references; create a report and editable slide deck from it; verify files reopen and inspect rendered pages/slides for clipping and missing content. Covered by `scripts/test-documents.py` using Microsoft Word and PowerPoint render checks.
5. [x] **MCP + computer interaction:** Support MCP stdio and Streamable HTTP, tool discovery, credentials, and the same permission gate. Add browser automation, then Windows accessibility/screenshot tools. **Done:** complete one MCP task and one browser task with visible action history. Covered by `tests/integrations.test.ts` and Electron task screenshots.
6. [x] **Voice + nearby devices:** Add push-to-talk transcription and spoken replies. Start with one authenticated LAN adapter, such as Home Assistant; add discovery/pairing and device-specific Bluetooth adapters later. **Done:** text and voice can operate one paired device; unpaired requests are rejected. Covered by local voice worker smoke tests and an authenticated Home Assistant fixture; real LAN device acceptance requires a Home Assistant URL, token, and paired entity.
7. [x] **Usable release:** Package a Windows installer; add setup checks, model download controls, environment indicators, artifact links, and log export. **Done:** packaged app launches, Settings shows setup checks and model downloads, artifacts/logs are exposed from run evidence, and NSIS installer output is produced in `release`.

## Implementation rules

- Keep modules separate: `desktop`, `runtime`, `models`, `tools`, `executors`, `permissions`, `storage`, `voice`, `devices`.
- Give the implementing model one milestone at a time, with interfaces and acceptance checks. Prefer small patches; defer multi-agent orchestration and autonomous scheduling.
- Permissions are enforced by code before every action, including MCP and device calls. Tool output is untrusted data and cannot grant permission.
- Test permission boundaries, cancellation, malformed tool calls, recovery, and sandbox separation. Never claim success solely because the model says it finished.
