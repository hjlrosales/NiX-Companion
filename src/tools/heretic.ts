import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ParsedRunInput } from '../shared/agent';
import { Workspace } from '../executors/workspace';
import type { Processes } from '../executors/processes';
import { Registry } from './registry';

const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const tomlString = (value: string) => JSON.stringify(value);

export function hereticTools(registry: Registry, input: ParsedRunInput, processes: Processes) {
  if (input.mode !== 'host') return registry;
  const workspace = new Workspace(input.workspace);
  registry.add({
    name: 'heretic_status',
    description: 'Check whether the Heretic CLI is available for local model conversion. Heretic is installed with: pip install -U heretic-llm',
    schema: z.object({}).strict(),
    policy: 'allow',
    capabilityId: 'heretic',
    permissions: ['process.execute'],
    execute: async (_a, c) => ({
      output: JSON.stringify(await processes.start(c.runId, input.workspace, 'host', input.network, 'if (Get-Command heretic -ErrorAction SilentlyContinue) { heretic --help } else { Write-Error "Heretic CLI not found. Install with: py -3.12 -m pip install -U heretic-llm" }', c.signal)),
      evidence: ['Started Heretic availability check']
    })
  });
  registry.add({
    name: 'heretic_convert_start',
    description: 'Start a Heretic local model conversion. Creates .nix-artifacts/heretic-*/config.toml in the workspace, then runs the heretic CLI from that folder. Poll the returned sessionId with terminal_poll. If Heretic asks what to do after optimization, use terminal_input to choose saving to a local folder.',
    schema: z.object({
      model: z.string().min(1).max(500).describe('Hugging Face model ID or local model folder/path, for example Qwen/Qwen3-4B-Instruct-2507.'),
      quantization: z.enum(['none','bnb_4bit']).default('bnb_4bit'),
      nTrials: z.number().int().min(1).max(1000).default(200),
      nStartupTrials: z.number().int().min(1).max(300).default(60),
      maxShardSize: z.string().min(2).max(20).default('5GB')
    }).strict(),
    policy: 'ask',
    capabilityId: 'heretic',
    permissions: ['filesystem.write', 'process.execute', 'network.access'],
    execute: async (a, c) => {
      const relativeRunDir = `.nix-artifacts/heretic-${randomUUID()}`;
      const runDir = await workspace.path(relativeRunDir, true);
      await mkdir(runDir, { recursive: true });
      const config = [
        `quantization = ${tomlString(a.quantization)}`,
        'device_map = "auto"',
        'offload_outputs_to_cpu = true',
        `n_trials = ${a.nTrials}`,
        `n_startup_trials = ${a.nStartupTrials}`,
        'study_checkpoint_dir = "checkpoints"',
        `max_shard_size = ${tomlString(a.maxShardSize)}`,
        ''
      ].join('\n');
      await writeFile(join(runDir, 'config.toml'), config, 'utf8');
      const command = `$ErrorActionPreference = 'Stop'\nSet-Location ${psQuote(runDir)}\nif (-not (Get-Command heretic -ErrorAction SilentlyContinue)) { throw 'Heretic CLI not found. Install it first with: py -3.12 -m pip install -U heretic-llm' }\nheretic ${psQuote(a.model)}`;
      const session = await processes.start(c.runId, input.workspace, 'host', input.network, command, c.signal);
      return {
        output: JSON.stringify({ ...session, runDir: relativeRunDir, next: 'Poll sessionId with terminal_poll. When Heretic shows the final menu, send the menu choice for saving the model with terminal_input.' }),
        artifacts: [runDir, join(runDir, 'config.toml')],
        evidence: [`Started Heretic conversion for ${a.model}`, `Wrote ${relativeRunDir}/config.toml`]
      };
    }
  });
  return registry;
}
