'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const C=require('./semantic-core.js'),Graph=require('./vendor/graphology.min.js').UndirectedGraph;
global.DOMParser=class {};global.Document=class {};
const L=require('./vendor/graphology-library.min.js');
delete global.DOMParser;delete global.Document;
const edge=(a,b,s)=>({key:C.pairKey(a,b),source:a,target:b,similarity:s});
const custom=(threshold,k)=>({peripheralMode:'custom',peripheralSimilarity:threshold,peripheralTopK:k});
const sample=[edge(1,2,.9),edge(1,3,.85),edge(1,4,.8),edge(2,3,.81),edge(3,4,.2),edge(2,4,null)];
assert.deepEqual(C.peripheralDisplay(sample,custom(.8,1)).map(e=>e.key),['1|2','1|3']);
// Both leaf nodes choose the hub: union can exceed X at the hub.
assert.equal(C.peripheralDisplay(sample,custom(.8,1)).filter(e=>e.source===1).length,2);
assert.deepEqual(C.peripheralDisplay(sample,custom(1,400)),[]);
assert.deepEqual(C.peripheralDisplay(sample,custom(.8,400)).map(e=>e.key),['1|2','1|3','2|3']);
assert.deepEqual(C.peripheralDisplay(sample,{allEdges:true}),sample);
assert.deepEqual(C.peripheralDisplay(sample,{}),C.sparsify(sample,8));
for(const [t,k] of [[-.1,8],[1.1,8],[NaN,8],[.8,0],[.8,1.5],[.8,401]])assert.throws(()=>C.peripheralDisplay(sample,custom(t,k)));
const scope={window:{}};
for(const file of ['word_network_nodes','classifier_noun_data'])vm.runInNewContext(fs.readFileSync('data/'+file+'.js','utf8'),scope);
const nodes=scope.window.WORD_NETWORK_NODES,pairs=C.pairsIndex(nodes,scope.window.CLASSIFIER_NOUN_DATA);
const manifest=JSON.parse(fs.readFileSync('data/semantic_v2/manifest.json'));manifest.zeroSet=new Set(manifest.zeroRows);
const row=i=>{const b=fs.readFileSync('data/semantic_v2/rows/'+i+'.bin');const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);return{sim:new Float64Array(ab,0,nodes.length),co:new Float64Array(ab,nodes.length*8)};};
const cfg={co:0,pmi:null,similarity:0,includeZero:true,allEdges:false,resolution:1,degree:0};
const reports=[];
for(const word of ['一棵','树','客厅']){
  const center=nodes.findIndex(n=>n.id===word),r=row(center);
  for(const mode of nodes[center].type==='classifier'?['classifier','noun','word']:['noun','word']){
    const all=C.candidates(center,mode,r,nodes,pairs,manifest,cfg),selected=all.slice(0,50);
    const rows=new Map(selected.map(e=>[e.neighbor,row(e.neighbor)]));
    const make=config=>C.construct(center,selected,all,rows,nodes,pairs,manifest,config,Graph,L.communitiesLouvain);
    const baseline=make(cfg),full=make({...cfg,allEdges:true});
    C.layout(baseline);C.layout(full);
    for(const config of [custom(.8,8),custom(.2,1),custom(1,400)]){
      const graph=make({...cfg,...config});C.layout(graph);
      assert.deepEqual(graph.nodes.map(({visibleDegree,...n})=>n),baseline.nodes.map(({visibleDegree,...n})=>n));
      assert.deepEqual(graph.community,baseline.community);
      assert.deepEqual(graph.layoutEdges,baseline.layoutEdges);
      assert.deepEqual(graph.edges.filter(e=>e.source===center||e.target===center),baseline.edges.filter(e=>e.source===center||e.target===center));
      const peripheral=full.edges.filter(e=>e.source!==center&&e.target!==center);
      assert.deepEqual(graph.edges.filter(e=>e.source!==center&&e.target!==center).map(e=>e.key),C.peripheralDisplay(peripheral,config).map(e=>e.key));
      assert.equal(graph.peripheralCount,baseline.peripheralCount);
      reports.push({word,mode,threshold:config.peripheralSimilarity,topK:config.peripheralTopK,nodes:graph.nodes.length,peripheral:graph.visiblePeripheralCount,modelAndLayoutPreserved:true});
    }
  }
}
fs.writeFileSync('test_artifacts/semantic_v2/peripheral-display-audit.json',JSON.stringify({date:'2026-10-07',strictThreshold:true,filterBeforeTopK:true,cases:reports},null,2));
console.log('Peripheral display passed: strict boundary, missing values, union semantics, validation, '+reports.length+' graph/cluster/layout comparisons across all three modes.');
