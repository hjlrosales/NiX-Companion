# HOWTO: Install, Run, Build, and Create the Installer

This guide explains the basic workflow in plain language. Run these commands in **PowerShell** from the NiX Companion project folder:

```powershell
cd "C:\Users\hjlro\Documents\ai\NiX Companion"
```

## 1. Install The App Dependencies

Dependencies are the files NiX Companion needs before it can run or build.

```powershell
npm.cmd ci
```

Use `npm.cmd ci` instead of `npm install` when you want the exact versions from `package-lock.json`.

If this fails, check that Node.js and npm are installed:

```powershell
node --version
npm --version
```

## 2. Run NiX Companion

This builds the app first, then opens the desktop app.

```powershell
npm.cmd start
```

What this does:

- Checks the TypeScript code.
- Builds the React interface.
- Builds the Electron desktop files.
- Starts NiX Companion.

If the app opens but no AI model is available, start Ollama and download a model from the Settings screen, or run:

```powershell
ollama pull qwen3:8b
```

Settings can also download an Ollama-ready Heretic GGUF model:

```powershell
ollama pull hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1
```

The original `p-e-w/gpt-oss-20b-heretic` model is a Safetensors/Transformers model. Use the Heretic conversion capability for that source model; use the GGUF download above when you want Ollama to run it directly.

## 3. Build The App Without Opening It

Use this when you only want to check that the project compiles correctly.

```powershell
npm.cmd run build
```

A successful build creates output in the `dist` folder.

## 4. Run Tests

Use this to check that the main features still work.

```powershell
npm.cmd test
```

For the full Electron browser-style tests:

```powershell
npm.cmd run test:e2e
```

The e2e tests take longer because they launch the desktop app.

## Optional: Enable Heretic Model Conversion

Heretic is a separate Python tool that can convert supported Hugging Face or local model folders.

Install it in a Python 3.10 or newer environment that can use your GPU:

```powershell
py -3.12 -m pip install -U heretic-llm
```

Then open NiX Companion, go to **Tasks**, choose **Host - PowerShell**, and ask something like this. You can also press `/` in Tasks to select the Heretic capability/tool from the picker:

```text
Convert Qwen/Qwen3-4B-Instruct-2507 with Heretic using 4-bit quantization.
```

NiX will create a `.nix-artifacts\heretic-*` folder, write a `config.toml`, start Heretic, and monitor the process. Heretic can take a long time and may ask what to do with the converted model when it finishes.

The internal tool names are `heretic_status` and `heretic_convert_start`. You do not open them from a separate menu; NiX calls them during a task and shows them in the task log. Converted model files are in the selected workspace under `.nix-artifacts\heretic-*` unless the Heretic command asks you to save somewhere else.

## Optional: Add ChatGPT Or Claude

Open **Settings**, click **Add ChatGPT / OpenAI** or **Add Claude**, paste your API key into the JSON, save integrations, and refresh models.

After saving, the normal model selector will include names like:

```text
openai:gpt-4.1-mini
anthropic:claude-sonnet-4-5
```

## Optional: Add Your Own Skills

Skills are reusable instruction packages. They help NiX remember a workflow you often use, but they do not install code, expose tools, or bypass permissions.

Open **Tasks** and ask NiX something like:

```text
Add a NiX skill called INP QA that imports an .inp file, checks it against my requirements, uses the hydraulic MCP tools when available, and verifies the final file before reporting.
```

After NiX saves it, the new skill appears in **Capabilities** and in the skill list in Settings. Use Settings to remove custom skills.

## 5. Create A Folder Build

This creates an unpacked Windows app folder. It is useful for testing the packaged app before making the installer.

```powershell
npm.cmd run package:dir
```

The output goes into the `release` folder.

## 6. Create The Windows Installer

This creates the real `.exe` installer.

```powershell
npm.cmd run package
```

When it finishes, look in:

```text
release\NiX Companion Setup 0.1.0.exe
```

That file is the installer you can run on Windows.

## Common Workflow

For normal development:

```powershell
npm.cmd ci
npm.cmd start
```

Before creating an installer:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run package
```

## What The Main Commands Mean

| Command | Meaning |
| --- | --- |
| `npm.cmd ci` | Install the exact required packages |
| `npm.cmd start` | Build and open the app |
| `npm.cmd run build` | Compile the app only |
| `npm.cmd test` | Run unit and integration tests |
| `npm.cmd run test:e2e` | Run desktop app tests |
| `npm.cmd run package:dir` | Create an unpacked app folder |
| `npm.cmd run package` | Create the Windows installer |

## If Something Goes Wrong

If npm warns about Node.js versions but the command still finishes successfully, you can usually continue.

If a command fails, try this clean install:

```powershell
Remove-Item -Recurse -Force node_modules
npm.cmd ci
```

If packaging fails, make sure the app builds first:

```powershell
npm.cmd run build
```

Then try the installer again:

```powershell
npm.cmd run package
```
