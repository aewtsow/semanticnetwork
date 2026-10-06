'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const C=require('./semantic-core.js'),Graph=require('./vendor/graphology.min.js').UndirectedGraph;
global.DOMParser=class {};global.Document=class {};
const L=require('./vendor/graphology-library.min.js');
delete global.DOMParser;delete global.Document;
const rgb=p=>C.encoding(1,p,.5).edgeColor.match(/\d+/g).map(Number);
const probes=[-Number.MAX_VALUE,-30,-3,0,3,5,7,10,16,30,Number.MAX_VALUE];
for(let i=1;i<probes.length;i++)assert.ok(rgb(probes[i]).every((v,k)=>v<=rgb(probes[i-1])[k]));
assert.deepEqual(rgb(-Number.MAX_VALUE),[255,255,255]);
assert.deepEqual(rgb(Number.MAX_VALUE),[27,70,48]);
assert.deepEqual(rgb(0),[254,254,254]);
assert.deepEqual(rgb(3),[239,242,240]);
assert.deepEqual(rgb(5),[198,209,203]);
assert.deepEqual(rgb(null),[153,169,160]);
assert.notDeepEqual(rgb(null),rgb(0));
const sample=[10,0,null,3,10,-4,5].map((pmi,i)=>({key:String(i),pmi,...C.encoding(i,pmi,.5)}));
const original=[...sample],order=C.paintOrder(sample),brightness=e=>{const [r,g,b]=e.edgeColor.match(/\d+/g).map(Number);return r*.2126+g*.7152+b*.0722;};
assert.deepEqual(sample,original);assert.equal(new Set(order).size,sample.length);
assert.ok(order.every(e=>sample.includes(e)));assert.deepEqual(C.paintOrder([]),[]);
for(let i=1;i<order.length;i++)assert.ok(brightness(order[i])<=brightness(order[i-1]));
// Reconstruct the previous color expression, keeping every model operation
// identical, then assert equality of all non-color fields including coordinates.
const source=fs.readFileSync('semantic-core.js','utf8');
const oldColor="'rgb('+[0,1,2].map(i=>Math.round([232,237,234][i]+([27,70,48][i]-[232,237,234][i])*tone)).join(',')+')'";
const newColor="'rgb('+[27,70,48].map(v=>Math.round(255+(v-255)*tone**2)).join(',')+')'";
assert.ok(source.includes(newColor));
const previousScope={module:{exports:{}}};vm.runInNewContext(source.replace(newColor,oldColor),previousScope);
const previous=previousScope.module.exports,scope={window:{}};
for(const file of ['word_network_nodes','classifier_noun_data'])vm.runInNewContext(fs.readFileSync('data/'+file+'.js','utf8'),scope);
const nodes=scope.window.WORD_NETWORK_NODES,pairs=C.pairsIndex(nodes,scope.window.CLASSIFIER_NOUN_DATA);
const manifest=JSON.parse(fs.readFileSync('data/semantic_v2/manifest.json'));manifest.zeroSet=new Set(manifest.zeroRows);
const row=i=>{const b=fs.readFileSync('data/semantic_v2/rows/'+i+'.bin');const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);return{sim:new Float64Array(ab,0,nodes.length),co:new Float64Array(ab,nodes.length*8)};};
const cfg={co:0,pmi:null,similarity:0,includeZero:true,allEdges:false,resolution:1,degree:0};
const strip=graph=>JSON.parse(JSON.stringify(graph,(k,v)=>k==='edgeColor'?undefined:v));
const reports=[];
for(const word of ['一棵','树','客厅']){
  const center=nodes.findIndex(n=>n.id===word),r=row(center);
  for(const mode of nodes[center].type==='classifier'?['classifier','noun','word']:['noun','word']){
    const all=C.candidates(center,mode,r,nodes,pairs,manifest,cfg);
    for(const limit of word==='客厅'&&mode==='word'?[50,200,400]:[50]){
      const selected=all.slice(0,limit),rows=new Map(selected.map(e=>[e.neighbor,row(e.neighbor)]));
      for(const allEdges of [false,true]){
        const config={...cfg,limit,allEdges};
        const a=C.construct(center,selected,all,rows,nodes,pairs,manifest,config,Graph,L.communitiesLouvain);
        const b=previous.construct(center,selected,all,rows,nodes,pairs,manifest,config,Graph,L.communitiesLouvain);
        C.layout(a);previous.layout(b);assert.deepEqual(strip(a),strip(b),word+'/'+mode+'/'+limit+'/'+allEdges);
        const started=performance.now(),paint=C.paintOrder(a.edges),paintOrderMs=performance.now()-started;
        assert.equal(paint.length,a.edges.length);
        for(let i=1;i<paint.length;i++)assert.ok(brightness(paint[i])<=brightness(paint[i-1]));
        reports.push({word,mode,limit,allEdges,nodes:a.nodes.length,edges:a.edges.length,modelAndLayoutUnchanged:true,paintOrderMs});
      }
    }
  }
}
fs.writeFileSync('test_artifacts/semantic_v2/pmi-fade-audit.json',JSON.stringify({curve:'sigmoid((PMI-5)/2)^2',colors:probes.map(p=>({pmi:p,rgb:rgb(p)})),reports},null,2));
console.log('PMI fade checks passed: '+reports.length+' exact old/new model and layout comparisons; light-to-dark painting; zero/missing/extreme values.');
console.log('Largest one-off paint ordering time: '+Math.max(...reports.map(r=>r.paintOrderMs)).toFixed(2)+' ms');
