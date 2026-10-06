'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const C=require('./semantic-core.js'),Graph=require('./vendor/graphology.min.js').UndirectedGraph;
global.DOMParser=class {};global.Document=class {};
const L=require('./vendor/graphology-library.min.js');
delete global.DOMParser;delete global.Document;
const scope={window:{}};
for(const file of ['word_network_nodes.js','classifier_noun_data.js','classifier_similarity_data.js','word_network_edges.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'data',file),'utf8'),scope);
const nodes=scope.window.WORD_NETWORK_NODES,pairs=C.pairsIndex(nodes,scope.window.CLASSIFIER_NOUN_DATA);
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'data/semantic_v2/manifest.json')));manifest.zeroSet=new Set(manifest.zeroRows);
const row=i=>{const b=fs.readFileSync(path.join(__dirname,'data/semantic_v2/rows',i+'.bin'));assert.equal(b.length,manifest.rowBytes);const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);return{sim:new Float64Array(ab,0,nodes.length),co:new Float64Array(ab,nodes.length*8,nodes.length)};};
const cfg={co:0,pmi:null,similarity:0,includeZero:true,allEdges:false,resolution:1,limit:50};
const oldManifest=scope.window.WORD_NETWORK_EDGE_MANIFEST,oldChunks=new Map();
function oldNeighbors(i){
  const n=nodes[i];
  if(!oldChunks.has(n.chunk))oldChunks.set(n.chunk,fs.readFileSync(path.join(__dirname,oldManifest.chunkBasePath,oldManifest.chunks[n.chunk].file)));
  const buffer=oldChunks.get(n.chunk),neighbors=new Set();
  for(let k=0;k<n.count;k++)neighbors.add(buffer.readUInt32LE((n.offset+k)*oldManifest.recordBytes));
  return neighbors;
}
const approx=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol, a+' != '+b);
// Mathematical encoding, null/zero, long-tail and disconnected-community fixtures.
for(const co of [0,.5,1,100,100000000]){
  const a=C.encoding(co,-4,.1,manifest.coAreaCeiling),b=C.encoding(co,6,.9,manifest.coAreaCeiling);
  assert.equal(a.area,b.area);assert.ok(a.opacity<b.opacity);assert.ok(a.distance>b.distance);
}
assert.equal(C.encoding(null,null,null).distance,260);
const zero={coOccurrence:0,pmi:null,similarity:.8};assert.ok(C.passes(zero,cfg));
assert.ok(!C.passes(zero,{...cfg,co:.5}));assert.ok(!C.passes(zero,{...cfg,pmi:-10}));assert.ok(!C.passes(zero,{...cfg,includeZero:false}));
assert.ok(!C.passes({...zero,similarity:null},cfg));
const syntheticNodes=[{type:'noun',symFrequency:10},{type:'noun',symFrequency:20}];
const missing=C.relation(0,1,{co:[0,0],sim:[0,0]},syntheticNodes,new Map(),{legacyPMITotal:100,zeroSet:new Set([0])});
assert.equal(missing.similarity,null);assert.equal(missing.pmi,null);assert.equal(missing.coOccurrence,0);
assert.throws(()=>C.relation(0,1,{co:[0,NaN],sim:[1,.5]},syntheticNodes,new Map(),{legacyPMITotal:100}),/不可用/);
const fNodes=Array.from({length:5},(_,i)=>({id:String(i),type:'noun'}));
const fEdges=[{source:1,target:2,key:'1|2',similarity:.8},{source:3,target:4,key:'3|4',similarity:.8}];
const f=C.communities([0,1,2,3,4],fEdges,fNodes,Graph,L.communitiesLouvain);
assert.notEqual(f.assignments[1],f.assignments[3]);assert.ok(f.groups.find(x=>x.members.includes(0)).isolated);
const samples=['一棵','一张','一个','树','客厅','思想'];
const rare=nodes.reduce((a,b)=>a.symFrequency<b.symFrequency?a:b).id;
samples.push(rare,...nodes.filter(n=>n.alsoNoun).map(n=>n.id));
const reports=[];
for(const word of [...new Set(samples)]){
  const center=nodes.findIndex(n=>n.id===word),r=row(center);
  approx(r.sim[center],1);
  for(const mode of nodes[center].type==='classifier'?['classifier','noun','word']:['noun','word']){
    for(const limit of word==='客厅'&&mode==='word'?[50,200,400]:[50]){
      const start=performance.now(),all=C.candidates(center,mode,r,nodes,pairs,manifest,cfg),selected=all.slice(0,limit);
      const rows=new Map(selected.map(e=>[e.neighbor,row(e.neighbor)]));
      for(const e of selected)approx(e.similarity,rows.get(e.neighbor).sim[center]);
      const g=C.construct(center,selected,all,rows,nodes,pairs,manifest,cfg,Graph,L.communitiesLouvain);
      // Word mode's display sparsifier includes cross-type edges. Check repeat on the
      // exact original community graph rather than a second sparsified display graph.
      const g2=C.construct(center,selected,all,rows,nodes,pairs,manifest,cfg,Graph,L.communitiesLouvain);
      assert.deepEqual(g.community.assignments,g2.community.assignments);
      assert.ok(!Object.hasOwn(g.community.assignments,center));
      const full=C.construct(center,selected,all,rows,nodes,pairs,manifest,{...cfg,allEdges:true},Graph,L.communitiesLouvain);
      assert.deepEqual(g.community.assignments,full.community.assignments);
      assert.equal(full.edges.length,selected.length+g.peripheralCount);
      const oldAdj=new Map(selected.map(e=>[e.neighbor,oldNeighbors(e.neighbor)]));
      const peripheral=full.edges.filter(e=>e.source!==center&&e.target!==center);
      const lostCoEdges=peripheral.filter(e=>e.coOccurrence>0&&!oldAdj.get(e.source).has(e.target)&&!oldAdj.get(e.target).has(e.source)).length;
      C.layout(g);
      if(word==='客厅'&&limit===400){
        C.layout(full);
        for(let i=0;i<g.nodes.length;i++){approx(g.nodes[i].x,full.nodes[i].x);approx(g.nodes[i].y,full.nodes[i].y);}
      }
      approx(g.nodes[0].x,0);approx(g.nodes[0].y,0);
      let overlaps=0,within=0,outside=0,wi=0,wo=0,error=0;
      const byId=new Map(g.nodes.map(n=>[n.index,n]));
      for(let a=0;a<g.nodes.length;a++)for(let b=a+1;b<g.nodes.length;b++){
        const x=g.nodes[a],y=g.nodes[b];
        if(Math.hypot(x.x-y.x,x.y-y.y)<x.boundRadius+y.boundRadius-.1)overlaps++;
      }
      assert.equal(overlaps,0,'Node overlaps: '+word+'/'+mode+'/'+limit);
      for(const e of g.edges){const a=byId.get(e.source),b=byId.get(e.target);
        assert.ok(Number.isFinite(a.x)&&Number.isFinite(b.y));
        error+=Math.abs(Math.hypot(a.x-b.x,a.y-b.y)-e.distance)/e.distance;
        if(a.center||b.center||a.type!==b.type)continue;
        if(a.community===b.community){within+=e.similarity;wi++;}else{outside+=e.similarity;wo++;}
      }
      const trials=g.community.trials;
      const stability=trials.length?trials.reduce((sum,t)=>{
        const typeTrials=trials.filter(s=>s.type===t.type),members=Object.keys(t.partition);
        let same=0,total=0;
        for(const s of typeTrials)for(let a=0;a<members.length;a++)for(let b=a+1;b<members.length;b++){same+=((t.partition[members[a]]===t.partition[members[b]])===(s.partition[members[a]]===s.partition[members[b]]));total++;}
        return sum+(total?same/total:1);
      },0)/trials.length:1;
      reports.push({word,mode,limit,candidates:all.length,nodes:g.nodes.length,edges:g.edges.length,peripheral:g.peripheralCount,
        communities:g.community.groups.length,overlaps,within:wi?within/wi:null,between:wo?outside/wo:null,
        fullPeripheralSimilarity:g.diagnostics,
        positiveCoPeripheralEdgesMissingFromOldTop400:lostCoEdges,
        seedPairAgreement:stability,relativeDistanceError:g.edges.length?error/g.edges.length:0,
        trials:trials.map(({type,seed,modularity})=>({type,seed,modularity})),elapsedMs:performance.now()-start,
        topNeighbors:selected.slice(0,10).map(e=>({word:nodes[e.neighbor].id,similarity:e.similarity,co:e.coOccurrence,pmi:e.pmi})),
        legacyCommunityCoverage:g.nodes.slice(1).filter(n=>n.legacyCommunity!==null).length/(g.nodes.length-1||1),
        legacyClassifierNeighbors:mode==='classifier'?scope.window.CLASSIFIER_SIMILARITY_DATA.filter(e=>e.source===word||e.target===word)
          .sort((a,b)=>b.similarity-a.similarity).slice(0,10).map(e=>({word:e.source===word?e.target:e.source,legacyCosine:e.similarity})):null});
      console.log(word,mode,limit,'nodes',g.nodes.length,'groups',g.community.groups.length,'overlaps',overlaps);
    }
  }
}
const isolated=C.construct(0,[],[],new Map(),nodes,pairs,manifest,cfg,Graph,L.communitiesLouvain);
C.layout(isolated);assert.equal(isolated.nodes.length,1);assert.equal(isolated.nodes[0].x,0);
fs.mkdirSync(path.join(__dirname,'test_artifacts/semantic_v2'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'test_artifacts/semantic_v2/model-audit.json'),JSON.stringify({version:manifest.version,passed:true,reports},null,2));
console.log('All model assertions passed.');
