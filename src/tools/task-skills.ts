import { z } from 'zod';
import { Registry } from './registry';
import type { UserTaskSkill } from '../shared/task-skills';
import { normalizeSkillId } from '../shared/task-skills';

export type SkillStore = {
  userTaskSkills(): UserTaskSkill[];
  upsertUserTaskSkill(skill: UserTaskSkill): void;
  deleteUserTaskSkill(id: string): void;
};

const skillInput = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/).optional(),
  label: z.string().trim().min(1).max(40),
  prompt: z.string().trim().min(1).max(4000),
  note: z.string().trim().min(1).max(500)
}).strict();

export function taskSkillTools(registry: Registry, store: SkillStore, changed: () => void) {
  registry.add({
    name: 'task_skill_list',
    description: 'List user-added reusable task skills. Skills are saved prompt recipes shown as buttons in Tasks.',
    schema: z.object({}).strict(),
    policy: 'allow',
    capabilityId: 'task-skill-manager',
    permissions: [],
    execute: async () => ({ output: JSON.stringify({ skills: store.userTaskSkills() }) })
  });
  registry.add({
    name: 'task_skill_add',
    description: 'Create or update a reusable task skill button from the current user request. This saves a prompt recipe only; it does not install code, plugins, or hidden permissions.',
    schema: skillInput,
    policy: 'ask',
    capabilityId: 'task-skill-manager',
    permissions: ['skill.manage'],
    execute: async (a) => {
      const skill = { id: a.id ?? normalizeSkillId(a.label), label: a.label, prompt: a.prompt, note: a.note, builtin: false as const };
      store.upsertUserTaskSkill(skill); changed();
      return { output: JSON.stringify(skill), evidence: [`Saved task skill ${skill.label}`] };
    }
  });
  registry.add({
    name: 'task_skill_delete',
    description: 'Delete one user-added reusable task skill. Built-in skills cannot be deleted.',
    schema: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/) }).strict(),
    policy: 'ask',
    capabilityId: 'task-skill-manager',
    permissions: ['skill.manage'],
    execute: async (a) => { store.deleteUserTaskSkill(a.id); changed(); return { output: `Deleted task skill ${a.id}.`, evidence: [`Deleted task skill ${a.id}`] }; }
  });
  return registry;
}
