import { z } from 'zod';
import { Registry } from './registry';
import { execFile } from 'node:child_process';
import { join,dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Workspace } from '../executors/workspace';
export function windowsTools(registry:Registry,root:string,project:string){
  const files=new Workspace(root);
  registry.add({name:'windows_accessibility',description:'Read Windows top-level windows, inspect controls for an exact PID, or invoke one exact automation ID. Invoking can affect another application. All actions require approval.',schema:z.object({action:z.enum(['list','inspect','invoke']),pid:z.number().int().positive().optional(),automationId:z.string().max(300).optional()}).strict(),policy:'ask',execute:async(a,c)=>({output:await run(['-Action',a.action,'-TargetPid',String(a.pid??0),'-AutomationId',a.automationId??''],c.signal),evidence:[`Windows accessibility ${a.action}`]})});
  registry.add({name:'windows_screenshot',description:'Capture all displays. Screenshots may contain private information from visible applications; saved locally in the task workspace.',schema:z.object({}).strict(),policy:'ask',execute:async(_a,c)=>{const path=await files.path(`.nix-artifacts/desktop-${randomUUID()}.png`,true);await mkdir(dirname(path),{recursive:true});await run(['-Action','screenshot','-OutputPath',path],c.signal);return{output:'Desktop captured.',artifacts:[path]};}});
  function run(args:string[],signal:AbortSignal):Promise<string>{if(process.platform!=='win32')throw new Error('Windows accessibility requires Windows.');return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',join(project,'scripts/windows.ps1'),...args],{windowsHide:true,signal,timeout:20000,maxBuffer:1000000},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve(stdout.slice(0,12000))));}return registry;
}
