/* Byte-exact transport only. This module never performs floating-point arithmetic. */
(function(root){
  'use strict';
  const HEADER=48;
  const abort=signal=>{if(signal?.aborted)throw new DOMException('Canceled','AbortError');};
  async function inflate(input,size,signal){
    if(typeof DecompressionStream==='undefined')throw Error('浏览器不支持无损数据解压，请使用新版 Chrome、Edge、Firefox 或 Safari。');
    const reader=new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const result=new Uint8Array(size);let offset=0;
    const cancel=()=>reader.cancel().catch(()=>{});
    signal?.addEventListener('abort',cancel,{once:true});
    try{
      while(true){abort(signal);const {done,value}=await reader.read();abort(signal);if(done)break;
        if(offset+value.length>size)throw Error('解压数据超出预期长度');result.set(value,offset);offset+=value.length;}
      if(offset!==size)throw Error('解压数据长度不匹配');
      return result;
    }finally{signal?.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  async function decode(buffer,manifest,signal){
    abort(signal);
    const n=manifest.nodeCount,half=n*8;
    if(!Number.isInteger(n)||n<1||manifest.rowBytes!==n*16)throw Error('数据定义不匹配');
    if(buffer.byteLength<HEADER||buffer.byteLength>manifest.rowBytes+65536)throw Error('压缩数据长度不合法');
    const bytes=new Uint8Array(buffer),view=new DataView(buffer);
    if(bytes[0]!==83||bytes[1]!==78||bytes[2]!==82||bytes[3]!==49||view.getUint32(4,true)!==n)throw Error('压缩数据版本不匹配');
    const a=view.getUint32(8,true),b=view.getUint32(12,true);
    if(a<20||b<20||HEADER+a+b!==buffer.byteLength)throw Error('压缩数据分段不完整');
    const shuffled=await inflate(bytes.subarray(HEADER,HEADER+a),half,signal);
    const co=await inflate(bytes.subarray(HEADER+a),half,signal);
    const raw=new Uint8Array(n*16);
    for(let j=0;j<8;j++)for(let i=0;i<n;i++)raw[i*8+j]=shuffled[j*n+i];
    raw.set(co,half);abort(signal);
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));abort(signal);
    if(!digest.every((v,i)=>v===bytes[16+i]))throw Error('数据校验失败，请重新加载；不会使用损坏的数据绘图');
    return raw.buffer;
  }
  const api={decode};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SemanticRowCodec=api;
})(typeof self!=='undefined'?self:globalThis);
