import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as http } from 'node:http';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
test('painted SVG PNG PSD and layer ZIP preserve the same pixels and transparency', { timeout: 90000 }, async () => {
  const listener = http();
  const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: 'node_modules/.vite-sticker-paint-verification', server: { middlewareMode: true, hmr: { server: listener } }, optimizeDeps: { include: ['ag-psd','fflate'], entries: [] } });
  server.middlewares.use('/__paint-test', (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body></body></html>'); });
  listener.on('request', server.middlewares);
  let browser;
  try {
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
    const executablePath = process.env.BROWSER_PATH || [chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${listener.address().port}/__paint-test`);
    await page.addScriptTag({ path: path.join(root, 'node_modules/ag-psd/dist/bundle.js') });
    const result = await page.evaluate(async () => {
      const engine = await import('/src/engine.ts');
      const { exportPsd } = await import('/src/psd.ts');
      const { exportLayerPngs } = await import('/src/layer-actions.ts');
      const { BASE_LAYER, DEFAULT_STYLE } = await import('/src/types.ts');
      const curve = [{ type:'M',x:12,y:15 },{type:'C',x1:40,y1:-8,x2:91,y2:7,x:94,y:49},{type:'C',x1:108,y1:90,x2:45,y2:114,x:16,y:83},{type:'Q',x1:-6,y1:51,x:12,y:15},{type:'Z'}];
      const ellipse = [{type:'M',x:22,y:35},{type:'C',x1:27,y1:24,x2:53,y2:28,x:52,y:38},{type:'C',x1:52,y1:47,x2:23,y2:48,x:22,y:35},{type:'Z'}];
      const l = { ...BASE_LAYER, id:'color-proof',name:'彩色部件',kind:'sticker',text:'',fontId:'',x:142.37,y:130.81,width:105,height:105,rotation:13,scaleX:0.87,scaleY:1.08,style:{...DEFAULT_STYLE,gradient:false,fill:'#f8a7cc',fill2:'#ffdda0',stroke:'#8c5898',strokeWidth:4,outerStroke:'#fffaf2',outerWidth:7,depth:4,depthColor:'#b17dba',shadowX:1,shadowY:2,shadowBlur:0.7,texture:'none',gloss:false,opacity:0.73},glyphs:[{id:'body',char:'',x:0,y:0,width:105,height:105,commands:curve,paint:{fill:'primary',stroke:'ink'}},{id:'highlight',char:'',x:0,y:0,width:105,height:105,commands:ellipse,paint:{fill:'paper',strokeWidth:0,silhouette:false}}]};
      const p = {version:1,name:'分色导出',width:300,height:280,layers:[l]};
      const bytes = blob => new Promise(resolve => { const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(blob); });
      const pixels = async blob => { const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return c.getContext('2d').getImageData(0,0,c.width,c.height); };
      const results=[];
      for(const material of ['none','metal','jelly']) for(const crop of [false,true]) {
        l.style.material=material;l.style.materialStrength=0.75;
        const opts={scale:crop?1.35:1,crop,padding:9};
        const png=await engine.exportPng(p,opts), expected=await pixels(png);
        const psd=window.agPsd.readPsd(await(await exportPsd(p,opts)).arrayBuffer(),{useImageData:true,skipThumbnail:true});
        const c=document.createElement('canvas');c.width=psd.width;c.height=psd.height;
        const child=psd.children[0],part=document.createElement('canvas');part.width=child.imageData.width;part.height=child.imageData.height;part.getContext('2d').putImageData(child.imageData,0,0);c.getContext('2d').drawImage(part,child.left,child.top);
        const actual=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let alpha=0,rgb=0,transparent=0,filled=0;
        for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected.data[i+3]));for(let k=0;k<3;k++)rgb=Math.max(rgb,Math.abs(actual[i+k]*actual[i+3]/255-expected.data[i+k]*expected.data[i+3]/255));if(expected.data[i+3]===0)transparent++;else filled++;}
        results.push({material,crop,alpha,rgb,transparent,filled,width:expected.width,height:expected.height,psdWidth:psd.width,psdHeight:psd.height,png:await bytes(png),zip:await bytes(await exportLayerPngs(p,opts))});
      }
      return results;
    });
    assert.deepEqual(errors, []);
    for (const row of result) {
      assert.equal(row.width, row.psdWidth); assert.equal(row.height, row.psdHeight);
      assert.equal(row.alpha, 0, `${row.material}/${row.crop} PSD alpha`);
      assert.ok(row.rgb <= 1.1, `${row.material}/${row.crop} PSD premultiplied RGB ${row.rgb}`);
      assert.ok(row.transparent > 1000 && row.filled > 1000);
      const files = Object.values(unzipSync(Buffer.from(row.zip, 'base64')));
      assert.equal(files.length, 1);
      const png = await sharp(Buffer.from(row.png, 'base64')).ensureAlpha().raw().toBuffer();
      assert.deepEqual(await sharp(Buffer.from(files[0])).ensureAlpha().raw().toBuffer(), png, `${row.material}/${row.crop} layer PNG ZIP`);
      console.log(`paint ${row.material}/${row.crop ? 'crop' : 'canvas'}: ${row.width}x${row.height}, PSD alpha delta=${row.alpha}, ZIP PNG exact`);
    }
  } finally {
    await browser?.close();
    await server.close();
    await new Promise(resolve => listener.close(resolve));
  }
});
