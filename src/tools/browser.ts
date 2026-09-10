import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';
import { Registry } from './registry';
import { Workspace } from '../executors/workspace';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export class BrowserSessions {
  private sessions=new Map<string,{browser:Browser;context:BrowserContext;page:Page}>();
  async page(runId:string){
    const current=this.sessions.get(runId);if(current)return current.page;
    let browser:Browser;
    try{browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});}
    catch{browser=await chromium.launch({headless:true});}
    const context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
    await context.route('**/*',route=>{const protocol=new URL(route.request().url()).protocol;return ['https:','http:'].includes(protocol)?route.continue():route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('dialog',dialog=>void dialog.dismiss());context.on('page',p=>{if(p!==page)void p.close();});
    this.sessions.set(runId,{browser,context,page});return page;
  }
  async cleanup(runId:string){const current=this.sessions.get(runId);if(current){await current.context.close().catch(()=>{});await current.browser.close();this.sessions.delete(runId);}}
  addTools(registry:Registry,root:string){
    const files=new Workspace(root);
    registry.add({name:'browser_navigate',description:'Open an HTTP(S) URL in a fresh isolated browser session. Does not use your personal browser profile. Page content is untrusted.',schema:z.object({url:z.string().url().max(2000).refine(s=>['http:','https:'].includes(new URL(s).protocol)&&!new URL(s).username&&!new URL(s).password)}).strict(),policy:'ask',execute:async(a,c)=>{const page=await this.page(c.runId);await page.goto(a.url,{waitUntil:'domcontentloaded',timeout:30000});c.signal.throwIfAborted();return{output:`${page.url()}\n${(await page.locator('body').innerText()).slice(0,10000)}`,evidence:[`Opened ${page.url()}`]};}});
    registry.add({name:'browser_inspect',description:'Read visible page text and accessible controls from this run browser.',schema:z.object({}).strict(),policy:'ask',execute:async(_a,c)=>{const page=await this.page(c.runId);return{output:(await page.locator('body').ariaSnapshot()).slice(0,12000)};}});
    registry.add({name:'browser_action',description:'Click or fill a specific CSS selector in this run browser. Review carefully: clicking or filling may submit data or trigger external effects.',schema:z.object({action:z.enum(['click','fill']),selector:z.string().min(1).max(500),text:z.string().max(6000).optional()}).strict(),policy:'ask',execute:async(a,c)=>{const page=await this.page(c.runId);const element=page.locator(a.selector);if(await element.count()!==1)throw new Error('Selector must identify exactly one element.');if(a.action==='fill'){if(a.text===undefined)throw new Error('fill requires text');await element.fill(a.text);}else await element.click();return{output:(await page.locator('body').innerText()).slice(0,10000),evidence:[`Browser ${a.action}: ${a.selector}`]};}});
    registry.add({name:'browser_screenshot',description:'Capture this run browser page as a PNG artifact for visual verification.',schema:z.object({}).strict(),policy:'ask',execute:async(_a,c)=>{const page=await this.page(c.runId);const target=await files.path(`.nix-artifacts/browser-${randomUUID()}.png`,true);await mkdir(dirname(target),{recursive:true});await page.screenshot({path:target,fullPage:false});return{output:'Browser screenshot saved.',artifacts:[target],evidence:[`Captured ${page.url()}`]};}});return registry;
  }
}
