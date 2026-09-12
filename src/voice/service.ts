import { spawn,execFile } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir,writeFile,readFile,unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFileCb);

export class VoiceService{
  private controller:AbortController|null=null;
  private userVenv:string|null=null;
  private voiceScript:string;
  constructor(private project:string,private models:string,private temp:string){
    // The voice.py script always lives in the source project
    this.voiceScript=join(project,'scripts','voice.py');
  }

  /** Find or create a user-local Python venv for voice operations. */
  private async ensureUserVenv():Promise<string>{
    if(this.userVenv && existsSync(this.userVenv)) return this.userVenv;
    // User-local venv lives next to models dir: <models>/../voice-env/
    const venvDir=join(this.models,'..','voice-env');
    const pythonPath=join(venvDir,'Scripts','python.exe');
    if(existsSync(pythonPath)){
      this.userVenv=pythonPath;
      return this.userVenv;
    }
    // Create venv
    mkdirSync(venvDir,{recursive:true});
    // Find system Python
    const sysPython=await this.findSystemPython();
    await execFileAsync(sysPython,['-m','venv',venvDir],{timeout:30000});
    // Install edge-tts
    await execFileAsync(pythonPath,['-m','pip','install','edge-tts','--quiet','--disable-pip-version-check'],{timeout:120000});
    this.userVenv=pythonPath;
    return this.userVenv;
  }

  /** Find a working system Python to create venvs with. */
  private async findSystemPython():Promise<string>{
    const candidates=['python','python3','py -3'];
    for(const c of candidates){
      try{
        const exe=c.startsWith('py ')?'py':c;
        const args=c.startsWith('py ')?['-3','--version']:['--version'];
        await execFileAsync(exe,args,{timeout:5000});
        return exe;
      }catch{}
    }
    throw new Error('Python not found. Install Python 3.9+ from https://www.python.org/downloads/');
  }

  status(){return {ready:['whisper-small/model.bin','kokoro-v1.0.onnx','voices-v1.0.bin'].every(p=>existsSync(join(this.models,p))),busy:!!this.controller};}
  cancel(){this.controller?.abort();}
  private async run(input:Record<string,unknown>){
    if(this.controller)throw new Error('Another voice operation is running.');
    // Ensure user-local venv exists for voice operations (auto-creates on first use)
    if(!this.userVenv) await this.ensureUserVenv();
    const controller=new AbortController();this.controller=controller;const timer=setTimeout(()=>controller.abort(),input.action==='setup'?1200000:300000);
    try{return await new Promise<any>((resolve,reject)=>{
      const python=this.userVenv!;
      if(!existsSync(python)){reject(new Error('Voice Python runtime is missing.'));return;}
      const child=spawn(python,[this.voiceScript],{windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_DISABLE_TELEMETRY:'1'}});let output='',errors='';
      child.stdout.on('data',d=>{output+=d.toString();if(output.length>1_000_000)controller.abort();});child.stderr.on('data',d=>{errors=(errors+d.toString()).slice(-2000);});child.stdin.on('error',()=>{});child.on('error',reject);
      controller.signal.addEventListener('abort',()=>{if(child.pid&&process.platform==='win32')execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else child.kill();},{once:true});
      child.once('close',()=>{if(controller.signal.aborted){reject(new Error('Voice operation cancelled or timed out.'));return;}try{const result=JSON.parse(output);if(result.error)throw new Error(result.error);resolve(result);}catch(e){reject(e instanceof SyntaxError?new Error(errors||'Voice worker failed.'):e);}});child.stdin.end(JSON.stringify({...input,models:this.models}));
    });}finally{clearTimeout(timer);this.controller=null;}
  }
  async setup(){await this.ensureUserVenv();await this.run({action:'setup'});return this.status();}
  async transcribe(bytes:Uint8Array){if(bytes.length<100||bytes.length>8_000_000)throw new Error('Recording must be between 100 bytes and 8 MB.');await mkdir(this.temp,{recursive:true});const input=join(this.temp,`${randomUUID()}.webm`);try{await writeFile(input,bytes);const result=await this.run({action:'transcribe',input});return String(result.text);}finally{await unlink(input).catch(()=>{});}}
  async speak(text:string,voiceProfile?:string,voicePreset?:string){await mkdir(this.temp,{recursive:true});const output=join(this.temp,`${randomUUID()}.mp3`);try{await this.run({action:'speak',text,output,voiceProfile:voiceProfile||undefined,voicePreset:voicePreset||undefined});return `data:audio/mp3;base64,${(await readFile(output)).toString('base64')}`;}finally{await unlink(output).catch(()=>{});}}
  async speakToMp3(texts:string[],outputPath:string,voiceProfile?:string,voicePreset?:string){await mkdir(this.temp,{recursive:true});await this.run({action:'speak_mp3',texts,output:outputPath,voiceProfile:voiceProfile||undefined,voicePreset:voicePreset||undefined});return outputPath;}
  async setupXtts(){return this.run({action:'setup_xtts'});}
  async trainVoice(refAudioPath:string,voiceId:string,voiceName:string){return this.run({action:'train_voice',refAudio:refAudioPath,voiceId,voiceName});}
  async listVoices(){return this.run({action:'list_voices'});}
  async deleteVoice(voiceId:string){return this.run({action:'delete_voice',voiceId});}
}
