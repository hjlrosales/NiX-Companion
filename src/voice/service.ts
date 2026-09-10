import { spawn,execFile } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir,writeFile,readFile,unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export class VoiceService{
  private controller:AbortController|null=null;
  constructor(private project:string,private models:string,private temp:string){}
  status(){return {ready:['whisper-small/model.bin','kokoro-v1.0.onnx','voices-v1.0.bin'].every(p=>existsSync(join(this.models,p))),busy:!!this.controller};}
  cancel(){this.controller?.abort();}
  private async run(input:Record<string,unknown>){
    if(this.controller)throw new Error('Another voice operation is running.');
    const python=join(this.project,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');if(!existsSync(python))throw new Error('Voice Python runtime is missing. Run voice setup from README first.');
    const controller=new AbortController();this.controller=controller;const timer=setTimeout(()=>controller.abort(),input.action==='setup'?1200000:180000);
    try{return await new Promise<any>((resolve,reject)=>{
      const child=spawn(python,[join(this.project,'scripts/voice.py')],{windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_DISABLE_TELEMETRY:'1'}});let output='',errors='';
      child.stdout.on('data',d=>{output+=d.toString();if(output.length>1_000_000)controller.abort();});child.stderr.on('data',d=>{errors=(errors+d.toString()).slice(-2000);});child.stdin.on('error',()=>{});child.on('error',reject);
      controller.signal.addEventListener('abort',()=>{if(child.pid&&process.platform==='win32')execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else child.kill();},{once:true});
      child.once('close',()=>{if(controller.signal.aborted){reject(new Error('Voice operation cancelled or timed out.'));return;}try{const result=JSON.parse(output);if(result.error)throw new Error(result.error);resolve(result);}catch(e){reject(e instanceof SyntaxError?new Error(errors||'Voice worker failed.'):e);}});child.stdin.end(JSON.stringify({...input,models:this.models}));
    });}finally{clearTimeout(timer);this.controller=null;}
  }
  async setup(){await this.run({action:'setup'});return this.status();}
  async transcribe(bytes:Uint8Array){if(bytes.length<100||bytes.length>8_000_000)throw new Error('Recording must be between 100 bytes and 8 MB.');await mkdir(this.temp,{recursive:true});const input=join(this.temp,`${randomUUID()}.webm`);try{await writeFile(input,bytes);const result=await this.run({action:'transcribe',input});return String(result.text);}finally{await unlink(input).catch(()=>{});}}
  async speak(text:string){await mkdir(this.temp,{recursive:true});const output=join(this.temp,`${randomUUID()}.wav`);try{await this.run({action:'speak',text,output});return `data:audio/wav;base64,${(await readFile(output)).toString('base64')}`;}finally{await unlink(output).catch(()=>{});}}
}
