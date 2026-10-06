"""Build an isolated static preview from SHA-pinned GitHub Release assets.

No dependencies, tokens, remote computation or production deployment required.
Archives contain individually compressed rows; output never includes raw f64 rows.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
import os
import shutil
import tarfile
import time
import urllib.request
from package_release_data import HEADER, MAGIC, file_sha

BASE = Path(__file__).resolve().parent
RUNTIME_FILES = ['index.html', 'legacy.html', 'app.js', 'style.css', 'workbench.css',
                 'workbench.js', 'semantic-core.js', 'semantic-motion.js', 'semantic-worker.js',
                 'semantic-row-codec.js', 'SEMANTIC_V2.md', 'RESTORE_AUDIT.md', 'RELEASE_DEPLOYMENT.md']


def build(output, local_assets=None):
    if os.environ.get('VERCEL_ENV') == 'production':
        raise RuntimeError('Preview-only branch: refusing a production build. Existing live site stays unchanged.')
    output = output.resolve()
    if output == BASE or BASE not in output.parents:
        raise ValueError('Output must be a new subdirectory of this project')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output is not empty. Use a fresh --output directory; existing files are never deleted.')
    lock = json.loads((BASE/'data/semantic_v2/release-lock.json').read_text(encoding='utf-8'))
    source = BASE/'data/semantic_v2/manifest.json'
    if lock['schema'] != 1 or lock['codec'] != 'snr1-shuffle-gzip-f64' or lock['sourceManifestSHA256'] != file_sha(source):
        raise ValueError('Release lock does not match source data')
    manifest = json.loads(source.read_text(encoding='utf-8'))
    if lock['rows'] != manifest['nodeCount'] or lock['verifiedRows'] != lock['rows'] or not lock['byteExact']:
        raise ValueError('Incomplete release')
    archives = lock['archives']
    expected_first = 0
    for item in archives:
        if item['firstRow'] != expected_first or item['rowCount'] < 1:
            raise ValueError('Release archive ranges must cover all rows exactly once')
        expected_first += item['rowCount']
    if expected_first != lock['rows']:
        raise ValueError('Release row coverage mismatch')
    output.mkdir(parents=True, exist_ok=True)
    for name in RUNTIME_FILES:
        shutil.copy2(BASE/name, output/name)
    shutil.copytree(BASE/'vendor', output/'vendor')
    # Retain all original graph/star assets; omit raw semantic-v2 rows and caches.
    shutil.copytree(BASE/'data', output/'data', ignore=lambda directory,names: ['semantic_v2'] if Path(directory)==BASE/'data' else [])
    destination = output/'data/semantic_v2'
    row_dir = destination/'rows-srg-v1'
    row_dir.mkdir(parents=True)
    download_cache = BASE/'build_cache/release-downloads'/lock['tag']
    if local_assets is None:
        download_cache.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    def unpack(item):
        name = item['name']
        if Path(name).name != name or not name.endswith('.tar'):
            raise ValueError('Unsafe archive name')
        archive = local_assets/name if local_assets else download_cache/name
        if not archive.exists() or archive.stat().st_size != item['bytes'] or file_sha(archive) != item['sha256']:
            if local_assets:
                raise ValueError(f'Local release checksum mismatch: {name}')
            url = f"https://github.com/{lock['repository']}/releases/download/{lock['tag']}/{name}"
            pending = archive.with_suffix('.tar.tmp')
            for attempt in range(3):
                try:
                    digest = hashlib.sha256()
                    size = 0
                    request = urllib.request.Request(url, headers={'User-Agent':'semantic-network-release-builder'})
                    with urllib.request.urlopen(request, timeout=120) as response, pending.open('wb') as dest:
                        for block in iter(lambda: response.read(1024*1024), b''):
                            size += len(block)
                            if size > item['bytes']:
                                raise ValueError(f'Download exceeds pinned size: {name}')
                            digest.update(block)
                            dest.write(block)
                    if size != item['bytes'] or digest.hexdigest() != item['sha256']:
                        raise ValueError(f'Download checksum mismatch: {name}')
                    pending.replace(archive)
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(2**attempt)
        expected = set(range(item['firstRow'],item['firstRow']+item['rowCount']))
        hashes = {}
        with tarfile.open(archive, 'r:') as bundle:
            for member in bundle:
                # No extractall: reject paths, duplicates, symlinks, devices and oversized entries.
                stem = member.name.removesuffix('.srg')
                if not member.isfile() or member.name != stem+'.srg' or not stem.isdecimal():
                    raise ValueError('Unsafe row archive entry')
                index = int(stem)
                if member.name != f'{index}.srg' or index not in expected or not HEADER.size <= member.size <= manifest['rowBytes']+65536:
                    raise ValueError('Unexpected or duplicate row')
                packed = bundle.extractfile(member).read()
                magic,count,a,b,digest = HEADER.unpack_from(packed)
                if magic != MAGIC or count != manifest['nodeCount'] or len(packed) != HEADER.size+a+b:
                    raise ValueError('Packed row format mismatch')
                hashes[index] = digest
                (row_dir/member.name).write_bytes(packed)
                expected.remove(index)
        if expected or hashlib.sha256(b''.join(hashes[i] for i in sorted(hashes))).hexdigest() != item['originalRowHashesSHA256']:
            raise ValueError('Original row hash coverage mismatch')
        print(json.dumps({'installed': name, 'rows': item['rowCount'], 'elapsedSeconds': round(time.perf_counter()-started,1)}),flush=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(unpack, archives))
    manifest['rowsURL'] = 'rows-srg-v1/{index}.srg'
    manifest['transport'] = dict(codec=lock['codec'], version=lock['tag'], byteExact=True, rawDtype='float64-le')
    (destination/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
    report = dict(sourceVersion=manifest['version'], release=lock['tag'], rowCount=lock['rows'],
                  packedBytes=lock['packedRowBytes'], rawBytes=lock['rawBytes'], byteExact=True, previewOnly=True)
    (output/'release-build.json').write_text(json.dumps(report,indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'complete': True, 'output': str(output), **report}),flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=BASE/'public')
    parser.add_argument('--local-assets', type=Path)
    args = parser.parse_args()
    build(args.output, args.local_assets.resolve() if args.local_assets else None)
