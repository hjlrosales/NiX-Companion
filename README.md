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
- `hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1` for an Ollama-ready GGUF quant of the Hugging Face gpt-oss 20B Heretic model.

## Setup

Settings shows live readiness for Ollama, Microsoft Office, Python workers, Docker, Microsoft Edge, and voice models. Microsoft Office is used for DOCX/PPTX rendering on this Windows machine; LibreOffice is not required.

Document and voice workers use the project `.venv`. To rebuild the Python environment:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r scripts\requirements-documents.txt
.\.venv\Scripts\python.exe -m pip install -r scripts\requirements-voice.txt
```

Voice setup downloads local Whisper and Kokoro model files into `.nix-models` in development. Packaged builds download voice models into Electron user data.

Heretic local model conversion is available from Tasks in Host mode. Install Heretic in a Python 3.10+ environment that can access your GPU:

```powershell
py -3.12 -m pip install -U heretic-llm
```

Then open Tasks and ask NiX to convert a Hugging Face model ID or local model folder, or press `/` to select the Heretic capability/tool from the capability picker. NiX calls the internal `heretic_status` tool first, then `heretic_convert_start`. Those tool names appear in the task log with their owning capability, permissions, and result. NiX creates a `.nix-artifacts\heretic-*` workspace folder with `config.toml`, starts the `heretic` CLI, and can poll or answer the CLI prompts during the run. Converted model files are found in that run folder unless the Heretic CLI asks you to choose a different save location.

The base `p-e-w/gpt-oss-20b-heretic` repository is Safetensors/Transformers-first. Ollama downloads need a runnable Ollama library model or GGUF quant, so NiX's one-click download uses a GGUF quantization of that model.

To use ChatGPT/OpenAI or Claude, open Settings, click **Add ChatGPT / OpenAI** or **Add Claude**, paste the API key, save integrations, then refresh models. Configured API models appear in the normal model selector as `openai:model-name` or `anthropic:model-name`.

Tasks include a manifest-backed capability system for skills, plugins, apps, and concrete tools. Open **Capabilities** to inspect what is installed, what permissions each tool needs, and when a capability was last used. You can add your own workflow skill by asking in Tasks, for example: `Add a NiX skill called INP QA that reads an imported .inp file, checks it against my constraints, uses the hydraulic MCP tools when available, and verifies the final file before reporting.` Skills guide the AI; plugins/apps expose tools; permissions are enforced by the runtime.

TV casting depends on Windows, the TV, and network discovery; NiX can open the right Windows/Edge screens, but you may still need to click the TV or sign in because those prompts are intentionally interactive.

Home Assistant pairing is configured in Settings JSON. Only explicitly paired `light.*` and `switch.*` entities are exposed to the model, and each device action still goes through the permission gate.

The default MCP configuration includes the local Claude MCP servers for Blender, Autodesk Civil 3D, and NiX Hydraulic Analyst. Existing saved integration settings are merged with these defaults at load/save time. Settings also accepts Claude Desktop style JSON with a top-level `mcpServers` object and converts each entry to NiX's stdio MCP format.

## Task conversations

In Tasks, send a reply to refine the selected task. NiX keeps its original goal, earlier replies, evidence, and artifacts in the same history, including after restart. Replies use the task's original model and workspace. Wait for the current execution to finish or stop it before replying. Choose **New task** to start a separate history.

For application workflows, NiX is instructed to discover the configured MCP server, inspect the selected tool schema, and call its tools. Discovery is paged so large catalogs do not lose schemas through truncation. Task inference uses an 8K context to leave room for tool schemas; older conversation context may be compacted. A file write alone triggers a verification reminder; review still requires checking the evidence and is not a guarantee of a complete or valid deliverable.

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
