import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { loadSource } from '../scripts/verify-sticker-catalog.mjs';
const cache = new Map();
const engine = loadSource('engine', cache);
const { parseProject } = loadSource('project', cache);
const { BASE_LAYER, DEFAULT_STYLE } = loadSource('types', cache);
const flat = { ...DEFAULT_STYLE, gradient:true, gradientAngle:27, strokeWidth:0, outerWidth:0, shadowX:0, shadowY:0, shadowBlur:0, depth:0, texture:'none', gloss:false };
const box = (x,y,w,h) => [{type:'M',x,y},{type:'L',x:x+w,y},{type:'L',x:x+w,y:y+h},{type:'L',x,y:y+h},{type:'Z'}];
const glyph = (id,x=0) => ({id,char:id,x,y:0,width:80,height:50,commands:box(10,20,80,50),fillRule:'nonzero'});
const layer = () => ({...BASE_LAYER,id:'test',name:'gradient',kind:'path',fontId:'',text:'AB',x:180,y:110,width:300,height:130,glyphs:[glyph('a'),glyph('b',130)],style:{...flat}});
const project = l => ({version:1,name:'gradient',width:400,height:250,layers:[l]});
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

test('legacy frame maps normalized endpoints and radial ellipse from actual whole paths', () => {
  const l=layer(), frame=engine.layerGeometryBounds(l);
  assert.deepEqual(frame,{x:10,y:20,width:210,height:50});
  const g=engine.resolveGradientGeometry(l.style,frame), pixels=engine.gradientGeometryToPixels(g,frame);
  const a=27*Math.PI/180, length=Math.abs(Math.cos(a))*210+Math.abs(Math.sin(a))*50;
  near(pixels.end.x-pixels.start.x,Math.cos(a)*length);near(pixels.end.y-pixels.start.y,Math.sin(a)*length);
  assert.deepEqual(engine.resolveGradientGeometry({...flat,gradientType:'radial'},frame),{type:'radial',center:{x:.5,y:.5},radiusX:.5,radiusY:.5});
});

