# NiX Companion

NiX Companion is a local-first Windows desktop assistant built with Electron, React, TypeScript, SQLite, and Ollama. It supports chat, reviewed task runs, host and Docker execution, document extraction and deliverable creation, MCP tools, isolated browser automation, Windows accessibility helpers, local voice, and paired Home Assistant devices.

The interface uses the supplied spiral mark as a titanium/cyan emblem in a dark sci-fi neumorphic theme. The generated raster asset is `public/nix-emblem.png`; the Windows icon is `public/icon.ico`.

## Run

From PowerShell in this folder:

```powershell
npm.cmd ci
npm.cmd start
```

Install or start Ollama, then select an installed local model. The Settings view can download the recommended models:

- `qwen3:8b` for the default local task model.
- `qwen3:14b` for higher quality if the machine has enough headroom.
- `qwen3-coder:30b` for slower coding experiments.

## Setup

Settings shows live readiness for Ollama, Microsoft Office, Python workers, Docker, Microsoft Edge, and voice models. Microsoft Office is used for DOCX/PPTX rendering on this Windows machine; LibreOffice is not required.

Document and voice workers use the project `.venv`. To rebuild the Python environment:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r scripts\requirements-documents.txt
.\.venv\Scripts\python.exe -m pip install -r scripts\requirements-voice.txt
```

Voice setup downloads local Whisper and Kokoro model files into `.nix-models` in development. Packaged builds download voice models into Electron user data.

Home Assistant pairing is configured in Settings JSON. Only explicitly paired `light.*` and `switch.*` entities are exposed to the model, and each device action still goes through the permission gate.

The default MCP configuration includes the local Claude MCP servers for Blender, Autodesk Civil 3D, and NiX Hydraulic Analyst. Existing saved integration settings are merged with these defaults at load/save time. Settings also accepts Claude Desktop style JSON with a top-level `mcpServers` object and converts each entry to NiX's stdio MCP format.

## Task Safety

Every tool is registered with a typed schema and a policy: allow, ask, or deny. Ask tools show the exact tool name and JSON arguments before execution. Run-scoped remembered approvals match the same tool and the same argument payload only. Tool output is untrusted and cannot grant permission.

Host mode runs PowerShell with the current Windows user's rights. Docker mode uses the selected workspace mount, Linux containers, no Docker socket, dropped capabilities, process/memory/CPU limits, and no silent fallback to host. Browser automation uses an isolated profile, blocks downloads, and prefers installed Edge on Windows.

Completed agent runs stop in `review` until the user accepts the evidence. Interrupted runs can be resumed with checkpoints and prior evidence; pending approvals do not replay after restart.

## Verify

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:e2e
```

Real Docker acceptance:

```powershell
$env:NIX_TEST_DOCKER='1'
npx.cmd tsx --test tests/docker.test.ts
```

Document workflow acceptance:

```powershell
.\.venv\Scripts\python.exe scripts\test-documents.py
```

Voice worker smoke test:

```powershell
$models = Join-Path (Get-Location) '.nix-models'
$out = Join-Path (Get-Location) 'verification\voice\roundtrip.wav'
@{ action='setup'; models=$models } | ConvertTo-Json -Compress | .\.venv\Scripts\python.exe scripts\voice.py
@{ action='speak'; models=$models; text='NiX voice verification phrase. Local speech works.'; output=$out } | ConvertTo-Json -Compress | .\.venv\Scripts\python.exe scripts\voice.py
@{ action='transcribe'; models=$models; input=$out } | ConvertTo-Json -Compress | .\.venv\Scripts\python.exe scripts\voice.py
```

Build release artifacts:

```powershell
npm.cmd run package:dir
npm.cmd run package
```

The installer is written to `release\NiX Companion Setup 0.1.0.exe`.

## Source Layout

| Directory | Responsibility |
| --- | --- |
| `src/desktop` | Main process, restricted preload bridge, React UI |
| `src/runtime` | Chat and agent loops, context budgeting, cancellation |
| `src/models` | Ollama streaming chat and tool-call adapter |
| `src/storage` | SQLite history, settings, runs, audit events |
| `src/permissions` | Policy gate and run-scoped approvals |
| `src/executors` | Workspace and process execution backends |
| `src/tools` | File, terminal, document, MCP, browser, Windows tools |
| `src/voice` | Local transcription and spoken replies |
| `src/devices` | Home Assistant pairing and device control |
| `tests` | Unit, integration, Docker, and Electron acceptance tests |

## License

MIT License. Copyright (c) 2026 Herly Jhun Rosales. See [LICENSE](LICENSE).
