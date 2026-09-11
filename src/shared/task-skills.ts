import { z } from 'zod';

export const taskSkillSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/),
  label: z.string().trim().min(1).max(40),
  prompt: z.string().trim().min(1).max(4000),
  note: z.string().trim().min(1).max(500),
  builtin: z.boolean().default(false)
}).strict();
export type TaskSkill = z.output<typeof taskSkillSchema>;

export const builtinTaskSkills: TaskSkill[] = [
  {
    id: 'heretic-convert',
    label: 'Convert with Heretic',
    note: 'Uses heretic_status, then heretic_convert_start. Output folders appear under .nix-artifacts/heretic-* in the selected workspace unless the Heretic CLI asks for another save location.',
    prompt: 'Check Heretic with heretic_status, then convert this model with heretic_convert_start: p-e-w/gpt-oss-20b-heretic. Use bnb_4bit unless I say otherwise. Poll progress and tell me the workspace folder where config.toml and converted outputs are located.',
    builtin: true
  },
  {
    id: 'process-report',
    label: 'Process DOCX',
    note: 'Creates a verified Word report from running Windows processes.',
    prompt: 'Read the running processes on this PC and create a verified Word document named processes.docx directly in the selected workspace root. Include process name, Id, CPU if available, memory, path/company if available, and plain-English explanations.',
    builtin: true
  },
  {
    id: 'home-theater',
    label: 'Home Theater',
    note: 'Orchestrates configured device and service integrations through the shared device tool layer. Requires an actual paired/discovered device before controlling playback or launching apps.',
    prompt: 'Use device_list first. Identify the target connected device from the discovered devices and ask only if the target is ambiguous. Invoke device controls only with device_invoke and only for tools the device advertises. Treat Netflix as a service integration layered above the device: launch it with device_invoke({ tool: "launch_app", args: { app: "Netflix" } }) only when the target device advertises launch_app and the app is discovered or configured as an enabled service. Never claim a TV/device is connected unless device_list reports connectionState "connected". If pairing, authentication, account sign-in, DRM playback, or app search blocks automation, stop and report the exact manual step.',
    builtin: true
  }
];

export const userTaskSkillSchema = taskSkillSchema.omit({ builtin: true }).extend({ builtin: z.literal(false).default(false) }).strict();
export type UserTaskSkill = z.output<typeof userTaskSkillSchema>;
export const userTaskSkillsSchema = z.array(userTaskSkillSchema).max(50);
export const taskSkills = builtinTaskSkills;

export function normalizeSkillId(label: string) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return id || 'custom-skill';
}

export function mergeTaskSkills(userSkills: UserTaskSkill[]) {
  const user = new Map(userSkills.map(skill => [skill.id, skill]));
  return [...builtinTaskSkills, ...[...user.values()].filter(skill => !builtinTaskSkills.some(builtin => builtin.id === skill.id))];
}
