import * as engine from '/src/engine.ts';
import * as baseline from '/verification/baseline-1.3-for-1.4/src/engine.ts';
import { parseProject } from '/src/project.ts';
import { BASE_LAYER, DEFAULT_STYLE } from '/src/types.ts';
import { gradientHandlePoint, gradientMetrics } from '/src/gradient.ts';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Canvas from '/src/Canvas.tsx';
export { engine, parseProject };
export const layerDocument = project => `<svg xmlns="http://www.w3.org/2000/svg" width="${project.width}" height="${project.height}" viewBox="0 0 ${project.width} ${project.height}">${engine.layerSvg(project.layers.at(-1))}</svg>`;
export async function mirroredHandleCheck() {
  const project=makeFixture();project.layers[0].scaleX=-1.2;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try { flushSync(()=>root.render(createElement(Canvas,{project,selectedId:project.layers[0].id,setSelectedId(){},mode:'gradient',glyphIndex:0,setGlyphIndex(){},node:null,setNode(){},zoom:1,onDraft(){},onCommit(){},checker:false,referenceVisible:false})));return handleSnapshot(project); }
  finally { root.unmount();host.remove(); }
}

export function makeFixture() {
  const box=(x,y,w,h)=>[{type:'M',x,y},{type:'L',x:x+w,y},{type:'L',x:x+w,y:y+h},{type:'L',x,y:y+h},{type:'Z'}];
  const glyph=(id,x)=>({id,char:id,x,y:0,width:100,height:80,commands:box(20,10,100,80)});
  const style={...DEFAULT_STYLE,fill:'#ff3481',fill2:'#15b6fb',gradientType:'linear',gradientAngle:27,gradientStops:[{offset:0,color:'#ff3481'},{offset:.45,color:'#ffc644'},{offset:1,color:'#15b6fb'}],strokeWidth:0,outerWidth:0,shadowBlur:0,shadowX:0,shadowY:0,depth:0,texture:'none',gloss:false};
  return {version:1,name:'Gradient verification',width:800,height:500,layers:[{...BASE_LAYER,id:'gradient-text',name:'AB',kind:'text',fontId:'fixture-existing-paths',text:'AB',width:300,height:120,x:400,y:250,rotation:23,scaleX:1.2,scaleY:.85,glyphs:[glyph('A',0),glyph('B',140)],style}]};
}
export async function pixels(svg) {
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})), image=new Image();
  try { image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data}; }
  finally { URL.revokeObjectURL(url); }
}
export function difference(a,b) {
  if(a.width!==b.width||a.height!==b.height)throw new Error('Raster dimensions differ');
  let maxAlpha=0,maxPremultiplied=0,differentPixels=0;
  for(let i=0;i<a.data.length;i+=4){let changed=false;const alpha=Math.abs(a.data[i+3]-b.data[i+3]);maxAlpha=Math.max(maxAlpha,alpha);changed=alpha!==0;for(let c=0;c<3;c++){const delta=Math.abs(a.data[i+c]*a.data[i+3]/255-b.data[i+c]*b.data[i+3]/255);maxPremultiplied=Math.max(maxPremultiplied,delta);changed ||= delta!==0;}if(changed)differentPixels++;}
  return {maxAlpha,maxPremultiplied,differentPixels};
}
export async function pixelChecks(oldDocuments) {
  const result={legacy:[],mapping:[],changed:[]};
  for(const {file,text} of oldDocuments){const p=parseProject(text),a=baseline.projectSvg(p),b=engine.projectSvg(p);result.legacy.push({file,svgExact:a===b,...difference(await pixels(a),await pixels(b))});}
  const base=makeFixture();
  for(const scenario of ['horizontal','vertical','rotated','unequal','mirrored','painted']) for(const type of ['linear','radial']){
    const p=structuredClone(base),l=p.layers[0];l.rotation=0;l.scaleX=1;l.scaleY=1;l.style.gradientType=type;
    if(scenario==='vertical'){l.glyphs[1].x=0;l.glyphs[1].y=120;l.width=140;l.height=210;}
    if(scenario==='rotated')l.rotation=41;
    if(scenario==='unequal'){l.scaleX=1.7;l.scaleY=.6;}
    if(scenario==='mirrored'){l.scaleX=-1.2;l.scaleY=.85;l.rotation=23;}
    if(scenario==='painted'){l.glyphs[0].paint={fill:'primary',stroke:'ink',strokeWidth:2};l.glyphs[1].paint={fill:'primary',opacity:.8};}
    const legacy=engine.projectSvg(p);l.style.gradientGeometry=engine.resolveGradientGeometry(l.style,engine.layerGeometryBounds(l));
    result.mapping.push({scenario,type,...difference(await pixels(legacy),await pixels(engine.projectSvg(p)))});
    const before=await pixels(engine.projectSvg(p));
    if(type==='linear'){l.style.gradientGeometry.start.x+=.22;l.style.gradientGeometry.end.y+=.37;}
    else {l.style.gradientGeometry.radiusX*=.55;l.style.gradientGeometry.radiusY*=.7;l.style.gradientGeometry.center.x=.35;}
    result.changed.push({scenario,type,...difference(before,await pixels(engine.projectSvg(p)))});
  }
  const p=makeFixture(),l=p.layers[0],before=await pixels(engine.projectSvg(p));l.style.gradientAngle+=60;
  result.changed.push({scenario:'angle-only',type:'linear',...difference(before,await pixels(engine.projectSvg(p)))});
  l.style.gradientStops[0].midpoint=.2;result.changed.push({scenario:'midpoint',type:'linear',...difference(before,await pixels(engine.projectSvg(p)))});
  return result;
}
export function handleSnapshot(project) {
  const layer=project.layers.at(-1),frame=engine.layerGeometryBounds(layer),geometry=engine.gradientGeometryToPixels(engine.resolveGradientGeometry(layer.style,frame),frame);
  return {frame,geometry,metrics:gradientMetrics(layer.style,frame),handles:[...document.querySelectorAll('[data-testid^="gradient-handle-"]')].map(node=>{
    const handle=node.dataset.testid.slice('gradient-handle-'.length),expected=gradientHandlePoint(geometry,handle),rect=node.getBoundingClientRect(),matrix=node.getScreenCTM(),screen=new DOMPoint(expected.x,expected.y).matrixTransform(matrix);
    return {handle,expected,cx:Number(node.getAttribute('cx')),cy:Number(node.getAttribute('cy')),screen,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},focusable:node.tabIndex===0};
  })};
}
