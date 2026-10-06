"""Lossless release export. Scientific inputs are read-only; every row is round-tripped.

SNR1: magic(4), nodeCount/u32, simGzipBytes/u32, coGzipBytes/u32,
SHA256(original row)(32), gzip(byte-shuffled cosine f64), gzip(original co f64).
No floating-point conversion, rounding, sparsification or symmetry deduplication.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import gzip
import hashlib
import io
import json
import struct
import tarfile
import time

BASE = Path(__file__).resolve().parent
MAGIC = b'SNR1'
HEADER = struct.Struct('<4sIII32s')


def encode(raw, node_count):
    if len(raw) != node_count * 16:
        raise ValueError('Original row length mismatch')
    half = node_count * 8
    sim = raw[:half]
    shuffled = b''.join(sim[j::8] for j in range(8))
    a = gzip.compress(shuffled, compresslevel=6, mtime=0)
    b = gzip.compress(raw[half:], compresslevel=6, mtime=0)
    return HEADER.pack(MAGIC, node_count, len(a), len(b), hashlib.sha256(raw).digest()) + a + b


def decode(packed, node_count):
    magic, count, a_size, b_size, digest = HEADER.unpack_from(packed)
    if magic != MAGIC or count != node_count or len(packed) != HEADER.size + a_size + b_size:
        raise ValueError('Packed row header mismatch')
    shuffled = gzip.decompress(packed[HEADER.size:HEADER.size+a_size])
    co = gzip.decompress(packed[HEADER.size+a_size:])
    if len(shuffled) != count*8 or len(co) != count*8:
        raise ValueError('Decoded length mismatch')
    sim = bytearray(count*8)
    for j in range(8):
        sim[j::8] = shuffled[j*count:(j+1)*count]
    raw = bytes(sim) + co
    if hashlib.sha256(raw).digest() != digest:
        raise ValueError('Decoded SHA256 mismatch')
    return raw


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(4*1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    pending = path.with_suffix(path.suffix+'.tmp')
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    pending.replace(path)


def package(output, shard_rows=1024, workers=4):
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = BASE/'data/semantic_v2/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    n = manifest['nodeCount']
    if manifest['dtype'] != 'float64-le' or manifest['rowBytes'] != n*16:
        raise ValueError('Unsupported original data format')
    tag = 'semantic-data-v2-lossless-20261006'
    release = dict(schema=1, repository='aewtsow/semanticnetwork', tag=tag,
                   codec='snr1-shuffle-gzip-f64', sourceManifestSHA256=file_sha(manifest_path),
                   manifest=manifest, rows=n, rawBytes=n*n*16, archives=[])
    started = time.perf_counter()
    total_packed = 0
    # At most workers shards in memory; compressed rows are streamed into tar.
    def shard(start):
        stop = min(n, start+shard_rows)
        name = f'rows-{start:05d}-{stop-1:05d}.tar'
        dest = output/name
        meta_path = output/(name+'.json')
        if dest.exists() and meta_path.exists():
            previous = json.loads(meta_path.read_text())
            if (previous.get('sourceManifestSHA256') == release['sourceManifestSHA256']
                    and previous.get('sha256') == file_sha(dest)):
                return previous
            raise ValueError(f'Existing shard differs: {dest}; use a fresh output directory')
        temp = dest.with_suffix('.tar.tmp')
        packed_bytes = 0
        original_rows_digest = hashlib.sha256()
        with tarfile.open(temp, 'w', format=tarfile.USTAR_FORMAT) as archive:
            for i in range(start, stop):
                raw = (BASE/'data/semantic_v2/rows'/f'{i}.bin').read_bytes()
                packed = encode(raw, n)
                if decode(packed, n) != raw:
                    raise ValueError(f'Round-trip mismatch: row {i}')
                original_rows_digest.update(hashlib.sha256(raw).digest())
                member = tarfile.TarInfo(f'{i}.srg')
                member.size = len(packed)
                member.mtime = 0
                member.mode = 0o644
                archive.addfile(member, io.BytesIO(packed))
                packed_bytes += len(packed)
        temp.replace(dest)
        info = dict(name=name, firstRow=start, rowCount=stop-start, bytes=dest.stat().st_size,
                    sha256=file_sha(dest), packedRowBytes=packed_bytes,
                    sourceManifestSHA256=release['sourceManifestSHA256'],
                    originalRowHashesSHA256=original_rows_digest.hexdigest(),
                    verifiedRows=stop-start, byteExact=True)
        atomic_json(meta_path, info)
        print(json.dumps({'shard': name, 'bytes': info['bytes'], 'verifiedRows': stop-start,
                          'elapsedSeconds': round(time.perf_counter()-started, 1)}), flush=True)
        return info
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for item in pool.map(shard, range(0, n, shard_rows)):
            release['archives'].append(item)
            total_packed += item['packedRowBytes']
    release.update(packedRowBytes=total_packed, archiveBytes=sum(x['bytes'] for x in release['archives']),
                   verifiedRows=sum(x['verifiedRows'] for x in release['archives']), byteExact=True)
    atomic_json(output/'release-manifest.json', release)
    print(json.dumps({'complete': True, 'output': str(output), 'rawBytes': release['rawBytes'],
                      'archiveBytes': release['archiveBytes'], 'verifiedRows': release['verifiedRows']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=BASE/'build_cache/release-lossless-20261006')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--shard-rows', type=int, default=1024)
    args = parser.parse_args()
    if not 1 <= args.workers <= 8 or not 1 <= args.shard_rows <= 2048:
        parser.error('workers must be 1–8 and shard-rows must be 1–2048')
    package(args.output.resolve(), args.shard_rows, args.workers)