test('old angle-only source markup is exactly preserved against frozen baseline', () => {
  const source=readFileSync(new URL('../verification/baseline-1.3-for-1.4/src/engine.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};vm.runInThisContext(`(function(module,exports){${compiled}\n})`)(module,module.exports);
  for(const angle of [0,15,90,137,270,360]) for(const type of ['linear','radial']) for(const painted of [false,true]) {
    const l=layer();l.style={...flat,gradientAngle:angle,gradientType:type,material:'jelly',shadowBlur:3,depth:5,opacity:.73};
    if(painted)l.glyphs[0].paint={fill:'primary',stroke:'ink'};
    assert.equal(engine.projectSvg(project(l)),module.exports.projectSvg(project(l)));
  }
});

test('strict geometry and midpoint validation rejects malformed input in parser and renderer', () => {
  for(const geometry of [null,[],{}, {type:'linear',start:{x:0,y:0},end:{x:0,y:0}}, {type:'linear',start:{x:'0',y:0},end:{x:1,y:1}}, {type:'radial',center:{x:.5,y:.5},radiusX:0,radiusY:.5}, {type:'radial',center:{x:.5,y:.5},radiusX:.5,radiusY:-1}]) {
    const l=layer();l.style.gradientGeometry=geometry;
    assert.throws(()=>parseProject(JSON.stringify(project(l))),/渐变/);
    assert.throws(()=>engine.layerSvg(l),/渐变/);
  }
  for(const midpoint of [0,1,-.2,'0.5',null,Infinity]) {
    const l=layer();l.style.gradientStops=[{offset:0,color:'#000000',midpoint},{offset:1,color:'#ffffff'}];
    assert.throws(()=>parseProject(JSON.stringify(project(l))),/渐变/);
    assert.throws(()=>engine.layerSvg(l),/渐变/);
  }
});

test('clone owns geometry, stops, paint, fillRule and sourceGlyphs independently', () => {
  const l=layer();l.style.gradientGeometry={type:'linear',start:{x:0,y:.2},end:{x:1,y:.8}};
  l.style.gradientStops=[{offset:0,color:'#000000',midpoint:.3},{offset:1,color:'#ffffff'}];
  l.glyphs[0].paint={fill:'primary'};l.letterform={presetId:'test',amount:.4,sourceGlyphs:structuredClone(l.glyphs),sourceWidth:300,sourceHeight:130,sourceKind:'path'};
  const copy=engine.cloneLayer(l);copy.style.gradientGeometry.start.x=.2;copy.style.gradientStops[0].midpoint=.7;copy.glyphs[0].paint.fill='#000000';copy.letterform.sourceGlyphs[0].commands[0].x=99;
  assert.equal(l.style.gradientGeometry.start.x,0);assert.equal(l.style.gradientStops[0].midpoint,.3);assert.equal(l.glyphs[0].paint.fill,'primary');assert.equal(l.letterform.sourceGlyphs[0].commands[0].x,10);assert.equal(copy.glyphs[0].fillRule,'nonzero');
});

test('subset API retains full gradient and mixed paint branch, with no unrelated paths', () => {
  const l=layer();l.glyphs[0].paint={fill:'primary'};
  const whole=engine.layerSvg(l), subset=engine.layerSubsetSvg(l,[1],2);
  const gradient=s=>s.match(/<linearGradient[^>]+>[\s\S]*?<\/linearGradient>/)[0];
  assert.equal(gradient(subset),gradient(whole));assert.match(subset,/paint-silhouette/);assert.match(subset,/data-part-id="b"/);assert.doesNotMatch(subset,/data-part-id="a"/);
  assert.throws(()=>engine.layerSubsetSvg(l,[9]),RangeError);assert.equal(engine.layerSubsetSvg(l,[]),'');
});

test('real 1.3 saved projects parse and preserve byte-identical legacy SVG', () => {
  const source=readFileSync(new URL('../verification/baseline-1.3-for-1.4/src/engine.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};vm.runInThisContext(`(function(module,exports){${compiled}\n})`)(module,module.exports);
  for(const file of ['../output/manual-1.3/practice/春日放送-练习.zizao.json','../verification/sample-project.zizao.json']) {
    const p=parseProject(readFileSync(new URL(file,import.meta.url),'utf8'));
    assert.ok(p.layers.some(l=>l.style.gradient && !l.style.gradientGeometry));
    assert.equal(engine.projectSvg(p),module.exports.projectSvg(p),file);
  }
});

test('reverse mirrors outgoing midpoint segments and round-trips exact decimal fields', () => {
  const { reverseGradientStops } = loadSource('gradient',cache);
  const stops=[{offset:0,color:'#FF0000',midpoint:.2},{offset:.45,color:'#00FF00',midpoint:.8},{offset:1,color:'#0000FF'}];
  const expected=[{offset:0,color:'#0000FF',midpoint:.2},{offset:.55,color:'#00FF00',midpoint:.8},{offset:1,color:'#FF0000'}];
  const reversed=reverseGradientStops(stops);
  assert.deepEqual(reversed,expected);
  assert.deepEqual(reverseGradientStops(reversed),stops);
  const l=layer();l.style.gradientStops=reversed;
  const mirror=layer();mirror.style.gradientStops=expected;
  assert.equal(engine.layerSvg(l),engine.layerSvg(mirror));
  l.style.gradientStops=reverseGradientStops(reversed);mirror.style.gradientStops=stops;
  assert.equal(engine.layerSvg(l),engine.layerSvg(mirror));
  for(const midpoint of [.01,.99]) {
    const result=reverseGradientStops([{offset:0,color:'#000000',midpoint},{offset:1,color:'#FFFFFF'}]);
    assert.ok(result[0].midpoint>=.01&&result[0].midpoint<=.99);
    assert.deepEqual(reverseGradientStops(result),[{offset:0,color:'#000000',midpoint},{offset:1,color:'#FFFFFF'}]);
  }
});

test('local handles preserve snap length and numeric bidirectionality', () => {
  const {moveGradientHandle,gradientMetrics,setGradientMetrics,reverseGradientStops}=loadSource('gradient',cache);
  const frame=engine.layerGeometryBounds(layer()), g=engine.resolveGradientGeometry(flat,frame), pixels=engine.gradientGeometryToPixels(g,frame), target={x:190,y:60};
  const patch=moveGradientHandle(flat,frame,'end',target,true), result=engine.gradientGeometryToPixels(patch.gradientGeometry,frame);
  near(Math.hypot(result.end.x-result.start.x,result.end.y-result.start.y),Math.hypot(target.x-pixels.start.x,target.y-pixels.start.y));
  near(gradientMetrics({...flat,...patch},frame).angle%15,0);
  const numeric=setGradientMetrics({...flat,...patch},frame,{angle:135,length:99,centerX:110,centerY:40});
  const metrics=gradientMetrics({...flat,...numeric},frame);near(metrics.angle,135);near(metrics.length,99);near(metrics.center.x,110);near(metrics.center.y,40);
  const radial=moveGradientHandle({...flat,gradientType:'radial'},frame,'radiusX',{x:190,y:88},true), r=engine.gradientGeometryToPixels(radial.gradientGeometry,frame);
  near(r.rotation%15,0);near(r.radiusX,Math.hypot(190-115,88-45));
  const stops=[{offset:0,color:'#000000',midpoint:.25},{offset:.3,color:'#888888',midpoint:.7},{offset:1,color:'#ffffff'}];
  const rev=reverseGradientStops(stops);near(rev[0].midpoint,.3);near(rev[1].midpoint,.75);
  const roundtrip=parseProject(JSON.stringify(project({...layer(),style:{...flat,...numeric,gradientStops:stops}})));
  assert.deepEqual(roundtrip.layers[0].style.gradientGeometry,numeric.gradientGeometry);assert.deepEqual(roundtrip.layers[0].style.gradientStops,stops);
});
