'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const cryptoNode=require('crypto'),zlib=require('zlib');
global.crypto ||= cryptoNode.webcrypto;
const codec=require('./semantic-row-codec.js'),C=require('./semantic-core.js');
const base=__dirname,site=path.join(base,'build_cache/preview-lossless');
const manifest=JSON.parse(fs.readFileSync(path.join(site,'data/semantic_v2/manifest.json')));
const originalManifest=JSON.parse(fs.readFileSync(path.join(base,'data/semantic_v2/manifest.json')));
const arrayBuffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const row=b=>({sim:new Float64Array(b,0,manifest.nodeCount),co:new Float64Array(b,manifest.nodeCount*8,manifest.nodeCount)});
const packed=i=>fs.readFileSync(path.join(site,'data/semantic_v2/rows-srg-v1',i+'.srg'));
const originals=new Map(),decoded=new Map();
let decodedBytes=0,packedBytes=0;
async function read(i){
  if(decoded.has(i))return;
  const old=fs.readFileSync(path.join(base,'data/semantic_v2/rows',i+'.bin')),p=packed(i);
  const restored=await codec.decode(arrayBuffer(p),manifest);
  assert.deepEqual(Buffer.from(restored),old,'row '+i+' must be byte-identical');
  originals.set(i,row(arrayBuffer(old)));decoded.set(i,row(restored));
  decodedBytes+=old.length;packedBytes+=p.length;
}
function fixture(raw,n){
  const sim=raw.subarray(0,n*8),shuffled=Buffer.alloc(sim.length);
  for(let j=0;j<8;j++)for(let i=0;i<n;i++)shuffled[j*n+i]=sim[i*8+j];
  const a=zlib.gzipSync(shuffled),b=zlib.gzipSync(raw.subarray(n*8)),h=Buffer.alloc(48);
  h.write('SNR1');h.writeUInt32LE(n,4);h.writeUInt32LE(a.length,8);h.writeUInt32LE(b.length,12);
  cryptoNode.createHash('sha256').update(raw).digest().copy(h,16);
  return Buffer.concat([h,a,b]);
}
(async()=>{
  const scope={window:{}};
  for(const name of ['word_network_nodes','classifier_noun_data'])vm.runInNewContext(fs.readFileSync(path.join(base,'data',name+'.js'),'utf8'),scope);
  const nodes=scope.window.WORD_NETWORK_NODES,pairs=C.pairsIndex(nodes,scope.window.CLASSIFIER_NOUN_DATA);
  manifest.zeroSet=new Set(manifest.zeroRows);originalManifest.zeroSet=new Set(originalManifest.zeroRows);
  for(let i=0;i<64;i++)await read(Math.round(i*(nodes.length-1)/63));
  // Preserve IEEE bit patterns, including negative zero, subnormals and NaN payloads.
  const special=Buffer.alloc(16*8);
  [0n,0x8000000000000000n,1n,0x7ff0000000000000n,0x7ff8000000001234n,0x3ff0000000000000n,0xffffffffffffffffn,0x0010000000000000n].forEach((v,i)=>special.writeBigUInt64LE(v,i*8));
  special.copy(special,64,0,64);
  assert.deepEqual(Buffer.from(await codec.decode(arrayBuffer(fixture(special,8)),{nodeCount:8,rowBytes:128})),special);
  const p=packed(0),bad=Buffer.from(p);bad[16]^=1;
  await assert.rejects(codec.decode(arrayBuffer(bad),manifest),/校验失败/);
  await assert.rejects(codec.decode(arrayBuffer(p.subarray(0,p.length-1)),manifest),/不完整/);
  const badMagic=Buffer.from(p);badMagic[0]=0;await assert.rejects(codec.decode(arrayBuffer(badMagic),manifest),/版本/);
  const badGzip=Buffer.from(p);badGzip[50]^=255;await assert.rejects(codec.decode(arrayBuffer(badGzip),manifest));
  const controller=new AbortController();controller.abort();
  await assert.rejects(codec.decode(arrayBuffer(p),manifest,controller.signal),{name:'AbortError'});
  const inFlight=new AbortController(),promise=codec.decode(arrayBuffer(p),manifest,inFlight.signal);inFlight.abort();
  await assert.rejects(promise,{name:'AbortError'});
  global.DOMParser=class {};global.Document=class {};
  const Graph=require('./vendor/graphology.min.js').UndirectedGraph,L=require('./vendor/graphology-library.min.js');
  delete global.DOMParser;delete global.Document;
  const cfg={co:0,pmi:null,similarity:0,includeZero:true,allEdges:false,resolution:1,degree:0,limit:50};
  const cases=[];
  for(const word of ['一棵','树','客厅']){
    const center=nodes.findIndex(n=>n.id===word);await read(center);
    for(const mode of nodes[center].type==='classifier'?['classifier','noun','word']:['noun','word']){
      for(const limit of word==='客厅'&&mode==='word'?[50,200,400]:[50]){
        const config={...cfg,limit};
        const a=C.candidates(center,mode,originals.get(center),nodes,pairs,originalManifest,config);
        const b=C.candidates(center,mode,decoded.get(center),nodes,pairs,manifest,config);assert.deepEqual(a,b);
        const selected=a.slice(0,limit);for(const e of selected)await read(e.neighbor);
        const g1=C.construct(center,selected,a,originals,nodes,pairs,originalManifest,config,Graph,L.communitiesLouvain);
        const g2=C.construct(center,selected,b,decoded,nodes,pairs,manifest,config,Graph,L.communitiesLouvain);
        C.layout(g1);C.layout(g2);assert.deepEqual(g1,g2);
        if(word==='客厅'&&mode==='word'&&limit===400){
          const full={...config,allEdges:true};
          assert.deepEqual(C.construct(center,selected,a,originals,nodes,pairs,originalManifest,full,Graph,L.communitiesLouvain),C.construct(center,selected,b,decoded,nodes,pairs,manifest,full,Graph,L.communitiesLouvain));
        }
        cases.push({word,mode,limit,nodes:g1.nodes.length,edges:g1.edges.length,graphAndLayoutIdentical:true});
      }
    }
  }
  const report={date:'2026-10-06',decoder:'browser DecompressionStream + SHA256',sampledRows:decoded.size,decodedBytes,packedBytes,
    byteExact:true,malformedAndCanceledRequestsRejected:true,ieeeBitPatternsPreserved:true,cases};
  fs.writeFileSync(path.join(base,'test_artifacts/semantic_v2/release-codec-audit.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
