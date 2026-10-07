/* Shared pure model: usable from the worker and Node regression tests. */
(function (root) {
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const pairKey=(a,b)=>a<b?`${a}|${b}`:`${b}|${a}`;
  function rng(seed) {
    let h=2166136261;
    for(const c of String(seed)) h=Math.imul(h^c.charCodeAt(0),16777619);
    return ()=>{h+=0x6D2B79F5;let t=Math.imul(h^h>>>15,1|h);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
  }
  function encoding(co,pmi,similarity,ceiling=10000,center=false) {
    const area=center?Math.PI*16**2:Math.PI*(7**2+(24**2-7**2)*clamp(Math.log1p(Math.max(0,co||0))/Math.log1p(ceiling),0,1));
    // Fixed across centers/tabs. Squaring the sigmoid makes weak evidence nearly
    // white without filtering it. Opaque colors avoid alpha accumulation.
    const tone=Number.isFinite(pmi)?1/(1+Math.exp(-(pmi-5)/2)):null;
    const edgeColor=tone===null?'rgb(153,169,160)':'rgb('+[27,70,48].map(v=>Math.round(255+(v-255)*tone**2)).join(',')+')';
    return {area,radius:Math.sqrt(area/Math.PI),
      opacity:tone===null?.26:.08+.9*tone,edgeColor,
      distance:Number.isFinite(similarity)?60+200*(Math.acos(clamp(similarity,0,1))/(Math.PI/2))**.7:260};
  }
  // Compute once per graph, not once per animation frame. Sort only the small
  // palette, preserve edge objects and leave the model's edge order untouched.
  function paintOrder(edges) {
    const buckets=new Map();
    for(const edge of edges){
      let bucket=buckets.get(edge.edgeColor);
      if(!bucket){
        const rgb=edge.edgeColor.match(/\d+/g).map(Number);
        bucket={lightness:rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722,edges:[]};
        buckets.set(edge.edgeColor,bucket);
      }
      bucket.edges.push(edge);
    }
    return [...buckets.values()].sort((a,b)=>b.lightness-a.lightness).flatMap(b=>b.edges);
  }
  function pairsIndex(nodes,pairs) {
    const ids=new Map(nodes.map((n,i)=>[n.id,i]));
    return new Map(pairs.filter(p=>p.classifier!==p.word).map(p=>{
      const a=ids.get(p.classifier),b=ids.get(p.word);
      return [pairKey(a,b),{...p,sourceIndex:a,targetIndex:b}];
    }));
  }
  function relation(a,b,row,nodes,pairs,manifest) {
    const p=pairs.get(pairKey(a,b));
    if(!p && nodes[a].type!==nodes[b].type) return null;
    const count=p?p.coOccurrence:row.co[b];
    if(!Number.isFinite(count)) throw Error('共现数据不可用，不能当成零');
    const zero=manifest.zeroSet?.has(a)||manifest.zeroSet?.has(b);
    const similarity=zero?null:row.sim[b];
    if(!zero&&!Number.isFinite(similarity)) throw Error('相似性数据不可用');
    const pmi=p?p.pmi:count>0?Math.log(manifest.legacyPMITotal*count/(nodes[a].symFrequency*nodes[b].symFrequency)):null;
    const npmi=p?p.npmi:count>0?pmi/-Math.log(count/manifest.legacyPMITotal):null;
    return {key:pairKey(a,b),source:p?p.sourceIndex:Math.min(a,b),target:p?p.targetIndex:Math.max(a,b),
      coOccurrence:count,pmi,npmi,score:p?p.score:count>0?npmi*Math.log(count):null,similarity,
      directed:!!p,relationType:p?'classifier_noun':nodes[a].type==='classifier'?'classifier_classifier':'noun_noun',
      status:count===0?'zero':'observed',similarityStatus:zero?'zero-vector':'available'};
  }
  function passes(e,c) {
    if(e.similarity===null) {if(c.similarity>0)return false;}
    else if(e.similarity<c.similarity) return false;
    if(e.coOccurrence===0) return !!c.includeZero && e.similarity>0 && c.co===0 && c.pmi===null && c.npmiMin==null && c.scoreMax==null;
    return e.coOccurrence>=c.co && (c.pmi===null||e.pmi>=c.pmi)
      && (c.npmiMin==null||(e.npmi!==null&&e.npmi>=c.npmiMin))
      && (c.scoreMax==null||(e.score!==null&&e.score<=c.scoreMax));
  }
  function candidates(center,mode,row,nodes,pairs,manifest,config) {
    const result=[];
    for(let j=0;j<nodes.length;j++) {
      if(j===center)continue;
      if(mode==='classifier'&&nodes[j].type!=='classifier')continue;
      const p=pairs.get(pairKey(center,j));
      if(mode==='noun'&&(!p||(nodes[center].type==='classifier'?p.sourceIndex!==center:p.targetIndex!==center)))continue;
      const e=relation(center,j,row,nodes,pairs,manifest);
      if(!e || (e.similarity===0&&e.coOccurrence===0)||!passes(e,config))continue;
      result.push({...e,neighbor:j});
    }
    result.sort((a,b)=>(b.similarity??-1)-(a.similarity??-1)||b.coOccurrence-a.coOccurrence||a.neighbor-b.neighbor);
    return result;
  }
  function sparsify(edges,limit=8) {
    if(limit===0)return edges;
    const adjacency=new Map();
    for(const e of edges) for(const i of [e.source,e.target]){
      if(!adjacency.has(i))adjacency.set(i,[]);adjacency.get(i).push(e);
    }
    const keep=new Set();
    for(const list of adjacency.values()){
      list.sort((a,b)=>(b.similarity??-1)-(a.similarity??-1)||a.key.localeCompare(b.key));
      for(const e of list.slice(0,limit))keep.add(e.key);
    }
    return edges.filter(e=>keep.has(e.key));
  }
  function canonicalPartition(partition) {
    const groups=new Map();
    for(const [id,g] of Object.entries(partition)){if(!groups.has(g))groups.set(g,[]);groups.get(g).push(Number(id));}
    return [...groups.values()].map(a=>a.sort((x,y)=>x-y)).sort((a,b)=>a[0]-b[0]);
  }
  // Display-only filter: threshold FIRST, then take the union of each endpoint's
  // strongest X eligible edges. Never feed this selection into pruning/clustering.
  function peripheralDisplay(edges,config) {
    if(config.peripheralMode==='custom') {
      const threshold=Number(config.peripheralSimilarity),limit=Number(config.peripheralTopK);
      if(!Number.isFinite(threshold)||threshold<0||threshold>1||!Number.isInteger(limit)||limit<1||limit>400)
        throw Error('外围相似性阈值须在 0–1 之间，最强条数须为 1–400 的整数');
      return sparsify(edges.filter(e=>Number.isFinite(e.similarity)&&e.similarity>threshold),limit);
    }
    return sparsify(edges,config.allEdges?0:8);
  }
  function communities(ids,edges,nodes,Graph,louvain,resolution=1) {
    const assignments={},groups=[],trials=[];
    for(const type of ['classifier','noun']) {
      const members=ids.filter(i=>nodes[i].type===type);
      const valid=new Set(members);
      const links=sparsify(edges.filter(e=>valid.has(e.source)&&valid.has(e.target)&&e.similarity>0),8);
      const graph=new Graph({allowSelfLoops:false,multi:false});
      members.forEach(i=>graph.addNode(String(i)));
      links.forEach(e=>graph.addUndirectedEdgeWithKey(e.key,String(e.source),String(e.target),{weight:e.similarity}));
      let best=null;
      if(links.length)for(let seed=0;seed<5;seed++) {
        const result=louvain.detailed(graph,{getEdgeWeight:'weight',resolution,randomWalk:true,rng:rng(`semantic-v2|${type}|${seed}`)});
        const signature=JSON.stringify(canonicalPartition(result.communities));
        const trial={type,seed,modularity:result.modularity,partition:result.communities};trials.push(trial);
        if(!best||result.modularity>best.modularity+1e-12||(Math.abs(result.modularity-best.modularity)<1e-12&&signature<best.signature))best={...result,signature};
      }
      const proposed=best?canonicalPartition(best.communities):members.map(i=>[i]);
      // Split disconnected members inside any returned community explicitly.
      const adj=new Map(members.map(i=>[i,[]]));
      for(const e of links){adj.get(e.source).push(e.target);adj.get(e.target).push(e.source);}
      for(const group of proposed){
        const unseen=new Set(group);
        while(unseen.size){
          const first=Math.min(...unseen),part=[],stack=[first];unseen.delete(first);
          while(stack.length){const i=stack.pop();part.push(i);for(const j of adj.get(i))if(unseen.delete(j))stack.push(j);}
          part.sort((a,b)=>a-b);
          const key=`${type}:${part[0]}`;
          part.forEach(i=>assignments[i]=key);
          groups.push({key,type,members:part,isolated:part.length===1});
        }
      }
    }
    return {assignments,groups,trials};
  }
  function construct(center,selected,allCandidates,rows,nodes,pairs,manifest,config,Graph,louvain) {
    let indices=[center,...selected.map(e=>e.neighbor)],peripheral=[];
    for(let a=1;a<indices.length;a++)for(let b=a+1;b<indices.length;b++){
      const e=relation(indices[a],indices[b],rows.get(indices[a]),nodes,pairs,manifest);
      if(e && (e.coOccurrence>0||e.similarity>0)&&passes(e,config))peripheral.push(e);
    }
    const selectedBeforePrune=selected.length,prePruneDegree=new Map(indices.map(i=>[i,0]));
    for(const e of [...selected,...peripheral])for(const i of [e.source,e.target])prePruneDegree.set(i,prePruneDegree.get(i)+1);
    const kept=new Set(indices.filter(i=>i===center||prePruneDegree.get(i)>=(config.degree??0)));
    const degreeRemoved=indices.length-kept.size;
    let unpairedRemoved=0;
    if(config.hideUnpaired){
      const paired=new Set();
      for(const e of [...selected,...peripheral])if(e.directed&&kept.has(e.source)&&kept.has(e.target)){paired.add(e.source);paired.add(e.target);}
      for(const i of [...kept])if(i!==center&&nodes[i].type==='classifier'&&!paired.has(i)){kept.delete(i);unpairedRemoved++;}
    }
    indices=indices.filter(i=>kept.has(i));selected=selected.filter(e=>kept.has(e.neighbor));
    peripheral=peripheral.filter(e=>kept.has(e.source)&&kept.has(e.target));
    const eligibleDegree=new Map(indices.map(i=>[i,0]));
    for(const e of [...selected,...peripheral])for(const i of [e.source,e.target])eligibleDegree.set(i,eligibleDegree.get(i)+1);
    const community=communities(indices.slice(1),peripheral,nodes,Graph,louvain,config.resolution);
    const visible=peripheralDisplay(peripheral,config);
    const edges=[...selected,...visible].map(e=>({...e,...encoding(e.coOccurrence,e.pmi,e.similarity,manifest.coAreaCeiling)}));
    // Displaying every relation must not multiply the layout's inward force.
    // The same explicitly documented top-8 scaffold drives both display modes.
    const layoutEdges=[...selected,...sparsify(peripheral,8)].map(e=>({...e,...encoding(e.coOccurrence,e.pmi,e.similarity,manifest.coAreaCeiling)}));
    const byNeighbor=new Map(selected.map(e=>[e.neighbor,e]));
    const visibleDegree=new Map(indices.map(i=>[i,0]));
    for(const e of edges)for(const i of [e.source,e.target])visibleDegree.set(i,visibleDegree.get(i)+1);
    const resultNodes=indices.map(i=>{
      const e=byNeighbor.get(i),original=nodes[i];
      return {index:i,label:original.id,type:original.type,alsoNoun:original.alsoNoun,center:i===center,
        directCo:i===center?null:e.coOccurrence,directPmi:e?.pmi??null,directSimilarity:e?.similarity??null,
        directNpmi:e?.npmi??null,directScore:e?.score??null,
        prePruneDegree:prePruneDegree.get(i),eligibleDegree:eligibleDegree.get(i),visibleDegree:visibleDegree.get(i),
        community:community.assignments[i]??null,legacyCommunity:original.community,
        ...encoding(e?.coOccurrence,e?.pmi,e?.similarity,manifest.coAreaCeiling,i===center)};
    });
    // Equilateral triangles and circles have equal AREA, but different collision radii.
    resultNodes.forEach(n=>n.boundRadius=n.type==='classifier'?Math.sqrt(4*n.area/(3*Math.sqrt(3))):n.radius);
    let within=0,between=0,withinCount=0,betweenCount=0;
    for(const e of peripheral)if(nodes[e.source].type===nodes[e.target].type&&e.similarity!==null){
      if(community.assignments[e.source]===community.assignments[e.target]){within+=e.similarity;withinCount++;}
      else{between+=e.similarity;betweenCount++;}
    }
    return {nodes:resultNodes,edges,layoutEdges,community,candidateCount:allCandidates.length,
      selectedBeforePrune,degreeRemoved,unpairedRemoved,
      peripheralCount:peripheral.length,visiblePeripheralCount:visible.length,center,
      diagnostics:{withinMean:withinCount?within/withinCount:null,betweenMean:betweenCount?between/betweenCount:null,
        withinCount,betweenCount,population:'all eligible same-type peripheral relations, before display sparsification'}};
  }
  function layout(graph,previous={},iterations=260,onFrame=null,pinned=null,seed=0) {
    const ns=graph.nodes,groups=graph.community.groups,positions=new Map(),byIndex=new Map(ns.map(n=>[n.index,n])),springs=graph.layoutEdges||graph.edges;
    groups.forEach((g,k)=>{
      const angle=k*2.399963+seed*.61,rad=120+30*Math.sqrt(k);
      g.anchor={x:Math.cos(angle)*rad,y:Math.sin(angle)*rad};
      g.members.forEach((i,j)=>{
        const n=byIndex.get(i),cached=previous[i];
        n.x=cached?.x??g.anchor.x+Math.cos(j*2.399963)*20*Math.sqrt(j+1);
        n.y=cached?.y??g.anchor.y+Math.sin(j*2.399963)*20*Math.sqrt(j+1);
        n.anchor=g.anchor;
      });
    });
    const degree=new Map(ns.map(n=>[n.index,0]));
    springs.forEach(e=>{degree.set(e.source,degree.get(e.source)+1);degree.set(e.target,degree.get(e.target)+1);});
    ns.forEach(n=>{if(n.center){n.x=0;n.y=0;}n.vx=0;n.vy=0;});
    const constrain=()=>{for(const n of ns){const p=pinned?.[n.index];if(p&&!n.center){n.x=p.x;n.y=p.y;n.vx=0;n.vy=0;}}};
    const capture=()=>onFrame?.(Float32Array.from(ns.flatMap(n=>[n.x,n.y])));
    constrain();capture();
    for(let iteration=0;iteration<iterations;iteration++){
      const alpha=Math.max(.08,1-iteration/iterations);
      ns.forEach(n=>{n.fx=0;n.fy=0;});
      for(let a=0;a<ns.length;a++)for(let b=a+1;b<ns.length;b++){
        const x=ns[a],y=ns[b];let dx=y.x-x.x,dy=y.y-x.y,d=Math.hypot(dx,dy);
        if(d<.001){dx=.01;dy=.01;d=Math.hypot(dx,dy);}
        const collision=x.boundRadius+y.boundRadius+9;
        const force=d<collision?(collision-d)*.32+1:Math.min(3,1700/d**2);
        x.fx-=dx/d*force;x.fy-=dy/d*force;y.fx+=dx/d*force;y.fy+=dy/d*force;
      }
      for(const e of springs){
        const x=byIndex.get(e.source),y=byIndex.get(e.target);
        const dx=y.x-x.x,dy=y.y-x.y,d=Math.hypot(dx,dy)||.01;
        const normalization=1/Math.sqrt(Math.max(1,Math.min(degree.get(x.index),degree.get(y.index))));
        const force=clamp((d-e.distance)*.025*normalization,-4,4);
        x.fx+=dx/d*force;x.fy+=dy/d*force;y.fx-=dx/d*force;y.fy-=dy/d*force;
      }
      for(const n of ns){
        if(n.center){n.x=0;n.y=0;continue;}
        if(pinned?.[n.index])continue;
        n.fx+=(n.anchor.x-n.x)*.0015;n.fy+=(n.anchor.y-n.y)*.0015;
        n.vx=(n.vx+n.fx*alpha)*.72;n.vy=(n.vy+n.fy*alpha)*.72;
        n.x+=clamp(n.vx,-9,9);n.y+=clamp(n.vy,-9,9);
      }
      constrain();if(iteration%10===9)capture();
    }
    // Final collision projection, independent of semantic community forces.
    for(let k=0;k<180;k++)for(let a=0;a<ns.length;a++)for(let b=a+1;b<ns.length;b++){
      const x=ns[a],y=ns[b],dx=y.x-x.x||.001,dy=y.y-x.y,d=Math.hypot(dx,dy)||.001,min=x.boundRadius+y.boundRadius+3;
      if(d>=min)continue;
      const fixedX=x.center||!!pinned?.[x.index],fixedY=y.center||!!pinned?.[y.index];
      const f=(min-d)/(d*(fixedX||fixedY?1:2));
      if(!fixedX){x.x-=dx*f;x.y-=dy*f;}if(!fixedY){y.x+=dx*f;y.y+=dy*f;}
    }
    constrain();capture();
    for(const n of ns)positions.set(n.index,{x:n.x,y:n.y});
    return positions;
  }
  root.SemanticCore={clamp,pairKey,rng,encoding,paintOrder,pairsIndex,relation,passes,candidates,sparsify,peripheralDisplay,communities,construct,layout};
  if(typeof module!=='undefined')module.exports=root.SemanticCore;
})(typeof self!=='undefined'?self:globalThis);
