"""Exact full-context PPMI cosine, isolated from the legacy/star-map data.

Run with --all for all rows, or --centers 客厅 树 for a resumable preview.
No original corpus, legacy data, or legacy cache is modified.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import time
import zipfile

import numpy as np
from scipy import sparse
from prepare_word_network import read_npy_header, read_array_values

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
SOURCE = ROOT / 'Data' / 'cor_m_sum.npz'
CACHE = BASE / 'build_cache' / 'semantic_v2'
OUT = BASE / 'data' / 'semantic_v2'
LEGACY = BASE / 'build_cache' / 'word_network_full'
VERSION = 'ppmi-full-context-v2-20260929'


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    for attempt in range(30):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            # Dropbox/antivirus may momentarily hold the destination on Windows.
            if attempt == 29:
                if path.name == 'progress.json': return
                raise
            time.sleep(.2)


def js_data(name):
    text = (BASE / 'data' / name).read_text(encoding='utf-8')
    return json.loads(text[text.index('=') + 1:].strip().removesuffix(';'))


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def progress(stage, **kwargs):
    atomic_json(OUT / 'progress.json', dict(stage=stage, updated=time.time(), **kwargs))
    print(stage, kwargs, flush=True)


def corpus_cache(selected):
    """One sequential pass over ALL corpus cells for genuine context marginals."""
    marker = CACHE / 'corpus.json'
    fingerprint = dict(size=SOURCE.stat().st_size, mtimeNs=SOURCE.stat().st_mtime_ns)
    if marker.exists():
        meta = json.loads(marker.read_text(encoding='utf-8'))
        if meta['sourceStat'] != fingerprint:
            raise ValueError('Corpus changed: use a new version/cache directory; never mix versions.')
        return meta
    progress('corpus-marginals', message='流式统计完整语境；此阶段中断后重新顺序读取，后续阶段可续算')
    source_hash = digest(SOURCE)
    with np.load(SOURCE, allow_pickle=False) as archive:
        ptr = archive['indptr'].astype(np.int64)
        shape = archive['shape'].astype(int).tolist()
    row_sums = np.zeros(shape[0], dtype=np.float64)
    col_sums = np.zeros(shape[1], dtype=np.float64)
    valid_ptr = np.zeros(len(selected) + 1, dtype=np.int64)
    local_by_global = {int(global_i): i for i, global_i in enumerate(selected)}
    kept = 0
    with zipfile.ZipFile(SOURCE) as archive, archive.open('data.npy') as ds, archive.open('indices.npy') as ix, (CACHE/'raw.f64').open('wb') as values_out, (CACHE/'raw.i32').open('wb') as indices_out:
        count, dtype = read_npy_header(ds)
        _, index_dtype = read_npy_header(ix)
        for start in range(0, shape[0], 256):
            stop = min(start + 256, shape[0])
            length = int(ptr[stop] - ptr[start])
            values = read_array_values(ds, length, dtype).astype(np.float64, copy=False)
            indices = read_array_values(ix, length, index_dtype)
            if np.any(values < 0) or not np.isfinite(values).all():
                raise ValueError('Negative/nonfinite corpus count')
            col_sums += np.bincount(indices, weights=values, minlength=shape[1])
            for row in range(start, stop):
                a, b = ptr[row:row+2] - ptr[start]
                row_sums[row] = values[a:b].sum()
                if row in local_by_global:
                    local = local_by_global[row]
                    values_out.write(values[a:b].astype('<f8', copy=False).tobytes())
                    indices_out.write(indices[a:b].astype('<i4', copy=False).tobytes())
                    kept += int(b-a)
                    valid_ptr[local+1] = kept
            if start % 4096 == 0:
                progress('corpus-marginals', rows=stop, totalRows=shape[0])
    np.save(CACHE/'corpus_rows.npy', row_sums)
    np.save(CACHE/'corpus_columns.npy', col_sums)
    np.save(CACHE/'raw_indptr.npy', valid_ptr)
    meta = dict(sourceStat=fingerprint, sourceSHA256=source_hash, shape=shape,
                nnz=count, selectedNNZ=kept, contextTotal=float(row_sums.sum()))
    atomic_json(marker, meta)
    return meta


def make_ppmi(selected, meta):
    marker = CACHE / 'ppmi.json'
    if not marker.exists():
        progress('ppmi', message='完整语境 PPMI 与 L2 归一化；不做降维')
        ptr = np.load(CACHE/'raw_indptr.npy')
        indices = np.memmap(CACHE/'raw.i32', mode='r', dtype='<i4')
        values = np.memmap(CACHE/'raw.f64', mode='r', dtype='<f8')
        rows = np.load(CACHE/'corpus_rows.npy')[selected]
        cols = np.load(CACHE/'corpus_columns.npy')
        outptr = np.zeros(len(selected)+1, dtype=np.int64)
        zero_rows = []
        with (CACHE/'ppmi.f64').open('wb') as vs, (CACHE/'ppmi.i32').open('wb') as ids:
            for i in range(len(selected)):
                a,b = ptr[i:i+2]
                c = values[a:b]
                j = indices[a:b]
                valid = (c > 0) & (cols[j] > 0) & (rows[i] > 0)
                j, c = j[valid], c[valid]
                p = np.maximum(0, np.log(c) + np.log(meta['contextTotal']) - np.log(rows[i]) - np.log(cols[j]))
                positive = p > 0
                j, p = j[positive], p[positive]
                norm = np.linalg.norm(p)
                if norm:
                    p /= norm
                else:
                    zero_rows.append(i)
                order = np.argsort(j)
                ids.write(j[order].astype('<i4').tobytes())
                vs.write(p[order].astype('<f8').tobytes())
                outptr[i+1] = outptr[i]+len(p)
        np.save(CACHE/'ppmi_indptr.npy', outptr)
        atomic_json(marker, dict(nnz=int(outptr[-1]), zeroRows=zero_rows))
    return sparse.csr_matrix((np.memmap(CACHE/'ppmi.f64', mode='r', dtype='<f8'),
                              np.memmap(CACHE/'ppmi.i32', mode='r', dtype='<i4'),
                              np.load(CACHE/'ppmi_indptr.npy')), shape=(len(selected), meta['shape'][1]), copy=False)


def same_type_matrix(prefix, size):
    return sparse.csr_matrix((np.load(LEGACY/f'{prefix}_data.npy', mmap_mode='r'),
                              np.load(LEGACY/f'{prefix}_indices.npy', mmap_mode='r'),
                              np.load(LEGACY/f'{prefix}_indptr.npy', mmap_mode='r')),
                             shape=(size,size), copy=False)


def build(args):
    CACHE.mkdir(parents=True, exist_ok=True)
    (OUT/'rows').mkdir(parents=True, exist_ok=True)
    existing_manifest=OUT/'manifest.json'
    if existing_manifest.exists():
        previous=json.loads(existing_manifest.read_text(encoding='utf-8'))
        if (previous['version']!=VERSION
                or previous['nodeSHA256']!=digest(BASE/'data/word_network_nodes.js')
                or previous['pairSHA256']!=digest(BASE/'data/classifier_noun_data.js')):
            raise ValueError('Vocabulary/pairs/version changed: use a new version directory, not existing rows.')
    nodes = js_data('word_network_nodes.js')
    selected = np.array([n['vocabIndex'] for n in nodes], dtype=np.int64)
    if np.any(np.diff(selected) <= 0):
        raise ValueError('Node order must match ordered corpus rows')
    node_ids = {n['id']: i for i,n in enumerate(nodes)}
    meta = corpus_cache(selected)
    matrix = make_ppmi(selected, meta)
    pairs = js_data('classifier_noun_data.js')
    cross = [[] for _ in nodes]
    for p in pairs:
        a,b = node_ids[p['classifier']],node_ids[p['word']]
        if a != b:
            cross[a].append((b,p['coOccurrence']))
            cross[b].append((a,p['coOccurrence']))
    classifier_indices = np.load(LEGACY/'classifier_nodes.npy')
    noun_indices = np.load(LEGACY/'noun_nodes.npy')
    matrices = [(classifier_indices, same_type_matrix('classifier_sym',len(classifier_indices))),
                (noun_indices, same_type_matrix('noun_sym',len(noun_indices)))]
    lookup = {int(i):(ids,mat,r) for ids,mat in matrices for r,i in enumerate(ids)}
    # Fixed log scale: use the actual global maximum, not a percentile cap
    # that would make many frequent neighbors equal-sized. Scan mmap blocks.
    co_scale = max(1, max(p['coOccurrence'] for p in pairs))
    for _, mat in matrices:
        for offset in range(0,len(mat.data),1000000):
            co_scale = max(co_scale,float(mat.data[offset:offset+1000000].max(initial=0)))
    legacy_manifest=js_data('word_network_edges.js')
    ppmi_meta=json.loads((CACHE/'ppmi.json').read_text())
    manifest=dict(version=VERSION, nodeCount=len(nodes), contextCount=meta['shape'][1],
                  sourceSHA256=meta['sourceSHA256'], nodeSHA256=digest(BASE/'data/word_network_nodes.js'),
                  pairSHA256=digest(BASE/'data/classifier_noun_data.js'),
                  contextTotal=meta['contextTotal'], legacyPMITotal=legacy_manifest['symmetricTotal'],
                  method='full-context PPMI, L2-normalized rows, exact sparse dot product',
                  definition='PPMI(i,c)=max(0,ln(A[i,c]*sum(A)/(rowSum[i]*colSum[c])))',
                  approximation=False,dtype='float64-le',rowLayout=['cosine[nodeCount]','coOccurrence[nodeCount]'],
                  rowBytes=len(nodes)*16,coAreaCeiling=co_scale,zeroRows=ppmi_meta['zeroRows'],
                  sourceMarginals='complete original directed matrix, including diagonal',
                  coPolicy='same-type symmetric mean; valid_common directed pairs override',
                  rowsURL='rows/{index}.bin')
    atomic_json(OUT/'manifest.json',manifest)
    start=time.perf_counter()
    done={int(p.stem) for p in (OUT/'rows').glob('*.bin') if p.stat().st_size==manifest['rowBytes']}
    centers=[node_ids[x] for x in args.centers]
    priority=list(dict.fromkeys(centers+classifier_indices.tolist()))
    todo=priority+([i for i in range(len(nodes)) if i not in set(priority)] if args.all else [])
    # Transpose is a zero-copy CSC view, not a second materialized matrix.
    transpose=matrix.T
    def compute(indices):
        for offset in range(0,len(indices),args.block):
            batch=[i for i in indices[offset:offset+args.block] if i not in done]
            if not batch: continue
            sims=(matrix[batch] @ transpose).toarray()
            np.clip(sims,0,1,out=sims)
            for i,sim in zip(batch,sims):
                co=np.zeros(len(nodes),dtype='<f8')
                ids,mat,r=lookup[i]
                a,b=mat.indptr[r:r+2]
                co[ids[mat.indices[a:b]]]=mat.data[a:b]
                for j,value in cross[i]: co[j]=value
                co[i]=0
                dest=OUT/'rows'/f'{i}.bin'
                temp=dest.with_suffix('.tmp')
                with temp.open('wb') as f:
                    f.write(sim.astype('<f8',copy=False).tobytes())
                    f.write(co.tobytes())
                temp.replace(dest)
                done.add(i)
            progress('cosine', completed=len(done),total=len(nodes),elapsedSeconds=round(time.perf_counter()-start,1))
    compute(priority)
    # Prioritize the full 400-neighbor acceptance samples before the remaining rows.
    neighbors=[]
    for i in centers:
        sim=np.fromfile(OUT/'rows'/f'{i}.bin',dtype='<f8',count=len(nodes))
        allowed=np.array([n['type']==nodes[i]['type'] for n in nodes])
        for j,_ in cross[i]: allowed[j]=True
        allowed[i]=False
        order=np.argsort(-sim,kind='stable')
        neighbors.extend(order[allowed[order]][:400].tolist())
    compute(list(dict.fromkeys(neighbors)))
    if args.all: compute(todo)
    progress('complete' if len(done)==len(nodes) else 'partial',completed=len(done),total=len(nodes),
             message='已有行均为精确结果；未生成的行不可用，不退回旧相似性')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all',action='store_true')
    parser.add_argument('--centers',nargs='+',default=['一棵','一张','一个','树','客厅','思想'])
    parser.add_argument('--block',type=int,default=16)
    args=parser.parse_args()
    if not 1<=args.block<=128: parser.error('--block must be 1..128')
    CACHE.mkdir(parents=True,exist_ok=True)
    lock=CACHE/'build.lock'
    try:
        descriptor=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError:
        raise SystemExit('Another build may be running. Inspect build.lock/PID before removing a stale lock.')
    os.write(descriptor,str(os.getpid()).encode());os.close(descriptor)
    try:
        build(args)
    finally:
        lock.unlink(missing_ok=True)
