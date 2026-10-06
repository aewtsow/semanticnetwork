'use strict';
importScripts('vendor/graphology-worker-adapter.js?v=20260929-3','semantic-core.js?v=20261005-1');
let nodes,pairs,manifest,controller,serial=0,lastGraph=null;
const cache=new Map();let cacheBytes=0;
const CACHE_LIMIT=96*1024*1024;
function trim(){while(cacheBytes>CACHE_LIMIT&&cache.size){const key=cache.keys().next().value;cacheBytes-=cache.get(key).bytes;cache.delete(key);}}
async function row(index,signal){
  if(cache.has(index)){const r=cache.get(index);cache.delete(index);cache.set(index,r);return r;}
  const response=await fetch(`data/semantic_v2/rows/${index}.bin?v=${manifest.version}`,{signal});
  if(!response.ok)throw Error(`“${nodes[index].id}”的精确相似性尚未生成。请运行 prepare_semantic_v2.py --all 后重试；不会用旧相似性替代。`);
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength!==manifest.rowBytes)throw Error('新版数据长度不匹配，请检查数据版本');
  const n=nodes.length,r={sim:new Float64Array(buffer,0,n),co:new Float64Array(buffer,n*8,n),bytes:buffer.byteLength};
  cache.set(index,r);cacheBytes+=r.bytes;trim();return r;
}
onmessage=async({data})=>{
  if(data.type==='init'){
    nodes=data.nodes;pairs=SemanticCore.pairsIndex(nodes,data.pairs);manifest=data.manifest;
    manifest.zeroSet=new Set(manifest.zeroRows);return;
  }
  if(data.type==='cancel'){serial++;controller?.abort();return;}
  if(data.type==='relax'){
    if(!lastGraph||lastGraph.center!==data.center)return;
    const frames=[];
    SemanticCore.layout(lastGraph,data.previous,150,f=>frames.push(f),data.pinned);
    postMessage({type:'motion',token:data.token,frames,indices:lastGraph.nodes.map(n=>n.index)});
    return;
  }
  if(data.type!=='build')return;
  const own=++serial;controller?.abort();controller=new AbortController();const signal=controller.signal;
  try{
    const started=performance.now(),all=SemanticCore.candidates(data.center,data.mode,await row(data.center,signal),nodes,pairs,manifest,data.config);
    const selected=all.slice(0,data.config.limit),rows=new Map();let cursor=0;
    await Promise.all(Array.from({length:Math.min(6,selected.length)},async()=>{
      while(cursor<selected.length){const i=selected[cursor++].neighbor;rows.set(i,await row(i,signal));}
    }));
    if(own!==serial)return;
    const graph=SemanticCore.construct(data.center,selected,all,rows,nodes,pairs,manifest,data.config,graphology.UndirectedGraph,graphologyLibrary.communitiesLouvain);
    const frames=[];
    SemanticCore.layout(graph,data.previous||{},260,data.animate?f=>frames.push(f):null,null,data.layoutSeed||0);
    lastGraph=graph;
    graph.elapsedMs=performance.now()-started;
    graph.cacheBytes=cacheBytes;
    graph.version=manifest.version;
    if(own===serial)postMessage({type:'graph',token:data.token,graph:{...graph,layoutEdges:undefined},frames});
  }catch(error){if(own===serial&&error.name!=='AbortError')postMessage({type:'error',token:data.token,message:error.message});}
};
