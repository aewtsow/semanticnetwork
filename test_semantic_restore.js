'use strict';
const assert=require('assert/strict'),C=require('./semantic-core.js'),M=require('./semantic-motion.js');
const Graph=require('./vendor/graphology.min.js').UndirectedGraph;
global.DOMParser=class {};global.Document=class {};
const L=require('./vendor/graphology-library.min.js');
delete global.DOMParser;delete global.Document;
const cfg={co:0,pmi:null,similarity:0,includeZero:true,allEdges:false,resolution:1};
const ramp=[-3,0,3,6,9,12,16].map(p=>C.encoding(10,p,.5).edgeColor.match(/\d+/g).map(Number));
for(let i=1;i<ramp.length;i++)assert.ok(ramp[i].every((v,j)=>v<ramp[i-1][j]));
assert.ok(ramp[2][0]-ramp[5][0]>110,'Common positive PMI values must remain visibly distinct');
const observed={coOccurrence:10,pmi:3,similarity:.6,npmi:.2,score:.46};
assert.ok(C.passes(observed,{...cfg,scoreMax:.5,npmiMin:.1}));
assert.ok(!C.passes(observed,{...cfg,scoreMax:.4}));
assert.ok(!C.passes(observed,{...cfg,npmiMin:.3}));
for(const extra of [{scoreMax:1},{npmiMin:-1}])assert.ok(!C.passes({...observed,coOccurrence:0,pmi:null}, {...cfg,...extra}));
const nodes=Array.from({length:4},(_,i)=>({id:String(i),type:'noun',symFrequency:100}));
const rows=new Map([[0,{co:[0,10,10,10],sim:[1,.8,.7,.6]}],[1,{co:[10,0,10,0],sim:[.8,1,.7,0]}],[2,{co:[10,10,0,0],sim:[.7,.7,1,0]}],[3,{co:[10,0,0,0],sim:[.6,0,0,1]}]]);
const manifest={legacyPMITotal:10000,coAreaCeiling:10000},pairs=new Map();
const all=C.candidates(0,'word',rows.get(0),nodes,pairs,manifest,cfg);
function graph(options={}){return C.construct(0,all,all,rows,nodes,pairs,manifest,{...cfg,...options},Graph,L.communitiesLouvain);}
const g=graph({degree:2});
assert.deepEqual(g.nodes.map(n=>n.index),[0,1,2]);assert.equal(g.degreeRemoved,1);
assert.deepEqual(g.nodes.map(n=>n.prePruneDegree),[3,2,2]);
assert.deepEqual(graph({degree:2,allEdges:true}).nodes.map(n=>n.index),[0,1,2]);
assert.equal(graph({degree:3}).nodes.length,1);
const frames=[];C.layout(g,{},60,f=>frames.push(f));
assert.ok(frames.length>=8);for(const f of frames){assert.equal(f[0],0);assert.equal(f[1],0);assert.ok([...f].every(Number.isFinite));}
const pinnedFrames=[];C.layout(g,{},60,f=>pinnedFrames.push(f),{1:{x:400,y:100}});
for(const f of pinnedFrames){assert.equal(f[2],400);assert.equal(f[3],100);}
const plan=M.create(g.nodes,pinnedFrames,[{index:0,x:80,y:90},{index:1,x:400,y:100}]);
assert.deepEqual([...M.sample(plan,0).positions.slice(0,2)],[80,90]);
assert.deepEqual([...M.sample(plan,1).positions.slice(0,2)],[0,0]);
assert.equal(M.sample(plan,0).opacity[2],0);assert.equal(M.sample(plan,1).opacity[2],1);
for(let t=0;t<=1;t+=.05)assert.ok([...M.sample(plan,t).positions].every(Number.isFinite));
// Legacy degree is a single pass, not recursive k-core removal.
const pathRows=new Map([[0,{co:[0,10,10,10],sim:[1,.8,.7,.6]}],[1,{co:[10,0,10,0],sim:[.8,1,.7,0]}],[2,{co:[10,10,0,10],sim:[.7,.7,1,.5]}],[3,{co:[10,0,10,0],sim:[.6,0,.5,1]}]]);
const single=C.construct(0,all,all,pathRows,nodes,pairs,manifest,{...cfg,degree:3},Graph,L.communitiesLouvain);
assert.deepEqual(single.nodes.map(n=>n.index),[0,2]);assert.equal(single.nodes[1].eligibleDegree,1);
const typed=nodes.map((n,i)=>({...n,type:i===3?'classifier':'noun'}));
const valid=new Map([['0|3',{sourceIndex:3,targetIndex:0,coOccurrence:10,pmi:3,npmi:.2,score:.46}]]);
const mixed=C.candidates(0,'word',rows.get(0),typed,valid,manifest,cfg);
const paired=C.construct(0,mixed,mixed,rows,typed,valid,manifest,{...cfg,hideUnpaired:true},Graph,L.communitiesLouvain);
assert.ok(paired.nodes.some(n=>n.index===3),'A valid noun relation preserves the classifier');
console.log('Restore regression passed: fixed PMI colors, thresholds, single-pass degree, fixed-center force frames, pinned drag and transition fades.');
