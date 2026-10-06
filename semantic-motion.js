/* Worker force frames are replayed here; no perpetual decorative motion. */
(function(root){
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  function create(nodes,frames,previous=[]){
    const old=new Map(previous.map(n=>[n.index,n])),anchor=old.get(nodes[0]?.index);
    const first=frames[0]||Float32Array.from(nodes.flatMap(n=>[n.x,n.y]));
    const starts=nodes.map((n,i)=>old.get(n.index)||{
      x:(anchor?.x||0)+first[i*2]*.45,y:(anchor?.y||0)+first[i*2+1]*.45});
    return {indices:nodes.map(n=>n.index),frames:frames.length?frames:[first],
      starts,isNew:nodes.map(n=>!old.has(n.index)),hasPrevious:previous.length>0};
  }
  function sample(plan,t){
    const p=ease(t),frame=t*(plan.frames.length-1),a=Math.floor(frame),b=Math.min(a+1,plan.frames.length-1),u=frame-a;
    const positions=new Float32Array(plan.indices.length*2),opacity=new Float32Array(plan.indices.length);
    for(let i=0;i<plan.indices.length;i++){
      const x=plan.frames[a][i*2]*(1-u)+plan.frames[b][i*2]*u,y=plan.frames[a][i*2+1]*(1-u)+plan.frames[b][i*2+1]*u;
      positions[i*2]=plan.starts[i].x*(1-p)+x*p;positions[i*2+1]=plan.starts[i].y*(1-p)+y*p;
      opacity[i]=plan.isNew[i]?ease(t*1.6):1;
    }
    return {positions,opacity,eased:p};
  }
  root.SemanticMotion={create,sample,ease};
  if(typeof module!=='undefined')module.exports=root.SemanticMotion;
})(typeof self!=='undefined'?self:globalThis);
