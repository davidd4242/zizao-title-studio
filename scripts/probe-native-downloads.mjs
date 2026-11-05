import { launchPortable } from '../tests/portable-driver.mjs';
import { mkdir, stat, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'verification', 'desktop', `download-probe-${Date.now()}`);
await mkdir(out, {recursive:true});
const env = {...process.env};
for (const key of Object.keys(env)) if (/^(path|node_path|node_options|electron_run_as_node)$/i.test(key)) delete env[key];
env.Path = `${process.env.SystemRoot}/System32;${process.env.SystemRoot}`;
const desktop = await launchPortable({executablePath:path.join(root,'release','字造-1.1.0-离线版-x64.exe'), args:['--smoke-test', `--user-data-dir=${path.join(out,'profile')}`], env, timeout:90000});
const results=[];
try {
  const page=await desktop.firstWindow();
  await page.waitForURL('zizao://studio/');
  await page.waitForFunction(()=>document.querySelector('[data-testid="state-marker"]')?.dataset.loading==='false',null,{timeout:90000});
  console.log('HOST_DIRECTORY',out);
  console.log('MAIN_DIRECTORY',JSON.stringify(await desktop.evaluate((_electron,out)=>{const fs=process.mainModule.require('node:fs'); return {out,exists:fs.existsSync(out),realpath:fs.realpathSync(out)};},out)));
  for(const type of ['png','psd']) {
    const destination=path.join(out,`fresh-title.${type}`);
    await desktop.evaluate(({session},{destination,type})=>{
      const fs=process.mainModule.require('node:fs');
      const receipt={type,destination,state:'waiting'}; globalThis.__probe=receipt;
      session.defaultSession.once('will-download',(_event,item)=>{
        item.setSavePath(destination); receipt.state='started'; receipt.filename=item.getFilename(); receipt.savePath=item.getSavePath();
        item.once('done',(_event,state)=>{receipt.state=state; receipt.savePath=item.getSavePath(); receipt.received=item.getReceivedBytes();
          try {const s=fs.statSync(destination);receipt.disk={size:s.size,mtimeMs:s.mtimeMs};}catch(error){receipt.disk={error:error.code};}
        });
      });
    },{destination,type});
    await page.getByRole('button',{name:'导出标题',exact:true}).click();
    await page.getByLabel('输出精度',{exact:true}).selectOption('1');
    await page.getByTestId(type==='png'?'download-png':'download-psd').click();
    let receipt; const deadline=Date.now()+30000;
    while(Date.now()<deadline){receipt=await desktop.evaluate(()=>globalThis.__probe);if(receipt.state!=='waiting'&&receipt.state!=='started') break;await page.waitForTimeout(100);}
    const hostDisk=await stat(destination).then(s=>({size:s.size,mtimeMs:s.mtimeMs}),e=>({error:e.code}));
    const mainDisk=await desktop.evaluate((_electron,destination)=>{const fs=process.mainModule.require('node:fs');try{const s=fs.statSync(destination);return {size:s.size,mtimeMs:s.mtimeMs};}catch(e){return {error:e.code};}},destination);
    const record={receipt,hostDisk,mainDisk,files:await readdir(out)};
    results.push(record);console.log('DOWNLOAD_PROBE',JSON.stringify(record));
  }
}finally {await writeFile(path.join(out,'results.json'),JSON.stringify({out,results},null,2));await desktop.close();}
