"""从已流式抽取的 valid-word 子矩阵构建三类完整关系缓存。"""

from pathlib import Path
import json
import math

import numpy as np
import pandas as pd
from scipy import sparse


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parents[1]
CACHE_DIR = BASE_DIR / "build_cache" / "word_network_full"
VALID_PATH = BASE_DIR.parent / "valid_common.xlsx"
GLOBAL_STATS_PATH = PROJECT_DIR / "Data" / "global_stats_full_forms.npz"


def load_csr(prefix, shape):
    data = np.load(CACHE_DIR / f"{prefix}_data.npy", mmap_mode="r")
    indices = np.load(CACHE_DIR / f"{prefix}_indices.npy", mmap_mode="r")
    indptr = np.load(CACHE_DIR / f"{prefix}_indptr.npy", mmap_mode="r")
    return sparse.csr_matrix((data, indices, indptr), shape=shape, copy=False)


def save_csr(prefix, matrix):
    matrix = matrix.tocsr()
    matrix.sort_indices()
    np.save(CACHE_DIR / f"{prefix}_data.npy", matrix.data)
    np.save(CACHE_DIR / f"{prefix}_indices.npy", matrix.indices.astype(np.int32, copy=False))
    np.save(CACHE_DIR / f"{prefix}_indptr.npy", matrix.indptr.astype(np.int64, copy=False))


def count_metric_thresholds(matrix, frequencies, total, upper_only):
    positive_pmi = 0
    community_default = 0
    for row in range(matrix.shape[0]):
        start, stop = matrix.indptr[row:row + 2]
        targets = matrix.indices[start:stop]
        co = matrix.data[start:stop]
        if upper_only:
            keep = targets > row
            targets = targets[keep]
            co = co[keep]
        if not len(co):
            continue
        pmi = (
            math.log(total) + np.log(co)
            - math.log(frequencies[row]) - np.log(frequencies[targets])
        )
        positive_pmi += int(np.count_nonzero(pmi > 0))
        community_default += int(np.count_nonzero((pmi >= 3.0) & (co >= 30.0)))
    return positive_pmi, community_default


def count_cross_thresholds(matrix, classifier_freq, noun_freq, total):
    positive_pmi = 0
    community_default = 0
    for row in range(matrix.shape[0]):
        start, stop = matrix.indptr[row:row + 2]
        targets = matrix.indices[start:stop]
        co = matrix.data[start:stop]
        if not len(co):
            continue
        pmi = (
            math.log(total) + np.log(co)
            - math.log(classifier_freq[row]) - np.log(noun_freq[targets])
        )
        positive_pmi += int(np.count_nonzero(pmi > 0))
        community_default += int(np.count_nonzero((pmi >= 3.0) & (co >= 30.0)))
    return positive_pmi, community_default


def main():
    valid_words = json.loads((CACHE_DIR / "valid_words.json").read_text(encoding="utf-8"))
    valid_common = pd.read_excel(VALID_PATH, usecols=["classifier", "word"])
    classifier_set = set(valid_common["classifier"].astype(str))
    primary_classifier = np.array([word in classifier_set for word in valid_words])
    classifier_nodes = np.flatnonzero(primary_classifier)
    noun_nodes = np.flatnonzero(~primary_classifier)

    indptr = np.load(CACHE_DIR / "indptr.npy", mmap_mode="r")
    targets = np.memmap(CACHE_DIR / "targets.i32", dtype="<i4", mode="r")
    co = np.memmap(CACHE_DIR / "co.f64", dtype="<f8", mode="r")
    node_count = len(valid_words)
    selected = sparse.csr_matrix(
        (co, targets, indptr), shape=(node_count, node_count), copy=False
    )

    print("构建 classifier→noun 稀疏关系…", flush=True)
    classifier_noun = selected[classifier_nodes][:, noun_nodes].tocsr()
    classifier_noun.eliminate_zeros()

    print("构建 classifier↔classifier 双向平均关系…", flush=True)
    classifier_raw = selected[classifier_nodes][:, classifier_nodes].tocsr()
    classifier_sym = (classifier_raw + classifier_raw.T).tocsr()
    classifier_sym.data *= 0.5
    classifier_sym.setdiag(0)
    classifier_sym.eliminate_zeros()

    print("构建 noun↔noun 双向平均关系…", flush=True)
    noun_raw = selected[noun_nodes][:, noun_nodes].tocsr()
    noun_sym = (noun_raw + noun_raw.T).tocsr()
    noun_sym.data *= 0.5
    noun_sym.setdiag(0)
    noun_sym.eliminate_zeros()

    save_csr("classifier_noun", classifier_noun)
    save_csr("classifier_sym", classifier_sym)
    save_csr("noun_sym", noun_sym)
    np.save(CACHE_DIR / "classifier_nodes.npy", classifier_nodes.astype(np.int32))
    np.save(CACHE_DIR / "noun_nodes.npy", noun_nodes.astype(np.int32))

    row_sums = np.load(CACHE_DIR / "row_sums.npy")
    selected_global = np.load(CACHE_DIR / "selected_global.npy")
    with np.load(GLOBAL_STATS_PATH, allow_pickle=False) as stats:
        column_sums = stats["word_counts"].astype(np.float64, copy=False)
        total = float(stats["N"])
    selected_columns = column_sums[selected_global]
    sym_frequency = (row_sums + selected_columns) / 2.0
    np.save(CACHE_DIR / "column_sums.npy", selected_columns)
    np.save(CACHE_DIR / "sym_frequency.npy", sym_frequency)

    cc_positive, cc_default = count_metric_thresholds(
        classifier_sym, sym_frequency[classifier_nodes], total, upper_only=True
    )
    nn_positive, nn_default = count_metric_thresholds(
        noun_sym, sym_frequency[noun_nodes], total, upper_only=True
    )
    cn_positive, cn_default = count_cross_thresholds(
        classifier_noun,
        row_sums[classifier_nodes],
        selected_columns[noun_nodes],
        total,
    )

    classifier_noun_count = int(classifier_noun.nnz)
    classifier_classifier_count = int(classifier_sym.nnz // 2)
    noun_noun_count = int(noun_sym.nnz // 2)
    full_degree = np.zeros(node_count, dtype=np.int32)
    full_degree[classifier_nodes] = (
        classifier_sym.getnnz(axis=1) + classifier_noun.getnnz(axis=1)
    )
    full_degree[noun_nodes] = (
        noun_sym.getnnz(axis=1) + classifier_noun.getnnz(axis=0)
    )
    np.save(CACHE_DIR / "full_degree.npy", full_degree)

    report = {
        "classifierNounEdgeCount": classifier_noun_count,
        "nounNounEdgeCount": noun_noun_count,
        "classifierClassifierEdgeCount": classifier_classifier_count,
        "totalUniqueEdgeCount": (
            classifier_noun_count + noun_noun_count + classifier_classifier_count
        ),
        "positivePmiEdgeCount": cn_positive + nn_positive + cc_positive,
        "defaultCommunityEdgeCountBeforeDegreePrune": cn_default + nn_default + cc_default,
        "relationPositivePmiCounts": {
            "classifier_noun": cn_positive,
            "noun_noun": nn_positive,
            "classifier_classifier": cc_positive,
        },
        "relationDefaultCommunityCounts": {
            "classifier_noun": cn_default,
            "noun_noun": nn_default,
            "classifier_classifier": cc_default,
        },
        "maximumFullDegree": int(full_degree.max()),
        "top400AdjacencyRecordCount": int(np.minimum(full_degree, 400).sum()),
        "total": total,
    }
    (CACHE_DIR / "mixed_relation_profile.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
