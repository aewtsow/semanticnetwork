/* Main thread owns interaction only; all graph computations live in the worker. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), nodes=window.WORD_NETWORK_NODES, pairs=window.CLASSIFIER_NOUN_DATA;
  const ids=new Map(nodes.map((n,i)=>[n.id,i])), NS='http://www.w3.org/2000/svg';
  const state={mode:'classifier',center:ids.get('一棵'),wordCenter:ids.get('一棵'),classifierCenter:ids.get('一棵'),
    graph:null,paintEdges:[],manifest:null,worker:null,busy:false,token:0,view:{x:0,y:0,k:1},hover:null,drag:null,
    colors:new Map(),buildCount:0,frame:0,star:null,animation:null,ghosts:[],motionFrames:0,layoutSeed:0,resetLayout:false,inspected:null};
  // Original soft palette, with small hue/chroma adjustments for separation.
  const palette=['#648d7d','#7f96b5','#b9a168','#ae8195','#8aa267','#a98265','#6aa0ad','#9d8bb6','#c28b7b','#a4a66c'];
  const svg=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const fmt=(v,d=3)=>v===null||v===undefined?'不可用':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d});
  function config(){return {limit:Number($('limit').value),co:Number($('co').value),
    pmi:$('pmiEnabled').checked?Number($('pmi').value):null,similarity:Number($('similarity').value),
    includeZero:$('includeZero').checked,allEdges:$('allEdges').value==='true',resolution:Number($('resolution').value),
    peripheralMode:$('allEdges').value==='custom'?'custom':'default',peripheralSimilarity:Number($('peripheralSimilarity').value),peripheralTopK:Number($('peripheralTopK').value),
    degree:Number($('degree').value),npmiMin:$('npmiEnabled').checked?Number($('npmiMin').value):null,
    scoreMax:$('scoreEnabled').checked?Number($('scoreMax').value):null,hideUnpaired:state.mode==='word'&&$('hideUnpaired').checked};}
  function message(text,error=false){$('status').textContent=text;$('retry').hidden=!error;}
  function suggestions(){
    const query=$('search').value.trim();
    const matches=nodes.filter(n=>(state.mode!=='classifier'||n.type==='classifier')&&n.id.includes(query)).slice(0,40);
    $('suggestions').replaceChildren(...matches.map(n=>{const o=el('option');o.value=n.id;return o;}));
  }
  let pendingBuild;
  function makeWorker(){
    const worker=new Worker('semantic-worker.js?v=20261007-1');
    state.worker=worker;
    worker.postMessage({type:'init',nodes,pairs,manifest:state.manifest});
    worker.onmessage=({data})=>{
      if(state.worker!==worker||data.token!==state.token)return;
      if(data.type==='motion'){
        state.relaxing=false;
        if(data.indices.join(',')!==state.graph?.nodes.map(n=>n.index).join(','))return;
        const previous=state.graph.nodes.map(n=>({...n}));
        animate(data.frames,previous,state.view,state.view,850);
        return;
      }
      state.busy=false;$('stage').setAttribute('aria-busy','false');
      if(data.type==='error'){message(data.message,true);return;}
      const same=state.graph?.center===data.graph.center;
      const prior=state.graph,oldView={...state.view};
      const previous=prior?.nodes.map(n=>({...n}))||[];
      const retained=new Set(data.graph.nodes.map(n=>n.index));
      state.ghosts=[...$('viewport').children].filter(e=>e.classList.contains('node')&&!retained.has(Number(e.dataset.index))).map(e=>e.cloneNode(true));
      state.graph=data.graph;state.buildCount++;state.hover=null;
      state.paintEdges=SemanticCore.paintOrder(state.graph.edges);
      $('stage').dataset.buildCount=state.buildCount;
      assignColors(prior);renderNodes();if(!same)fit();else draw();
      const targetView={...state.view};
      for(const ghost of state.ghosts){ghost.classList.add('ghost');ghost.setAttribute('tabindex','-1');ghost.setAttribute('aria-hidden','true');$('viewport').append(ghost);}
      if(data.frames?.length)animate(data.frames,previous,prior?oldView:targetView,targetView,1200);
      else stopMotion(true);
      const g=state.graph,groups=g.community.groups.filter(x=>!x.isolated).length;
      $('graphStats').textContent='合格邻居 '+g.candidateCount.toLocaleString()+' · 显示 '+(g.nodes.length-1)+' · 外围关系 '+g.visiblePeripheralCount.toLocaleString()+' / '+g.peripheralCount.toLocaleString()+' · 社区 '+groups;
      $('pruneStats').textContent='截取 '+g.selectedBeforePrune+' → Degree 裁剪 −'+g.degreeRemoved+' → 无搭配裁剪 −'+g.unpairedRemoved+' → 保留 '+(g.nodes.length-1);
      $('footerStatus').textContent='精确 PPMI 余弦 · '+fmt(g.elapsedMs/1000,2)+' 秒 · 行缓存 '+fmt(g.cacheBytes/1048576,1)+' MB / 96 MB';
      message(g.nodes.length===1?'没有符合当前条件的邻居。可降低筛选阈值。':'');
      inspect(g.nodes[0]);
    };
    worker.onerror=e=>{if(state.worker!==worker)return;state.busy=false;worker.terminate();state.worker=null;$('stage').setAttribute('aria-busy','false');message('后台计算失败：'+e.message,true);};
  }
  function build(){
    clearTimeout(pendingBuild);
    stopMotion(false);
    if((state.busy||state.relaxing)&&state.worker){state.worker.terminate();state.worker=null;state.busy=false;state.relaxing=false;}
    // Coalesce quick controls before starting another worker's import requests.
    pendingBuild=setTimeout(buildNow,120);
  }
  async function buildNow(){
    if(!state.manifest){await initialize();return;}
    for(const id of ['co','pmi','similarity','resolution','degree','npmiMin','scoreMax'])if(!$(id).checkValidity()){ $(id).reportValidity();return; }
    if($('allEdges').value==='custom')for(const id of ['peripheralSimilarity','peripheralTopK'])if(!$(id).checkValidity()){$(id).reportValidity();return;}
    // A new center can interrupt even a synchronous Louvain/layout computation.
    // Completed workers retain their LRU; only an in-flight stale job is terminated.
    if(state.busy){state.worker.terminate();state.worker=null;}
    if(!state.worker)makeWorker();
    state.busy=true;state.token++;$('stage').setAttribute('aria-busy','true');
    $('centerTitle').textContent=nodes[state.center].id;
    message('正在加载精确关系并计算外围社区…');
    const previous=!state.resetLayout&&state.graph?.center===state.center?Object.fromEntries(state.graph.nodes.map(n=>[n.index,{x:n.x,y:n.y}])):{};
    state.resetLayout=false;
    state.worker.postMessage({type:'build',token:state.token,center:state.center,mode:state.mode,config:config(),previous,animate:motionEnabled(),layoutSeed:state.layoutSeed});
  }
  function recenter(index){
    if(state.mode==='classifier'&&nodes[index].type!=='classifier'){message('量词—量词视图的中心必须是量词。',false);return;}
    state.center=index;if(nodes[index].type==='classifier')state.classifierCenter=index;
    $('search').value=nodes[index].id;
    if(state.mode==='word')state.wordCenter=index;
    void build();
  }
  function assignColors(prior){
    const used=new Set(),previous=prior?.community.groups||[];
    const next=new Map();
    for(const group of state.graph.community.groups){
      if(group.isolated){next.set(group.key,'#adb5af');continue;}
      let best=null,overlap=0;
      if(prior?.center===state.graph.center)for(const old of previous){
        const n=group.members.filter(i=>old.members.includes(i)).length;
        if(n>overlap&&!used.has(state.colors.get(old.key))){best=state.colors.get(old.key);overlap=n;}
      }
      const hash=[...group.key].reduce((a,c)=>Math.imul(a,31)+c.charCodeAt(0)|0,0);
      const preferred=Math.abs(hash)%palette.length;
      const color=best||Array.from({length:palette.length},(_,i)=>palette[(preferred+i)%palette.length]).find(c=>!used.has(c))||palette[preferred];
      next.set(group.key,color);used.add(color);
    }
    state.colors=next;
  }
  function color(n){return n.center?'#365e4e':state.colors.get(n.community)||'#9ba99f';}
  function renderNodes(){
    const fragment=document.createDocumentFragment();
    for(const n of state.graph.nodes){
      const g=svg('g',{class:'node',tabindex:'0',role:'button','aria-label':n.label+'，'+(n.center?'中心词':'共现 '+fmt(n.directCo)+'，点击设为中心'),'data-index':n.index,'data-word':n.label});
      if(n.center)g.append(svg('circle',{r:n.boundRadius+6,class:'ring'}));
      const shape=n.type==='classifier'?svg('polygon',{points:'0,'+(-n.boundRadius)+' '+(-Math.sqrt(3)*n.boundRadius/2)+','+(n.boundRadius/2)+' '+(Math.sqrt(3)*n.boundRadius/2)+','+(n.boundRadius/2)}):svg('circle',{r:n.radius});
      shape.setAttribute('class','shape');shape.setAttribute('fill',n.directCo===0?'#fff':color(n));shape.setAttribute('stroke',color(n));
      g.append(shape);
      const text=svg('text',{x:0,y:n.boundRadius+17,'text-anchor':'middle'});text.textContent=n.label;g.append(text);
      g.addEventListener('pointerenter',()=>{if(!state.drag){state.hover=n.index;inspect(n);draw();}});
      g.addEventListener('pointerleave',()=>{if(!state.drag){state.hover=null;draw();}});
      g.addEventListener('focus',()=>{state.hover=n.index;inspect(n);draw();});
      g.addEventListener('blur',()=>{state.hover=null;draw();});
      g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();recenter(n.index);}});
      fragment.append(g);
    }
    $('viewport').replaceChildren(fragment);
  }
  function inspect(n){
    state.inspected=n.index;
    const g=state.graph,box=$('details');if(!g)return;
    box.replaceChildren(el('h2',n.label),el('span',n.type==='classifier'?'量词'+(n.alsoNoun?' · 同时具有名词身份':''):'名词','type-tag'));
    if(n.center)box.append(el('p','当前探索锚点。固定面积，不参与共现大小比较。','hint'));
    const dl=el('dl');
    const metrics=n.center?[['原始全网度数',nodes[n.index].degreeFull],['可见直接邻居',g.nodes.length-1]]:
      [['与中心共现',n.directCo],['与中心相似性',n.directSimilarity],['与中心 PMI',n.directPmi]];
    metrics.push(['修剪前 Degree',n.prePruneDegree],['裁剪后完整 Degree',n.eligibleDegree],['显示边 Degree',n.visibleDegree]);
    for(const [label,value] of metrics){dl.append(el('dt',label),el('dd',fmt(value)));}
    box.append(dl);
    const raw=el('details',undefined,'minor');raw.append(el('summary','原始指标'));
    const rawList=el('dl'),original=nodes[n.index];
    const rawMetrics=[['NPMI（与中心）',n.directNpmi],['旧关联分数（与中心）',n.directScore],
      ['全网度数',original.degreeFull],['对称词频',original.symFrequency],
      ['旧聚类系数',original.clustering],['旧特征向量中心性',original.eigenvector],
      ['接近中心性（未计算）',original.closeness],['中介中心性（未计算）',original.betweenness]];
    for(const [label,value] of rawMetrics)rawList.append(el('dt',label),el('dd',fmt(value,6)));
    raw.append(rawList,el('p','旧指标保留原口径；不可用的数据未补零。','hint'));box.append(raw);
    if(n.directCo===0)box.append(el('p','共现 0，PMI 不可用。相似性来自完整语境，而非直接共现。','hint'));
    if(!n.center&&n.directSimilarity===null)box.append(el('p','该词为零向量，相似性不可用；未将其补成零。','hint'));
    $('legacySummary').textContent=n.label+'：旧全局社区 '+(n.legacyCommunity??'不可用')+'（历史编号，不是新版分组）。';
    const group=g.community.groups.find(x=>x.key===n.community);
    if(group){
      const heading=el('h3',(group.isolated?'未分组 / 孤立词':'同词类社区')+' · '+group.members.length+' 词');
      const dot=el('span',undefined,'community-dot');dot.style.background=color(n);heading.prepend(dot);box.append(heading);
      const list=el('div',undefined,'member-list');
      for(const i of group.members){const b=el('button',nodes[i].id);b.onclick=()=>recenter(i);list.append(b);}box.append(list);
    }else{
      box.append(el('h3','外围社区'));
      for(const group of g.community.groups.filter(x=>!x.isolated)){
        const p=el('p',undefined,'hint'),dot=el('span',undefined,'community-dot');dot.style.background=state.colors.get(group.key);
        p.append(dot,document.createTextNode(group.members.slice(0,4).map(i=>nodes[i].id).join('、')+' · '+group.members.length+' 词'));box.append(p);
      }
    }
    const rank=$('rankMetric').value;
    const relations=g.edges.filter(e=>e.source===n.index||e.target===n.index).sort((a,b)=>(b[rank]??-Infinity)-(a[rank]??-Infinity)||a.key.localeCompare(b.key));
    box.append(el('h3','可见关联词 · '+relations.length));
    const list=el('div',undefined,'member-list');
    for(const edge of relations.slice(0,30)){
      const i=edge.source===n.index?edge.target:edge.source,b=el('button',nodes[i].id);
      b.title='相似性 '+fmt(edge.similarity)+' · 共现 '+fmt(edge.coOccurrence)+' · PMI '+fmt(edge.pmi)+(edge.directed?' · '+nodes[edge.source].id+' → '+nodes[edge.target].id:'');
      b.onclick=()=>recenter(i);list.append(b);
    }
    box.append(list);
    if(relations.length>30)box.append(el('p','此处按所选指标列出前 30 个可见关联词。','hint'));
  }
  function motionEnabled(){return $('motion').checked&&!matchMedia('(prefers-reduced-motion:reduce)').matches&&!document.hidden;}
  function stopMotion(finish){
    const a=state.animation;
    if(finish&&a&&state.graph){
      const final=a.plan.frames.at(-1);
      state.graph.nodes.forEach((n,i)=>{n.x=final[i*2];n.y=final[i*2+1];n.drawOpacity=1;});
      state.view={...a.toView};
    }
    state.animation=null;state.ghosts.forEach(e=>e.remove());state.ghosts=[];
    state.graph?.nodes.forEach(n=>n.drawOpacity=1);
    $('stage').dataset.animating='false';
  }
  function animate(frames,previous,fromView,toView,duration){
    if(!frames?.length)return;
    const plan=SemanticMotion.create(state.graph.nodes,frames,previous);
    state.animation={plan,fromView:{...fromView},toView:{...toView},started:performance.now(),duration};
    $('stage').dataset.animating='true';
    if(!motionEnabled()){stopMotion(true);draw();return;}
    // Frame zero is the old visible position, never a flash of the final frame.
    advanceMotion(state.animation.started);draw();
  }
  function advanceMotion(now){
    const a=state.animation;if(!a)return;
    const t=Math.min(1,(now-a.started)/a.duration),frame=SemanticMotion.sample(a.plan,t);
    state.graph.nodes.forEach((n,i)=>{n.x=frame.positions[i*2];n.y=frame.positions[i*2+1];n.drawOpacity=frame.opacity[i];});
    for(const key of ['x','y','k'])state.view[key]=a.fromView[key]+(a.toView[key]-a.fromView[key])*frame.eased;
    state.ghosts.forEach(e=>e.style.opacity=String(1-SemanticMotion.ease(Math.min(1,t*1.4))));
    state.motionFrames++;$('stage').dataset.motionFrames=state.motionFrames;
    if(t>=1)stopMotion(true);
  }
  function relax(n){
    if(!state.worker||state.busy||!motionEnabled())return;
    state.token++;state.relaxing=true;
    state.worker.postMessage({type:'relax',token:state.token,center:state.center,
      previous:Object.fromEntries(state.graph.nodes.map(v=>[v.index,{x:v.x,y:v.y}])),pinned:{[n.index]:{x:n.x,y:n.y}}});
  }
  function fit(){
    if(!state.graph)return;
    const g=state.graph,maxX=Math.max(100,...g.nodes.map(n=>Math.abs(n.x)+n.boundRadius+35)),
      maxY=Math.max(100,...g.nodes.map(n=>Math.abs(n.y)+n.boundRadius+35));
    state.view={x:0,y:0,k:Math.min(1.25,($('stage').clientWidth-45)/(maxX*2),($('stage').clientHeight-60)/(maxY*2))};draw();
  }
  function draw(){
    if(state.frame)return;state.frame=requestAnimationFrame(()=>{state.frame=0;paint();});
  }
  function paint(){
    advanceMotion(performance.now());
    const canvas=$('edges'),stage=$('stage'),w=stage.clientWidth,h=stage.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    if(!state.graph)return;
    const v=state.view,ox=w/2+v.x,oy=h/2+v.y,byIndex=new Map(state.graph.nodes.map(n=>[n.index,n]));
    const linked=new Set(state.hover===null?[]:[state.hover]);
    if(state.hover!==null)for(const e of state.graph.edges)if(e.source===state.hover||e.target===state.hover){linked.add(e.source);linked.add(e.target);}
    ctx.translate(ox,oy);ctx.scale(v.k,v.k);ctx.lineWidth=Number($('width').value)/v.k;
    const edgeBatches=new Map();
    for(const edge of state.paintEdges){
      const a=byIndex.get(edge.source),b=byIndex.get(edge.target);
      const alpha=Math.min(a.drawOpacity??1,b.drawOpacity??1)*(state.hover!==null&&edge.source!==state.hover&&edge.target!==state.hover ? .1 : 1);
      const dashed=!Number.isFinite(edge.pmi),key=edge.edgeColor+'|'+dashed+'|'+alpha;
      let batch=edgeBatches.get(key);
      if(!batch){batch={path:new Path2D(),alpha,color:edge.edgeColor,dashed};edgeBatches.set(key,batch);}
      batch.path.moveTo(a.x,a.y);batch.path.lineTo(b.x,b.y);
    }
    for(const batch of edgeBatches.values()){
      ctx.globalAlpha=batch.alpha;ctx.strokeStyle=batch.color;ctx.setLineDash(batch.dashed?[4/v.k,4/v.k]:[]);ctx.stroke(batch.path);
    }
    ctx.globalAlpha=1;
    $('viewport').setAttribute('transform','translate('+ox+','+oy+') scale('+v.k+')');
    const labels=$('labels').value;
    for(const element of $('viewport').children){
      if(element.classList.contains('ghost'))continue;
      const n=byIndex.get(Number(element.dataset.index));
      element.setAttribute('transform','translate('+n.x+','+n.y+')');
      element.style.opacity=String((n.drawOpacity??1)*(state.hover!==null&&!linked.has(n.index)?.2:1));
      element.classList.toggle('dim',state.hover!==null&&!linked.has(n.index));
      element.querySelector('text').style.display=(state.hover!==null?linked.has(n.index):labels==='all'||labels==='important'&&(n.center||state.graph.nodes.indexOf(n)<10))?'':'none';
    }
    if(state.animation)draw();
  }
  function zoom(factor){state.view.k=SemanticCore.clamp(state.view.k*factor,.12,4);draw();}
  function syncControls(){
    $('pmi').disabled=$('pmiSlider').disabled=!$('pmiEnabled').checked;
    $('scoreMax').disabled=$('scoreSlider').disabled=!$('scoreEnabled').checked;
    $('npmiMin').disabled=!$('npmiEnabled').checked;
    $('hideUnpaired').disabled=state.mode!=='word';
    const custom=$('allEdges').value==='custom';
    $('customPeripheral').hidden=!custom;
    $('peripheralSimilarity').disabled=$('peripheralTopK').disabled=!custom;
    const ceiling=state.manifest?.coAreaCeiling||26021095;
    $('coSlider').value=1000*(Math.log1p(Math.max(0,Number($('co').value)))/Math.log1p(ceiling))**(1/1.6);
    const degree=Number($('degree').value);
    $('degreeSlider').value=degree<=100?degree*5:500+500*Math.log(degree/100)/Math.log(4);
    for(const [slider,number] of [['pmiSlider','pmi'],['similaritySlider','similarity'],['scoreSlider','scoreMax']]){
      const value=Number($(number).value);
      $(slider).min=Math.min(Number($(slider).min),value);$(slider).max=Math.max(Number($(slider).max),value);$(slider).value=value;
    }
    for(const [slider,number] of [['coSlider','co'],['degreeSlider','degree']])$(slider).setAttribute('aria-valuetext','实际阈值 '+$(number).value);
  }
  function bind(){
    $('searchForm').onsubmit=e=>{e.preventDefault();const i=ids.get($('search').value.trim());if(i===undefined){message('词表中没有这个词，请选择已有词语。');return;}recenter(i);};
    $('search').oninput=suggestions;
    document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
      state.mode=button.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      $('modeHint').textContent=state.mode==='classifier'?'比较量词的语境相似性。':state.mode==='noun'?'中心搭配遵循 valid_common；外围展示同词类关系。':'合法混合关系；仅探索中心的直接邻居。';
      if(state.mode==='classifier')state.center=state.classifierCenter;
      if(state.mode==='word')state.center=state.wordCenter;
      $('search').value=nodes[state.center].id;
      syncControls();suggestions();void build();
    });
    for(const id of ['limit','co','pmiEnabled','pmi','similarity','includeZero','allEdges','peripheralSimilarity','peripheralTopK','resolution','degree','npmiEnabled','npmiMin','scoreEnabled','scoreMax','hideUnpaired'])$(id).onchange=()=>{syncControls();void build();};
    for(const id of ['co','pmi','similarity','resolution','degree','npmiMin','scoreMax','peripheralSimilarity','peripheralTopK'])$(id).oninput=()=>{syncControls();if($(id).value!==''&&$(id).checkValidity())build();};
    const sliderChange=(id,number,convert)=>$(id).oninput=()=>{$(number).value=convert(Number($(id).value));syncControls();build();};
    sliderChange('coSlider','co',x=>Math.round(Math.expm1(Math.log1p(state.manifest?.coAreaCeiling||26021095)*(x/1000)**1.6)*2)/2);
    sliderChange('degreeSlider','degree',x=>Math.round(x<=500?x/5:100*4**((x-500)/500)));
    sliderChange('pmiSlider','pmi',x=>x);sliderChange('similaritySlider','similarity',x=>x);sliderChange('scoreSlider','scoreMax',x=>x);
    $('legacyFilters').onclick=()=>{
      $('pmiEnabled').checked=true;$('pmi').value=3;$('co').value=30;$('degree').value=3;
      $('similarity').value=0;$('scoreEnabled').checked=false;$('npmiEnabled').checked=false;$('hideUnpaired').checked=true;syncControls();build();
    };
    $('clearFilters').onclick=()=>{
      $('pmiEnabled').checked=$('scoreEnabled').checked=$('npmiEnabled').checked=$('hideUnpaired').checked=false;
      $('co').value=$('degree').value=$('similarity').value=0;$('includeZero').checked=true;syncControls();build();
    };
    $('relayout').onclick=()=>{state.layoutSeed++;state.resetLayout=true;build();};
    $('motion').onchange=()=>{if(!$('motion').checked){stopMotion(true);draw();}};
    $('rankMetric').onchange=()=>{const n=state.graph?.nodes.find(v=>v.index===state.inspected);if(n)inspect(n);};
    $('width').oninput=()=>{$('widthValue').textContent=$('width').value+' px';draw();};
    $('labels').onchange=draw;$('zoomIn').onclick=()=>{stopMotion(true);zoom(1.2);};$('zoomOut').onclick=()=>{stopMotion(true);zoom(1/1.2);};$('fit').onclick=()=>{stopMotion(true);fit();};$('retry').onclick=()=>void build();
    const stage=$('stage');
    stage.addEventListener('wheel',e=>{e.preventDefault();stopMotion(true);zoom(Math.exp(-e.deltaY*.001));},{passive:false});
    stage.addEventListener('pointerdown',e=>{
      if(e.button!==0||state.busy)return;
      stopMotion(false);state.token++;state.relaxing=false;
      const nodeElement=e.target.closest('.node'),node=nodeElement?state.graph.nodes.find(n=>n.index===Number(nodeElement.dataset.index)):null;
      state.drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,node,moved:false};
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove',e=>{
      const d=state.drag;if(!d||d.pointer!==e.pointerId)return;
      const dx=e.clientX-d.lastX,dy=e.clientY-d.lastY;d.lastX=e.clientX;d.lastY=e.clientY;
      d.moved||=Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
      if(d.node&&!d.node.center){d.node.x+=dx/state.view.k;d.node.y+=dy/state.view.k;}
      else{state.view.x+=dx;state.view.y+=dy;}draw();
    });
    const release=e=>{const d=state.drag;if(!d)return;state.drag=null;if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);if(e.type==='pointerup'&&!d.moved&&d.node)recenter(d.node.index);else if(d.moved&&d.node&&!d.node.center)relax(d.node);};
    stage.addEventListener('pointerup',release);stage.addEventListener('pointercancel',release);
    stage.addEventListener('keydown',e=>{if(e.target!==stage)return;const delta={ArrowLeft:[30,0],ArrowRight:[-30,0],ArrowUp:[0,30],ArrowDown:[0,-30]}[e.key];if(delta){e.preventDefault();state.view.x+=delta[0];state.view.y+=delta[1];draw();}if(e.key==='0')fit();});
    new ResizeObserver(draw).observe(stage);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){stopMotion(true);draw();}});
    $('openStar').onclick=()=>{
      stopMotion(true);
      const frame=document.createElement('iframe');frame.title='星图试验视图';frame.src='legacy.html?starEmbed=1&v=20260929-1';state.star=frame;
      frame.onload=()=>{frame.contentWindow.postMessage({type:'semantic-star-open',target:nodes[state.wordCenter].id},location.origin);$('starEscape').hidden=true;frame.focus();};
      $('starEscape').hidden=false;$('starHost').append(frame);$('starHost').hidden=false;document.body.classList.add('star-open');
    };
    const closeStar=()=>{state.star?.remove();state.star=null;$('starHost').hidden=true;document.body.classList.remove('star-open');$('openStar').focus();};
    $('starEscape').onclick=closeStar;
    window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===state.star?.contentWindow&&e.data?.type==='semantic-star-close')closeStar();});
    window.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.star)closeStar();});
    const narrow=matchMedia('(max-width:680px)');
    const panels=()=>{for(const id of ['filterPanel','detailPanel'])$(id).open=!narrow.matches;};
    panels();narrow.addEventListener('change',panels);
    if(matchMedia('(prefers-reduced-motion:reduce)').matches)$('motion').checked=false;
    for(const pmi of [0,3,5,7,10,16]){
      const item=el('span'),line=el('i');line.style.background=SemanticCore.encoding(1,pmi,.5).edgeColor;
      item.append(line,document.createTextNode(String(pmi)));$('pmiLegend').append(item);
    }
    syncControls();
  }
  async function initialize(){
    try{
      const response=await fetch('data/semantic_v2/manifest.json',{cache:'no-store'});
      if(!response.ok)throw Error('完整语境数据仍在准备中。请稍后重新加载；不会使用旧相似性替代。');
      state.manifest=await response.json();if(state.manifest.nodeCount!==nodes.length)throw Error('词表与相似性版本不匹配');
      $('dataDefinition').textContent=fmt(state.manifest.contextCount,0)+' 个完整语境词项；Float64 精度；全局共现面积标尺上限 '+fmt(state.manifest.coAreaCeiling)+ '（全数据最大值，对数压缩）。';
      void build();
    }catch(e){message(e.message,true);}
  }
  window.__SEMANTIC_DEBUG__={snapshot:()=>({mode:state.mode,center:nodes[state.center].id,busy:state.busy,buildCount:state.buildCount,graph:state.graph,view:state.view,config:config()})};
  bind();suggestions();void initialize();
})();
