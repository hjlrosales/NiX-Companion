import { z } from 'zod';
import type { AuditEvent, Run } from './agent';
import { normalizeSkillId, type UserTaskSkill } from './task-skills';

const textArray = z.array(z.string().trim().min(1).max(1000)).max(30);

export const executionTraceSchema = z.object({
  taskId: z.string().min(1),
  runId: z.string().min(1),
  conversationId: z.string().min(1),
  userObjective: z.string().min(1),
  toolsUsed: textArray,
  pluginsUsed: textArray,
  skillsUsed: textArray,
  toolInputs: z.array(z.object({ tool: z.string(), input: z.unknown(), order: z.number() })).max(100),
  toolOutputs: z.array(z.object({ tool: z.string(), output: z.string(), order: z.number(), evidence: textArray.optional(), artifacts: textArray.optional() })).max(100),
  executionOrder: textArray,
  permissionsRequested: textArray,
  permissionsGranted: textArray,
  errors: textArray,
  retries: z.number().int().min(0),
  userCorrections: textArray,
  finalResult: z.string().max(12000),
  success: z.boolean(),
  verificationResult: z.string().max(4000),
  teachMode: z.boolean()
}).strict();
export type ExecutionTrace = z.output<typeof executionTraceSchema>;

export const learnedSkillSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  triggers: textArray,
  instructions: z.string().trim().min(1).max(12000),
  requiredInputs: textArray,
  tools: textArray,
  plugins: textArray,
  permissions: textArray,
  workflow: textArray,
  examples: textArray,
  verification: textArray,
  failureHandling: textArray,
  provenance: z.object({
    runIds: textArray,
    taskIds: textArray,
    learnedFrom: z.array(z.object({ kind: z.enum(['constant', 'variable', 'condition', 'user_preference']), text: z.string().min(1).max(1000), support: z.number().int().min(1) })).max(80)
  }).strict()
}).strict();
export type LearnedSkill = z.output<typeof learnedSkillSchema>;

export const skillValidationSchema = z.object({
  workflowRecognized: z.boolean(),
  requiredToolsAvailable: z.boolean(),
  permissionsValid: z.boolean(),
  testExecutionSuccessful: z.boolean(),
  outputVerified: z.boolean(),
  messages: textArray
}).strict();
export type SkillValidation = z.output<typeof skillValidationSchema>;

function parse(data: string) {
  try { return JSON.parse(data); } catch { return data; }
}

function unique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function compact(value: unknown, limit = 280) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').replace(/\s+/g, ' ').slice(0, limit);
}

export function buildExecutionTrace(run: Run, events: AuditEvent[]): ExecutionTrace {
  const toolInputs: ExecutionTrace['toolInputs'] = [];
  const toolOutputs: ExecutionTrace['toolOutputs'] = [];
  const order: string[] = [];
  const plugins: string[] = [];
  const skills: string[] = [];
  const permissionsRequested: string[] = [];
  const permissionsGranted: string[] = [];
  const errors: string[] = [];
  const corrections: string[] = [];
  let finalResult = run.summary || '';
  let verification = '';
  let teachMode = !!run.teach;

  events.forEach((event, index) => {
    const data = parse(event.data) as any;
    if (event.type === 'teach.started') teachMode = true;
    if (event.type === 'capability.discovery') {
      for (const skill of data.selectedSkills ?? []) skills.push(skill.name ?? skill.id);
    }
    if (event.type === 'user.message' && index > 1 && typeof data.content === 'string') corrections.push(data.content);
    if (event.type === 'tool.started') {
      const name = data.name ?? data.tool ?? 'tool';
      toolInputs.push({ tool: name, input: data.arguments ?? {}, order: index + 1 });
      order.push(`${index + 1}. ${name}`);
      if (data.capability?.name) plugins.push(data.capability.name);
      if (Array.isArray(data.permissions)) permissionsRequested.push(...data.permissions);
    }
    if (event.type === 'tool.result') {
      const name = data.name ?? data.tool ?? 'tool';
      toolOutputs.push({ tool: name, output: compact(data.output, 1200), order: index + 1, evidence: data.evidence, artifacts: data.artifacts });
      order.push(`${index + 1}. ${name} result`);
      if (Array.isArray(data.evidence) && data.evidence.length) verification = data.evidence.join('; ');
      if (Array.isArray(data.artifacts) && data.artifacts.length) verification = `Artifacts created: ${data.artifacts.join(', ')}`;
    }
    if (event.type === 'tool.error' || event.type === 'run.stopped') errors.push(compact(data.error ?? data.reason ?? data, 500));
    if (event.type === 'permission.approved' || event.type === 'permission.auto_approved') permissionsGranted.push(compact(data.tool ?? data, 180));
    if (event.type === 'run.review') finalResult = data.summary ?? finalResult;
    if (event.type === 'user.accepted') verification ||= 'User reviewed task evidence and accepted the result.';
  });

  const success = run.status === 'completed' || events.some(event => event.type === 'user.accepted');
  return executionTraceSchema.parse({
    taskId: run.taskId,
    runId: run.id,
    conversationId: run.id,
    userObjective: run.goal,
    toolsUsed: unique(toolInputs.map(item => item.tool)),
    pluginsUsed: unique(plugins),
    skillsUsed: unique(skills),
    toolInputs,
    toolOutputs,
    executionOrder: unique(order),
    permissionsRequested: unique(permissionsRequested),
    permissionsGranted: unique(permissionsGranted),
    errors: unique(errors),
    retries: errors.length,
    userCorrections: unique(corrections),
    finalResult,
    success,
    verificationResult: verification || (success ? 'Accepted by user after review.' : 'Not yet accepted.'),
    teachMode
  });
}

