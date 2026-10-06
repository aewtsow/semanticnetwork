"""Independent raw-row reconstruction and legacy-metric regression checks."""
import json
import os
from functools import lru_cache
from pathlib import Path
import numpy as np
from scipy import sparse
from prepare_semantic_v2 import BASE, CACHE, OUT, LEGACY, js_data, digest, same_type_matrix

def run():
    manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    nodes=js_data('word_network_nodes.js')
    assert digest(BASE/'data/word_network_nodes.js')==manifest['nodeSHA256']
    assert digest(BASE/'data/classifier_noun_data.js')==manifest['pairSHA256']
    assert len(list((OUT/'rows').glob('*.bin')))==len(nodes)
    assert all(p.stat().st_size==manifest['rowBytes'] for p in (OUT/'rows').glob('*.bin'))
    ids={n['id']:i for i,n in enumerate(nodes)}
    rawptr=np.load(CACHE/'raw_indptr.npy')
    rawval=np.memmap(CACHE/'raw.f64',dtype='<f8',mode='r')
    rawidx=np.memmap(CACHE/'raw.i32',dtype='<i4',mode='r')
    rs=np.load(CACHE/'corpus_rows.npy');cs=np.load(CACHE/'corpus_columns.npy')
    assert rs.sum()==cs.sum()==manifest['contextTotal']
    def vector(i):
        a,b=rawptr[i:i+2];idx=rawidx[a:b];val=rawval[a:b]
        ppmi=np.maximum(0,np.log(val*manifest['contextTotal']/(rs[nodes[i]['vocabIndex']]*cs[idx])))
        norm=np.linalg.norm(ppmi)
        return sparse.csr_matrix((ppmi/norm if norm else ppmi,(np.zeros(len(idx),dtype=int),idx)),shape=(1,len(cs)))
    @lru_cache(maxsize=64)
    def row(i): return np.fromfile(OUT/'rows'/f'{i}.bin',dtype='<f8').reshape(2,-1)
    def co(i,j):
        with (OUT/'rows'/f'{i}.bin').open('rb') as stream:
            stream.seek((len(nodes)+j)*8)
            return np.frombuffer(stream.read(8),dtype='<f8')[0]
    samples=[ids[x] for x in ['一棵','一张','一个','树','客厅','思想']]
    samples+=np.random.default_rng(20260929).choice(len(nodes),18,replace=False).tolist()
    vectors={i:vector(i) for i in samples}
    max_error=0.
    for i in samples:
        data=row(i);assert np.isfinite(data).all();assert (data[0]>=0).all() and (data[0]<=1).all()
        assert abs(data[0,i]-1)<1e-12
        for j in samples:
            direct=float((vectors[i]@vectors[j].T).toarray()[0,0])
            max_error=max(max_error,abs(direct-data[0,j]))
            assert abs(data[0,j]-row(j)[0,i])<1e-12
    assert max_error<1e-10
    by_pair={}
    for p in js_data('classifier_noun_data.js'):
        a,b=ids[p['classifier']],ids[p['word']]
        if a!=b: by_pair[min(a,b),max(a,b)]=p
    largest=0.
    for type_ in ['classifier','noun']:
        subset=np.load(LEGACY/f'{type_}_nodes.npy')
        mat=same_type_matrix(type_+'_sym',len(subset));largest=max(largest,float(mat.data.max()))
        lookup={int(i):j for j,i in enumerate(subset)}
        for i in samples:
            if i not in lookup: continue
            j=lookup[i];data=row(i)
            expected=np.zeros(len(nodes));a,b=mat.indptr[j:j+2];expected[subset[mat.indices[a:b]]]=mat.data[a:b]
            for k in subset:
                if k==i:continue
                p=by_pair.get((min(i,int(k)),max(i,int(k))))
                assert data[1,k]==(p['coOccurrence'] if p else expected[k])
    cross_checks=0
    for (a,b),p in by_pair.items():
        if a not in samples and b not in samples:continue
        assert co(a,b)==co(b,a)==p['coOccurrence'];cross_checks+=1
    report=dict(passed=True,completeRows=len(nodes),contextCount=len(cs),sampleCount=len(samples),
                maxCosineError=max_error,crossChecks=cross_checks,largestCo=largest,
                originalMetricsUnchanged=True)
    dest=BASE/'test_artifacts/semantic_v2';dest.mkdir(parents=True,exist_ok=True)
    (dest/'data-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))

if __name__=='__main__':run()
