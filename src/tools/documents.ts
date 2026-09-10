import { z } from 'zod';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Workspace } from '../executors/workspace';
import { Registry, type ToolResult } from './registry';
export function documentTools(registry: Registry, root: string, project: string) {
  const workspace=new Workspace(root);
  const execute=async(args: any,signal: AbortSignal):Promise<ToolResult> => {
    const python=join(project,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    if(!existsSync(python)) throw new Error('Document runtime missing. Run the document setup command in README.');
    const source=args.source?await workspace.path(args.source):undefined;
    const output=await workspace.path(`.nix-artifacts/${randomUUID()}`,true);
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const child=spawn(python,[join(project,'scripts/documents.py')],{windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
      let stdout='',stderr='';
      const abort=()=>{child.kill();}; signal.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',d=>{stdout+=d.toString();if(stdout.length>2_000_000){child.kill();reject(new Error('Document worker output exceeded limit.'));}}); child.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-3000);});
      child.on('error',reject);child.stdin.on('error',()=>{});
      child.once('close',()=>{signal.removeEventListener('abort',abort);try{signal.throwIfAborted();const result=JSON.parse(stdout);if(result.error)throw new Error(result.error);resolve(result);}catch(e){reject(e instanceof Error?e:new Error(stderr||'Document worker failed.'));}});
      child.stdin.end(JSON.stringify({...args,source,output}));
    });
  };
  registry.add({name:'document_extract',description:'Extract source-linked text from PDF, DOCX, PPTX, text or scanned images. start is a zero-based section offset. Local OCR requires Tesseract.',schema:z.object({source:z.string().min(1).max(500),start:z.number().int().min(0).default(0),count:z.number().int().min(1).max(5).default(3)}).strict(),policy:'allow',execute:(a,c)=>execute({...a,action:'extract'},c.signal)});
  registry.add({name:'document_create',description:'Create actual source-linked summary/report/slide deliverables with editable DOCX/PPTX, PDF and rendered previews. For a long source, deterministic extractive summarization preserves source sentences. Choose bundle for report and slides together. Source paths are workspace-relative. Uses installed Microsoft Word and PowerPoint for rendering on Windows.',schema:z.object({action:z.enum(['summary','report','slides','bundle']),source:z.string().max(500).optional(),title:z.string().min(1).max(110),sections:z.array(z.object({title:z.string().min(1).max(100),text:z.string().min(1).max(8000),reference:z.string().max(500).optional()}).strict()).max(50).optional()}).strict().refine(a=>!!a.source||!!a.sections?.length,'Supply source or sections'),policy:'ask',execute:(a,c)=>execute(a,c.signal)});
  return registry;
}