function workflowFromTrace(trace: ExecutionTrace) {
  const steps = trace.executionOrder.length ? trace.executionOrder : ['Understand the user objective.', 'Execute the workflow with available tools.', 'Verify the result before reporting completion.'];
  return steps.map(step => step.replace(/^\d+\.\s*/, ''));
}

export function synthesizeSkill(traces: ExecutionTrace[], name?: string): LearnedSkill {
  if (!traces.length) throw new Error('Select at least one task to learn from.');
  const successful = traces.filter(trace => trace.success);
  if (!successful.length) throw new Error('Skill creation needs at least one accepted successful task.');
  const source = successful[0];
  const tools = unique(successful.flatMap(trace => trace.toolsUsed));
  const plugins = unique(successful.flatMap(trace => trace.pluginsUsed));
  const permissions = unique(successful.flatMap(trace => trace.permissionsRequested));
  const corrections = unique(successful.flatMap(trace => trace.userCorrections));
  const workflow = unique(successful.flatMap(workflowFromTrace));
  const skillName = (name?.trim() || source.userObjective.split(/\s+/).slice(0, 6).join(' ')).slice(0, 80);
  const provenance = [
    ...workflow.slice(0, 12).map(text => ({ kind: 'constant' as const, text, support: successful.length })),
    ...tools.map(text => ({ kind: 'constant' as const, text: `Requires tool ${text}.`, support: successful.filter(trace => trace.toolsUsed.includes(text)).length })),
    ...corrections.map(text => ({ kind: 'user_preference' as const, text, support: successful.filter(trace => trace.userCorrections.includes(text)).length }))
  ];
  const instructions = [
    `Reusable workflow learned from ${successful.length} accepted task(s).`,
    `Objective pattern: ${source.userObjective}`,
    '',
    'Workflow:',
    ...workflow.map((step, index) => `${index + 1}. ${step}`),
    '',
    'Verification:',
    ...(successful.map(trace => trace.verificationResult).filter(Boolean).slice(0, 6).map(item => `- ${item}`)),
    '',
    'Failure handling:',
    '- Stop and report the exact blocker if a required tool, permission, or integration is unavailable.',
    '- Do not install plugins for ordinary workflows; suggest plugin creation only when a missing capability/tool is required.',
    corrections.length ? `User preferences/corrections: ${corrections.join(' | ')}` : ''
  ].filter(Boolean).join('\n');
  return learnedSkillSchema.parse({
    id: normalizeSkillId(skillName),
    name: skillName,
    description: `Repeatable workflow learned from accepted NiX execution traces for: ${source.userObjective}`.slice(0, 500),
    version: '1.0.0',
    triggers: unique(successful.map(trace => trace.userObjective)).slice(0, 8),
    instructions,
    requiredInputs: ['User objective', ...unique(successful.flatMap(trace => trace.toolInputs.map(item => compact(item.input, 80)))).slice(0, 5)],
    tools,
    plugins,
    permissions,
    workflow,
    examples: successful.map(trace => trace.userObjective).slice(0, 5),
    verification: unique(successful.map(trace => trace.verificationResult || 'Verify the observable output before completion.')),
    failureHandling: ['Required tool unavailable', 'Permission denied', 'Output cannot be verified', 'User correction conflicts with learned workflow'],
    provenance: { runIds: successful.map(trace => trace.runId), taskIds: unique(successful.map(trace => trace.taskId)), learnedFrom: provenance }
  });
}

export function validateSkill(skill: LearnedSkill, availableTools: string[], testTrace?: ExecutionTrace): SkillValidation {
  const missing = skill.tools.filter(tool => !availableTools.includes(tool));
  const recognized = skill.workflow.length > 0 && skill.triggers.length > 0;
  const testOk = testTrace ? testTrace.success && skill.tools.every(tool => testTrace.toolsUsed.includes(tool) || !availableTools.includes(tool)) : true;
  return skillValidationSchema.parse({
    workflowRecognized: recognized,
    requiredToolsAvailable: missing.length === 0,
    permissionsValid: skill.permissions.every(permission => permission.length > 0),
    testExecutionSuccessful: testOk,
    outputVerified: testTrace ? !!testTrace.verificationResult && testTrace.success : skill.verification.length > 0,
    messages: [
      recognized ? 'Workflow recognized' : 'Workflow needs at least one trigger and step',
      missing.length ? `Missing tools: ${missing.join(', ')}` : 'Required tools available',
      testTrace ? `Validated against task ${testTrace.runId.slice(0, 8)}` : 'Representative test can use the accepted source trace until a new test task is selected'
    ]
  });
}

export function learnedSkillToTaskSkill(skill: LearnedSkill): UserTaskSkill {
  return {
    id: skill.id,
    label: skill.name.slice(0, 40),
    note: skill.description.slice(0, 500),
    prompt: skill.instructions.slice(0, 4000),
    builtin: false
  };
}
