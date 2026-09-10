import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('task UI gates writes, persists evidence and recovers pending approvals without replay',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'nix-task-ui-')); const workspace=join(folder,'work');
  const {mkdirSync}=await import('node:fs');mkdirSync(workspace);
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'local:8b'}]}));return;}
    let body='';req.on('data',d=>{body+=d;});req.on('end',()=>{
      const input=JSON.parse(body);const last=input.messages.at(-1);
      const response=last.role==='tool'?{content:'The tool returned evidence. Review the output before accepting.'}:{content:'I propose creating the requested file.',tool_calls:[{function:{name:'files_write',arguments:{path:'proof.txt',content:'VERIFIED_TASK_WRITE'}}}]};
      res.end(JSON.stringify({message:response,done:true}));
    });
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),NIX_USER_DATA:join(folder,'data'),NIX_OLLAMA_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}`};delete env.ELECTRON_RUN_AS_NODE;
  let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
  try{
    app=await electron.launch({args:['.'],env});let page=await app.firstWindow();
    await expect(page.getByText('Ollama connected')).toBeVisible();await page.screenshot({path:'test-results/nix-home.png'});
    await page.getByLabel('Model',{exact:true}).selectOption('local:8b');await page.getByRole('button',{name:'⌘ Tasks',exact:true}).click();
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);
    await page.getByRole('button',{name:'Choose workspace',exact:true}).click();await expect(page.getByText(workspace,{exact:true})).toBeVisible();
    await page.getByLabel('Task goal').fill('Create proof.txt');await page.getByRole('button',{name:'Run task ↗'}).click();
    await expect(page.getByRole('dialog')).toBeVisible();expect(existsSync(join(workspace,'proof.txt'))).toBe(false);
    await page.screenshot({path:'test-results/nix-approval.png'});await page.getByRole('button',{name:'Deny',exact:true}).click();
    await expect(page.getByRole('button',{name:'Accept reviewed result'})).toBeVisible();expect(existsSync(join(workspace,'proof.txt'))).toBe(false);
    await page.getByLabel('Task goal').fill('Create proof with approval');await page.getByRole('button',{name:'Run task ↗'}).click();await page.getByRole('button',{name:'Allow once',exact:true}).click();
    await expect(page.getByRole('button',{name:'Accept reviewed result'})).toBeVisible();expect(readFileSync(join(workspace,'proof.txt'),'utf8')).toBe('VERIFIED_TASK_WRITE');
    await page.screenshot({path:'test-results/nix-task-evidence.png'});await page.getByRole('button',{name:'Accept reviewed result'}).click();
    await page.getByLabel('Task goal').fill('A task interrupted before approval');await page.getByRole('button',{name:'Run task ↗'}).click();await expect(page.getByRole('dialog')).toBeVisible();
    const {execFile}=await import('node:child_process'); const pid=app.process().pid!;
    await new Promise<void>((resolve,reject)=>execFile('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true},error=>error?reject(error):resolve()));app=undefined;
    app=await electron.launch({args:['.'],env});page=await app.firstWindow();await page.getByRole('button',{name:'⌘ Tasks',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.run-meta .status')).toHaveText('interrupted');
    expect(readFileSync(join(workspace,'proof.txt'),'utf8')).toBe('VERIFIED_TASK_WRITE');await expect(page.getByRole('button',{name:'Resume with checkpoint'})).toBeVisible();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,580));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }finally{await app?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
