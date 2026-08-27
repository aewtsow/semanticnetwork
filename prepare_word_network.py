"""按三类词性关系生成完整统计与浏览器 Top-400 词汇网络数据。"""

from pathlib import Path
import json
import math
import sys
import zipfile

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse import csgraph

import build_symmetric_cache


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parents[1]
VALID_COMMON_PATH = BASE_DIR.parent / "valid_common.xlsx"
VOCAB_PATH = PROJECT_DIR / "Data" / "voc_list.txt"
MATRIX_PATH = PROJECT_DIR / "Data" / "cor_m_sum.npz"
GLOBAL_STATS_PATH = PROJECT_DIR / "Data" / "global_stats_full_forms.npz"
CLASSIFIER_MATRIX_PATH = PROJECT_DIR / "Data" / "cor_m_classifier_full_forms.npz"
CLASSIFIER_NAMES_PATH = PROJECT_DIR / "Data" / "valid_classifier_full_forms.txt"
DATA_DIR = BASE_DIR / "data"
EDGE_DIR = DATA_DIR / "word_network_edges"
CACHE_DIR = BASE_DIR / "build_cache" / "word_network_full"

REQUIRED_COLUMNS = [
    "classifier", "word", "co_occurrence", "PMI", "NPMI",
    "NPMI_log_co_score",
]
TOP_K = 400
CHUNK_SOURCE_COUNT = 256
DEFAULT_PMI_THRESHOLD = 3.0
DEFAULT_CO_THRESHOLD = 30.0
DEFAULT_DEGREE_THRESHOLD = 3
FLOAT_TOLERANCE = 1e-9


def write_js(path, variable_name, value, source_note):
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    path.write_text(
        f"// {source_note}\nwindow.{variable_name} = {payload};\n",
        encoding="utf-8",
    )


def load_sparse_csr(path):
    with np.load(path, allow_pickle=False) as loader:
        return sparse.csr_matrix(
            (loader["data"], loader["indices"], loader["indptr"]),
            shape=tuple(int(value) for value in loader["shape"]),
        )


def read_npy_header(stream):
    version = np.lib.format.read_magic(stream)
    if version == (1, 0):
        shape, fortran_order, dtype = np.lib.format.read_array_header_1_0(stream)
    else:
        shape, fortran_order, dtype = np.lib.format.read_array_header_2_0(stream)
    if fortran_order or len(shape) != 1:
        raise ValueError("只支持一维 C-order CSR 数组。")
    return int(shape[0]), np.dtype(dtype)


def skip_bytes(stream, byte_count):
    remaining = int(byte_count)
    while remaining:
        block = stream.read(min(remaining, 16 * 1024 * 1024))
        if not block:
            raise EOFError("跳过 NPZ 数组时提前到达文件末尾。")
        remaining -= len(block)


def read_array_values(stream, count, dtype):
    result = np.empty(int(count), dtype=dtype)
    view = memoryview(result).cast("B")
    offset = 0
    while offset < len(view):
        read_count = stream.readinto(view[offset:])
        if not read_count:
            raise EOFError("读取 NPZ 数组时提前到达文件末尾。")
        offset += read_count
    return result


def extract_valid_submatrix(valid_common, vocab):
    """顺序解压原始 CSR，仅缓存 valid_words 行列，保留全部正共现。"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    classifier_set = set(valid_common["classifier"].astype(str))
    noun_set = set(valid_common["word"].astype(str))
    valid_set = classifier_set | noun_set
    selected_global = np.array(
        [index for index, word in enumerate(vocab) if word in valid_set], dtype=np.int64
    )
    valid_words = [vocab[index] for index in selected_global]
    global_to_local = np.full(len(vocab), -1, dtype=np.int32)
    global_to_local[selected_global] = np.arange(len(valid_words), dtype=np.int32)

    with np.load(MATRIX_PATH, allow_pickle=False) as loader:
        full_indptr = loader["indptr"].astype(np.int64, copy=False)
        matrix_shape = tuple(int(value) for value in loader["shape"])
    if matrix_shape != (len(vocab), len(vocab)):
        raise ValueError("矩阵 shape 与 vocabulary 长度不一致。")

    indptr = np.zeros(len(valid_words) + 1, dtype=np.int64)
    row_sums = np.zeros(len(valid_words), dtype=np.float64)
    current_position = 0
    kept = 0
    with zipfile.ZipFile(MATRIX_PATH) as archive:
        with (
            archive.open("indices.npy") as index_stream,
            archive.open("data.npy") as data_stream,
            (CACHE_DIR / "targets.i32").open("wb") as target_output,
            (CACHE_DIR / "co.f64").open("wb") as co_output,
        ):
            index_length, index_dtype = read_npy_header(index_stream)
            data_length, data_dtype = read_npy_header(data_stream)
            if index_length != data_length or index_length != int(full_indptr[-1]):
                raise ValueError("CSR data、indices 与 indptr 长度不一致。")
            for local_row, global_row in enumerate(selected_global):
                start = int(full_indptr[global_row])
                stop = int(full_indptr[global_row + 1])
                gap = start - current_position
                skip_bytes(index_stream, gap * index_dtype.itemsize)
                skip_bytes(data_stream, gap * data_dtype.itemsize)
                count = stop - start
                global_targets = read_array_values(index_stream, count, index_dtype)
                co_values = read_array_values(data_stream, count, data_dtype).astype(
                    np.float64, copy=False
                )
                current_position = stop
                row_sums[local_row] = float(co_values.sum())
                local_targets = global_to_local[global_targets]
                keep = (local_targets >= 0) & (local_targets != local_row) & (co_values > 0)
                kept_targets = local_targets[keep].astype("<i4", copy=False)
                kept_co = co_values[keep].astype("<f8", copy=False)
                target_output.write(kept_targets.tobytes())
                co_output.write(kept_co.tobytes())
                kept += len(kept_targets)
                indptr[local_row + 1] = kept
                if (local_row + 1) % 500 == 0 or local_row + 1 == len(valid_words):
                    print(
                        f"已抽取 {local_row + 1:,}/{len(valid_words):,} 行；"
                        f"valid 子矩阵非零项 {kept:,}", flush=True,
                    )

    np.save(CACHE_DIR / "indptr.npy", indptr)
    np.save(CACHE_DIR / "row_sums.npy", row_sums)
    np.save(CACHE_DIR / "selected_global.npy", selected_global)
    (CACHE_DIR / "valid_words.json").write_text(
        json.dumps(valid_words, ensure_ascii=False), encoding="utf-8"
    )
    metadata = {
        "matrixShape": list(matrix_shape),
        "matrixNnz": int(full_indptr[-1]),
        "validWordCount": len(valid_words),
        "classifierCount": len(classifier_set),
        "nounCount": len(noun_set),
        "overlapCount": len(classifier_set & noun_set),
        "submatrixDirectedNnzExcludingDiagonal": int(kept),
    }
    (CACHE_DIR / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def ensure_caches(valid_common, vocab):
    required_base = [
        "targets.i32", "co.f64", "indptr.npy", "row_sums.npy",
        "selected_global.npy", "valid_words.json", "metadata.json",
    ]
    if not all((CACHE_DIR / filename).exists() for filename in required_base):
        extract_valid_submatrix(valid_common, vocab)
    required_relations = [
        "classifier_noun_data.npy", "classifier_sym_data.npy", "noun_sym_data.npy",
        "classifier_nodes.npy", "noun_nodes.npy", "mixed_relation_profile.json",
        "full_degree.npy", "column_sums.npy", "sym_frequency.npy",
    ]
    if not all((CACHE_DIR / filename).exists() for filename in required_relations):
        build_symmetric_cache.main()


def load_csr(prefix, shape):
    data = np.load(CACHE_DIR / f"{prefix}_data.npy", mmap_mode="r")
    indices = np.load(CACHE_DIR / f"{prefix}_indices.npy", mmap_mode="r")
    indptr = np.load(CACHE_DIR / f"{prefix}_indptr.npy", mmap_mode="r")
    return sparse.csr_matrix((data, indices, indptr), shape=shape, copy=False)


def metric_arrays(co, source_frequency, target_frequency, total):
    pmi = (
        math.log(total) + np.log(co)
        - np.log(source_frequency) - np.log(target_frequency)
    )
    npmi = pmi / -np.log(co / total)
    return pmi, npmi, npmi * np.log(co)


def validate_classifier_direction(
    valid_common, selected, local_index, vocab_index, row_sums, column_sums, total
):
    rows = np.array([local_index[word] for word in valid_common["classifier"]])
    columns = np.array([local_index[word] for word in valid_common["word"]])
    co = np.asarray(selected[rows, columns]).ravel().astype(float)
    self_pair = (
        valid_common["classifier"].astype(str).to_numpy()
        == valid_common["word"].astype(str).to_numpy()
    )
    if np.any(self_pair):
        classifier_matrix = load_sparse_csr(CLASSIFIER_MATRIX_PATH)
        classifier_names = pd.read_csv(
            CLASSIFIER_NAMES_PATH, header=None, usecols=[0]
        )[0].astype(str).tolist()
        classifier_index = {word: index for index, word in enumerate(classifier_names)}
        for pair_index in np.flatnonzero(self_pair):
            classifier = str(valid_common.iloc[pair_index]["classifier"])
            # 量词行矩阵列仍按完整 vocabulary 排列。
            co[pair_index] = float(classifier_matrix[
                classifier_index[classifier],
                vocab_index[classifier],
            ])
    pmi, npmi, score = metric_arrays(
        co, row_sums[rows], column_sums[columns], total
    )
    calculated = {
        "co_occurrence": co, "PMI": pmi, "NPMI": npmi,
        "NPMI_log_co_score": score,
    }
    metric_report = {}
    error_columns = []
    for column, values in calculated.items():
        expected = valid_common[column].to_numpy(dtype=float)
        errors = np.abs(values - expected)
        error_columns.append(errors)
        metric_report[column] = {
            "matchingCount": int(np.count_nonzero(errors <= FLOAT_TOLERANCE)),
            "maxAbsoluteError": float(errors.max()),
            "meanAbsoluteError": float(errors.mean()),
            "medianAbsoluteError": float(np.median(errors)),
            "p99AbsoluteError": float(np.quantile(errors, 0.99)),
        }
    all_errors = np.maximum.reduce(error_columns)
    worst = []
    for index in np.argsort(all_errors)[-20:][::-1]:
        row = valid_common.iloc[index]
        worst.append({
            "classifier": str(row["classifier"]), "word": str(row["word"]),
            "matrixCoOccurrence": float(co[index]),
            "excelCoOccurrence": float(row["co_occurrence"]),
            "calculatedPMI": float(pmi[index]), "excelPMI": float(row["PMI"]),
            "calculatedNPMI": float(npmi[index]), "excelNPMI": float(row["NPMI"]),
            "calculatedScore": float(score[index]),
            "excelScore": float(row["NPMI_log_co_score"]),
            "maximumAbsoluteError": float(all_errors[index]),
        })
    report = {
        "pairCount": len(valid_common),
        "matchedPairs": int(np.count_nonzero(all_errors <= FLOAT_TOLERANCE)),
        "missingPairs": int(np.count_nonzero(co <= 0)),
        "tolerance": FLOAT_TOLERANCE,
        "metrics": metric_report,
        "largestErrorExamples": worst,
    }
    if report["matchedPairs"] != len(valid_common):
        raise ValueError("classifier(row)→noun(column) 未能全量复现 valid_common。")
    return report


def sample_symmetric_relations(
    relation_name, symmetric, relation_nodes, selected, sym_frequency, total,
    valid_words, sample_size=20,
):
    rng = np.random.default_rng(20260823)
    samples = []
    for row in rng.permutation(symmetric.shape[0]):
        start, stop = symmetric.indptr[row:row + 2]
        targets = symmetric.indices[start:stop]
        targets = targets[targets > row]
        if not len(targets):
            continue
        target = int(rng.choice(targets))
        local_a = int(relation_nodes[row])
        local_b = int(relation_nodes[target])
        forward = float(selected[local_a, local_b])
        reverse = float(selected[local_b, local_a])
        symmetric_co = float(symmetric[row, target])
        expected = (forward + reverse) / 2.0
        pmi_ab, npmi_ab, score_ab = metric_arrays(
            np.array([symmetric_co]), np.array([sym_frequency[local_a]]),
            np.array([sym_frequency[local_b]]), total,
        )
        pmi_ba, npmi_ba, score_ba = metric_arrays(
            np.array([symmetric_co]), np.array([sym_frequency[local_b]]),
            np.array([sym_frequency[local_a]]), total,
        )
        samples.append({
            "relationType": relation_name,
            "wordA": valid_words[local_a], "wordB": valid_words[local_b],
            "forwardCount": forward, "reverseCount": reverse,
            "symmetricCount": symmetric_co,
            "countFormulaError": abs(symmetric_co - expected),
            "pmiOrderError": abs(float(pmi_ab[0] - pmi_ba[0])),
            "npmiOrderError": abs(float(npmi_ab[0] - npmi_ba[0])),
            "scoreOrderError": abs(float(score_ab[0] - score_ba[0])),
            "pmi": float(pmi_ab[0]),
        })
        if len(samples) == sample_size:
            break
    if len(samples) != sample_size:
        raise ValueError(f"{relation_name} 无法抽取 {sample_size} 条非零同类边。")
    maximum_error = max(
        max(item["countFormulaError"], item["pmiOrderError"],
            item["npmiOrderError"], item["scoreOrderError"])
        for item in samples
    )
    if maximum_error > FLOAT_TOLERANCE:
        raise ValueError(f"{relation_name} 对称性验证失败。")
    return {
        "sampleCount": len(samples),
        "maximumOrderOrFormulaError": maximum_error,
        "samples": samples,
    }


def top_indices(neighbors, score):
    take = min(TOP_K, len(score))
    if take == 0:
        return np.empty(0, dtype=np.int64)
    selected = np.argpartition(score, -take)[-take:] if take < len(score) else np.arange(take)
    return selected[np.lexsort((neighbors[selected], -score[selected]))]


def build_valid_common_adjacency(valid_common, local_index, node_count):
    """将 valid_common 的有向量词→名词关系转换为两端都可查询的合法邻接表。"""
    targets = [[] for _ in range(node_count)]
    co_values = [[] for _ in range(node_count)]
    scores = [[] for _ in range(node_count)]
    partners = [set() for _ in range(node_count)]
    unordered_pairs = {}
    self_pair_count = 0

    for row in valid_common.itertuples(index=False):
        source = int(local_index[str(row.classifier)])
        target = int(local_index[str(row.word)])
        if source == target:
            self_pair_count += 1
            continue
        co = float(row.co_occurrence)
        score = float(row.NPMI_log_co_score)
        if co <= 0:
            raise ValueError("valid_common 中存在 co_occurrence <= 0 的关系。")
        pair_key = (min(source, target), max(source, target))
        if pair_key in unordered_pairs:
            previous = unordered_pairs[pair_key]
            raise ValueError(
                "valid_common 中同一无向节点对存在多个有向角色，当前二进制格式无法无歧义表示："
                f"{previous} 与 {(str(row.classifier), str(row.word))}"
            )
        unordered_pairs[pair_key] = (str(row.classifier), str(row.word))
        for left, right in ((source, target), (target, source)):
            targets[left].append(right)
            co_values[left].append(co)
            scores[left].append(score)
            partners[left].add(right)

    target_arrays = [np.asarray(rows, dtype=np.int32) for rows in targets]
    co_arrays = [np.asarray(rows, dtype=np.float64) for rows in co_values]
    score_arrays = [np.asarray(rows, dtype=np.float64) for rows in scores]
    return target_arrays, co_arrays, score_arrays, partners, {
        "validCommonPairCount": len(unordered_pairs),
        "selfPairCountExcluded": self_pair_count,
        "ambiguousUnorderedPairCount": 0,
    }


def build_top400_adjacency(
    valid_common, local_index, classifier_sym, noun_sym, classifier_nodes,
    noun_nodes, sym_frequency, total,
):
    node_count = len(classifier_nodes) + len(noun_nodes)
    targets_by_node = [None] * node_count
    co_by_node = [None] * node_count
    (
        valid_targets, valid_co, valid_scores, valid_partners,
        valid_common_report,
    ) = build_valid_common_adjacency(valid_common, local_index, node_count)

    for class_row, local_source in enumerate(classifier_nodes):
        cc_start, cc_stop = classifier_sym.indptr[class_row:class_row + 2]
        cc_relative = classifier_sym.indices[cc_start:cc_stop]
        cc_neighbors = classifier_nodes[cc_relative]
        cc_co = classifier_sym.data[cc_start:cc_stop]
        # 兼具名词身份的节点可能同时形成同类边与 valid_common 搭配边；
        # 浏览器格式每个节点对只保留一条关系，明确让 valid_common 角色优先。
        if len(cc_neighbors) and valid_partners[local_source]:
            keep = np.fromiter(
                (int(neighbor) not in valid_partners[local_source] for neighbor in cc_neighbors),
                dtype=bool, count=len(cc_neighbors),
            )
            cc_neighbors = cc_neighbors[keep]
            cc_co = cc_co[keep]
        _, _, cc_score = metric_arrays(
            cc_co, sym_frequency[local_source], sym_frequency[cc_neighbors], total
        )
        cn_neighbors = valid_targets[local_source]
        cn_co = valid_co[local_source]
        cn_score = valid_scores[local_source]
        neighbors = np.concatenate([cc_neighbors, cn_neighbors]).astype(np.int32, copy=False)
        co = np.concatenate([cc_co, cn_co]).astype(np.float64, copy=False)
        score = np.concatenate([cc_score, cn_score])
        selected = top_indices(neighbors, score)
        targets_by_node[local_source] = neighbors[selected].copy()
        co_by_node[local_source] = co[selected].copy()

    for noun_row, local_source in enumerate(noun_nodes):
        nn_start, nn_stop = noun_sym.indptr[noun_row:noun_row + 2]
        nn_relative = noun_sym.indices[nn_start:nn_stop]
        nn_neighbors = noun_nodes[nn_relative]
        nn_co = noun_sym.data[nn_start:nn_stop]
        _, _, nn_score = metric_arrays(
            nn_co, sym_frequency[local_source], sym_frequency[nn_neighbors], total
        )
        nc_neighbors = valid_targets[local_source]
        nc_co = valid_co[local_source]
        nc_score = valid_scores[local_source]
        neighbors = np.concatenate([nn_neighbors, nc_neighbors]).astype(np.int32, copy=False)
        co = np.concatenate([nn_co, nc_co]).astype(np.float64, copy=False)
        score = np.concatenate([nn_score, nc_score])
        selected = top_indices(neighbors, score)
        targets_by_node[local_source] = neighbors[selected].copy()
        co_by_node[local_source] = co[selected].copy()
        if (noun_row + 1) % 1000 == 0 or noun_row + 1 == len(noun_nodes):
            print(f"已计算 Top-{TOP_K}：{noun_row + 1:,}/{len(noun_nodes):,} 个名词", flush=True)
    valid_common_report.update({
        "topKAppliedAfterLegalRelationFilter": True,
        "maximumAdjacencyRecordsPerNode": int(max(map(len, targets_by_node))),
        "adjacencyRecordCount": int(sum(map(len, targets_by_node))),
    })
    return targets_by_node, co_by_node, valid_common_report


def write_edge_chunks(targets_by_node, co_by_node):
    EDGE_DIR.mkdir(parents=True, exist_ok=True)
    for stale_file in EDGE_DIR.glob("chunk_*.bin"):
        stale_file.unlink()
    locations = [None] * len(targets_by_node)
    chunks = []
    record_dtype = np.dtype([("target", "<u4"), ("co", "<f8")])
    for chunk_start in range(0, len(targets_by_node), CHUNK_SOURCE_COUNT):
        chunk_index = chunk_start // CHUNK_SOURCE_COUNT
        chunk_stop = min(chunk_start + CHUNK_SOURCE_COUNT, len(targets_by_node))
        record_count = sum(len(targets_by_node[index]) for index in range(chunk_start, chunk_stop))
        records = np.empty(record_count, dtype=record_dtype)
        cursor = 0
        for source in range(chunk_start, chunk_stop):
            count = len(targets_by_node[source])
            locations[source] = {"chunk": chunk_index, "offset": cursor, "count": count}
            records["target"][cursor:cursor + count] = targets_by_node[source]
            records["co"][cursor:cursor + count] = co_by_node[source]
            cursor += count
        filename = f"chunk_{chunk_index:03d}.bin"
        (EDGE_DIR / filename).write_bytes(records.tobytes())
        chunks.append({"file": filename, "recordCount": int(record_count)})
    return locations, chunks


def add_same_type_community_edges(
    graph, matrix, node_map, frequencies, total,
):
    for row in range(matrix.shape[0]):
        start, stop = matrix.indptr[row:row + 2]
        targets = matrix.indices[start:stop]
        co = matrix.data[start:stop]
        keep_upper = targets > row
        targets = targets[keep_upper]
        co = co[keep_upper]
        if not len(co):
            continue
        pmi, _, _ = metric_arrays(co, frequencies[row], frequencies[targets], total)
        keep = (pmi >= DEFAULT_PMI_THRESHOLD) & (co >= DEFAULT_CO_THRESHOLD)
        graph.add_edges_from(
            (
                int(node_map[row]), int(node_map[target]),
                {"weight": float(weight), "co_occur": float(count)},
            )
            for target, count, weight in zip(targets[keep], co[keep], pmi[keep], strict=True)
        )


def build_analysis_graph(
    node_count, classifier_noun, classifier_sym, noun_sym, classifier_nodes,
    noun_nodes, row_sums, column_sums, sym_frequency, total,
):
    import networkx as nx

    graph = nx.Graph()
    graph.add_nodes_from(range(node_count))
    add_same_type_community_edges(
        graph, classifier_sym, classifier_nodes,
        sym_frequency[classifier_nodes], total,
    )
    add_same_type_community_edges(
        graph, noun_sym, noun_nodes, sym_frequency[noun_nodes], total,
    )
    for row in range(classifier_noun.shape[0]):
        start, stop = classifier_noun.indptr[row:row + 2]
        targets = classifier_noun.indices[start:stop]
        co = classifier_noun.data[start:stop]
        if not len(co):
            continue
        pmi, _, _ = metric_arrays(
            co, row_sums[classifier_nodes[row]], column_sums[noun_nodes[targets]], total
        )
        keep = (pmi >= DEFAULT_PMI_THRESHOLD) & (co >= DEFAULT_CO_THRESHOLD)
        graph.add_edges_from(
            (
                int(classifier_nodes[row]), int(noun_nodes[target]),
                {"weight": float(weight), "co_occur": float(count)},
            )
            for target, count, weight in zip(targets[keep], co[keep], pmi[keep], strict=True)
        )
    before = {"nodeCount": graph.number_of_nodes(), "edgeCount": graph.number_of_edges()}
    graph.remove_nodes_from([
        node for node, degree in graph.degree() if degree < DEFAULT_DEGREE_THRESHOLD
    ])
    after = {"nodeCount": graph.number_of_nodes(), "edgeCount": graph.number_of_edges()}
    return graph, before, after


def calculate_graph_metrics(graph, node_count):
    import community
    import networkx as nx

    communities = np.full(node_count, -1, dtype=np.int32)
    clustering = np.full(node_count, np.nan)
    eigenvector = np.full(node_count, np.nan)
    closeness = np.full(node_count, np.nan)
    betweenness = np.full(node_count, np.nan)
    statuses = {
        "closeness": "not_computed: exact all-pairs shortest paths are infeasible at this graph size",
        "betweenness": "not_computed: exact all-pairs betweenness is infeasible at this graph size",
    }

    part = community.best_partition(graph)
    modularity = float(community.modularity(part, graph))
    for node, value in part.items():
        communities[node] = int(value)

    clustering_values = nx.clustering(graph)
    for node, value in clustering_values.items():
        clustering[node] = float(value)
    statuses["clustering"] = "computed_exact_unweighted"

    try:
        eigen_values = nx.eigenvector_centrality_numpy(graph, weight="weight")
        for node, value in eigen_values.items():
            eigenvector[node] = float(abs(value))
        statuses["eigenvector"] = "computed_exact_weighted"
    except nx.NetworkXException as error:
        statuses["eigenvector"] = f"not_computed: {error}"

    community_sizes = pd.Series(part).value_counts().sort_index().to_dict()
    component_sizes = sorted((len(rows) for rows in nx.connected_components(graph)), reverse=True)
    return {
        "community": communities, "clustering": clustering,
        "eigenvector": eigenvector, "closeness": closeness,
        "betweenness": betweenness,
    }, {
        "modularity": modularity,
        "communityCount": len(community_sizes),
        "communitySizes": {str(key): int(value) for key, value in community_sizes.items()},
        "largestCommunitySize": int(max(community_sizes.values())),
        "connectedComponentCount": len(component_sizes),
        "largestConnectedComponentSize": int(component_sizes[0]),
        "centralityStatus": statuses,
    }


def nullable_float(value):
    return None if not np.isfinite(value) else float(value)


def read_js_value(path, variable_name):
    text = path.read_text(encoding="utf-8")
    marker = f"window.{variable_name} = "
    start = text.index(marker) + len(marker)
    return json.loads(text[start:].strip().removesuffix(";"))


def main():
    excel = pd.ExcelFile(VALID_COMMON_PATH)
    if len(excel.sheet_names) != 1:
        raise ValueError("valid_common.xlsx 必须只有一个可明确识别的工作表。")
    valid_common = pd.read_excel(excel, sheet_name=excel.sheet_names[0])
    missing_columns = [column for column in REQUIRED_COLUMNS if column not in valid_common.columns]
    if missing_columns:
        raise ValueError(f"valid_common.xlsx 缺少字段：{missing_columns}")
    if valid_common[REQUIRED_COLUMNS].isna().any().any():
        raise ValueError("valid_common.xlsx 的必需字段存在缺失值。")
    if valid_common.duplicated(["classifier", "word"]).any():
        raise ValueError("valid_common.xlsx 存在重复 classifier—word 配对。")

    vocab = pd.read_csv(VOCAB_PATH, header=None, usecols=[0])[0].astype(str).tolist()
    if len(vocab) != len(set(vocab)):
        raise ValueError("voc_list.txt 存在重复词项。")
    vocab_index = {word: index for index, word in enumerate(vocab)}
    classifier_set = set(valid_common["classifier"].astype(str))
    noun_set = set(valid_common["word"].astype(str))
    missing_words = sorted((classifier_set | noun_set) - set(vocab))
    if missing_words:
        raise ValueError(f"有 {len(missing_words):,} 个 valid_common 词不在 vocabulary 中。")

    ensure_caches(valid_common, vocab)
    valid_words = json.loads((CACHE_DIR / "valid_words.json").read_text(encoding="utf-8"))
    local_index = {word: index for index, word in enumerate(valid_words)}
    node_count = len(valid_words)
    classifier_nodes = np.load(CACHE_DIR / "classifier_nodes.npy")
    noun_nodes = np.load(CACHE_DIR / "noun_nodes.npy")
    classifier_noun = load_csr("classifier_noun", (len(classifier_nodes), len(noun_nodes)))
    classifier_sym = load_csr("classifier_sym", (len(classifier_nodes), len(classifier_nodes)))
    noun_sym = load_csr("noun_sym", (len(noun_nodes), len(noun_nodes)))
    full_degree = np.load(CACHE_DIR / "full_degree.npy")
    row_sums = np.load(CACHE_DIR / "row_sums.npy")
    column_sums = np.load(CACHE_DIR / "column_sums.npy")
    sym_frequency = np.load(CACHE_DIR / "sym_frequency.npy")
    selected_global = np.load(CACHE_DIR / "selected_global.npy")
    indptr = np.load(CACHE_DIR / "indptr.npy", mmap_mode="r")
    selected_targets = np.memmap(CACHE_DIR / "targets.i32", dtype="<i4", mode="r")
    selected_co = np.memmap(CACHE_DIR / "co.f64", dtype="<f8", mode="r")
    selected = sparse.csr_matrix(
        (selected_co, selected_targets, indptr), shape=(node_count, node_count), copy=False
    )
    with np.load(GLOBAL_STATS_PATH, allow_pickle=False) as stats:
        total = float(stats["N"])

    print("全量核对 classifier(row)→noun(column)…", flush=True)
    direction_validation = validate_classifier_direction(
        valid_common, selected, local_index, vocab_index,
        row_sums, column_sums, total,
    )
    print(
        f"row→column：{direction_validation['matchedPairs']:,}/"
        f"{direction_validation['pairCount']:,} matched", flush=True,
    )

    print("验证 noun↔noun 与 classifier↔classifier 对称性…", flush=True)
    noun_validation = sample_symmetric_relations(
        "noun_noun", noun_sym, noun_nodes, selected, sym_frequency, total,
        valid_words,
    )
    classifier_validation = sample_symmetric_relations(
        "classifier_classifier", classifier_sym, classifier_nodes, selected,
        sym_frequency, total, valid_words,
    )

    print("构建固定 Community 分析图…", flush=True)
    analysis_graph, graph_before, graph_after = build_analysis_graph(
        node_count, classifier_noun, classifier_sym, noun_sym, classifier_nodes,
        noun_nodes, row_sums, column_sums, sym_frequency, total,
    )
    metrics, graph_report = calculate_graph_metrics(analysis_graph, node_count)

    print("计算浏览器显示用合法关系排序 Top-400…", flush=True)
    targets_by_node, co_by_node, browser_relation_report = build_top400_adjacency(
        valid_common, local_index, classifier_sym, noun_sym, classifier_nodes,
        noun_nodes, sym_frequency, total,
    )
    edge_locations, chunks = write_edge_chunks(targets_by_node, co_by_node)
    displayed_co = np.concatenate(co_by_node)
    co_quantiles = {
        str(percentile): float(np.quantile(displayed_co, percentile))
        for percentile in [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1]
    }

    full_component_count, full_labels = csgraph.connected_components(
        selected, directed=True, connection="weak"
    )
    full_component_sizes = np.bincount(full_labels)
    profile = json.loads((CACHE_DIR / "mixed_relation_profile.json").read_text(encoding="utf-8"))

    nodes = []
    for index, word in enumerate(valid_words):
        is_classifier = word in classifier_set
        nodes.append({
            "id": word,
            "type": "classifier" if is_classifier else "noun",
            "alsoNoun": bool(is_classifier and word in noun_set),
            "vocabIndex": int(selected_global[index]),
            "rowSum": float(row_sums[index]),
            "columnSum": float(column_sums[index]),
            "symFrequency": float(sym_frequency[index]),
            "degreeFull": int(full_degree[index]),
            "community": None if metrics["community"][index] < 0 else int(metrics["community"][index]),
            "closeness": nullable_float(metrics["closeness"][index]),
            "betweenness": nullable_float(metrics["betweenness"][index]),
            "clustering": nullable_float(metrics["clustering"][index]),
            "eigenvector": nullable_float(metrics["eigenvector"][index]),
            **edge_locations[index],
        })

    manifest = {
        "version": 3,
        "relationModel": "classifier→noun directed; same-type bidirectional mean",
        "topKPerNode": TOP_K,
        "topKMetric": (
            "NPMI_log_co_score after restricting classifier→noun to valid_common; "
            "same-type relations unchanged"
        ),
        "classifierNounPolicy": "valid_common_only",
        "topKAppliedAfterLegalRelationFilter": True,
        "browserRelationValidation": browser_relation_report,
        "recordBytes": 12,
        "recordLayout": "uint32 neighborLocalIndex + float64 coOccurrence (little-endian)",
        "total": total,
        "symmetricTotal": total,
        "nodeCount": node_count,
        "top400AdjacencyRecordCount": int(sum(map(len, targets_by_node))),
        "fullRelationCounts": {
            "classifier_noun": profile["classifierNounEdgeCount"],
            "noun_noun": profile["nounNounEdgeCount"],
            "classifier_classifier": profile["classifierClassifierEdgeCount"],
            "total": profile["totalUniqueEdgeCount"],
        },
        "chunkSourceCount": CHUNK_SOURCE_COUNT,
        "chunkBasePath": "data/word_network_edges/",
        "chunks": chunks,
        "coOccurrenceMax": float(displayed_co.max()),
        "coOccurrenceQuantiles": co_quantiles,
        "defaults": {
            "pmiThreshold": DEFAULT_PMI_THRESHOLD,
            "coOccurrenceThreshold": DEFAULT_CO_THRESHOLD,
            "degreeThreshold": DEFAULT_DEGREE_THRESHOLD,
        },
        "communityGraph": {
            "pmiThreshold": DEFAULT_PMI_THRESHOLD,
            "coOccurrenceThreshold": DEFAULT_CO_THRESHOLD,
            "degreeThreshold": DEFAULT_DEGREE_THRESHOLD,
            "degreePrunedOnce": True,
            "beforeDegreePrune": graph_before,
            "afterDegreePrune": graph_after,
            **graph_report,
        },
    }
    metadata = json.loads((CACHE_DIR / "metadata.json").read_text(encoding="utf-8"))
    report = {
        **metadata,
        "vocabularyCount": len(vocab),
        "nounOnlyCount": len(noun_set - classifier_set),
        "missingValidWords": len(missing_words),
        "classifierNounDirectionValidation": direction_validation,
        "symmetricValidation": {
            "nounNoun": noun_validation,
            "classifierClassifier": classifier_validation,
        },
        "fullRelationCounts": manifest["fullRelationCounts"],
        "fullConnectedComponentCount": int(full_component_count),
        "largestFullConnectedComponentSize": int(full_component_sizes.max()),
        "communityGraph": manifest["communityGraph"],
        "browserTop400AdjacencyRecordCount": manifest["top400AdjacencyRecordCount"],
        "browserRelationValidation": browser_relation_report,
        "browserBinaryBytes": int(sum(chunk["recordCount"] for chunk in chunks) * 12),
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_js(
        DATA_DIR / "word_network_nodes.js", "WORD_NETWORK_NODES", nodes,
        "Mixed-relation nodes; global statistics preserved with legal per-node Top-400 browser index.",
    )
    write_js(
        DATA_DIR / "word_network_edges.js", "WORD_NETWORK_EDGE_MANIFEST", manifest,
        "Top-400 browser adjacency; classifier→noun restricted to valid_common before ranking.",
    )
    (DATA_DIR / "word_network_build_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    community_rows = []
    for community_id, size in sorted(
        ((int(key), int(value)) for key, value in graph_report["communitySizes"].items())
    ):
        members = np.flatnonzero(metrics["community"] == community_id)
        representatives = sorted(
            members, key=lambda item: (-int(full_degree[item]), valid_words[item])
        )[:18]
        community_rows.append({
            "community": community_id, "size": size,
            "representativeWords": [valid_words[index] for index in representatives],
        })
    (DATA_DIR / "word_network_communities.json").write_text(
        json.dumps(community_rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps({
        "validWords": node_count,
        "classifierCount": len(classifier_set),
        "nounCount": len(noun_set),
        "overlapCount": len(classifier_set & noun_set),
        "fullRelationCounts": manifest["fullRelationCounts"],
        "communityCount": graph_report["communityCount"],
        "modularity": graph_report["modularity"],
        "largestCommunitySize": graph_report["largestCommunitySize"],
        "largestFullComponent": int(full_component_sizes.max()),
        "browserRecords": manifest["top400AdjacencyRecordCount"],
    }, ensure_ascii=False, indent=2), flush=True)


def regenerate_browser_data_only():
    """重建合法 Top-400 分块，同时原样保留现有 Global Community 与节点指标。"""
    excel = pd.ExcelFile(VALID_COMMON_PATH)
    if len(excel.sheet_names) != 1:
        raise ValueError("valid_common.xlsx 必须只有一个可明确识别的工作表。")
    valid_common = pd.read_excel(excel, sheet_name=excel.sheet_names[0])
    missing_columns = [column for column in REQUIRED_COLUMNS if column not in valid_common.columns]
    if missing_columns:
        raise ValueError(f"valid_common.xlsx 缺少字段：{missing_columns}")
    if valid_common[REQUIRED_COLUMNS].isna().any().any():
        raise ValueError("valid_common.xlsx 的必需字段存在缺失值。")
    if valid_common.duplicated(["classifier", "word"]).any():
        raise ValueError("valid_common.xlsx 存在重复 classifier—word 配对。")

    vocab = pd.read_csv(VOCAB_PATH, header=None, usecols=[0])[0].astype(str).tolist()
    ensure_caches(valid_common, vocab)
    valid_words = json.loads((CACHE_DIR / "valid_words.json").read_text(encoding="utf-8"))
    local_index = {word: index for index, word in enumerate(valid_words)}
    classifier_nodes = np.load(CACHE_DIR / "classifier_nodes.npy")
    noun_nodes = np.load(CACHE_DIR / "noun_nodes.npy")
    classifier_sym = load_csr(
        "classifier_sym", (len(classifier_nodes), len(classifier_nodes))
    )
    noun_sym = load_csr("noun_sym", (len(noun_nodes), len(noun_nodes)))
    sym_frequency = np.load(CACHE_DIR / "sym_frequency.npy")
    with np.load(GLOBAL_STATS_PATH, allow_pickle=False) as stats:
        total = float(stats["N"])

    print("重建 valid_common 优先的浏览器 Top-400…", flush=True)
    targets_by_node, co_by_node, browser_relation_report = build_top400_adjacency(
        valid_common, local_index, classifier_sym, noun_sym, classifier_nodes,
        noun_nodes, sym_frequency, total,
    )
    edge_locations, chunks = write_edge_chunks(targets_by_node, co_by_node)
    displayed_co = np.concatenate(co_by_node)
    co_quantiles = {
        str(percentile): float(np.quantile(displayed_co, percentile))
        for percentile in [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1]
    }

    nodes_path = DATA_DIR / "word_network_nodes.js"
    manifest_path = DATA_DIR / "word_network_edges.js"
    nodes = read_js_value(nodes_path, "WORD_NETWORK_NODES")
    manifest = read_js_value(manifest_path, "WORD_NETWORK_EDGE_MANIFEST")
    if [node["id"] for node in nodes] != valid_words:
        raise ValueError("现有 word_network_nodes.js 与 valid_words 顺序不一致。")
    for node, location in zip(nodes, edge_locations, strict=True):
        node.update(location)

    manifest.update({
        "version": 3,
        "topKPerNode": TOP_K,
        "topKMetric": (
            "NPMI_log_co_score after restricting classifier→noun to valid_common; "
            "same-type relations unchanged"
        ),
        "classifierNounPolicy": "valid_common_only",
        "topKAppliedAfterLegalRelationFilter": True,
        "browserRelationValidation": browser_relation_report,
        "top400AdjacencyRecordCount": int(sum(map(len, targets_by_node))),
        "chunks": chunks,
        "coOccurrenceMax": float(displayed_co.max()),
        "coOccurrenceQuantiles": co_quantiles,
    })
    manifest.setdefault(
        "fullRelationCountsScope",
        "preserved global analysis graph; browser classifier→noun policy is reported separately",
    )
    write_js(
        nodes_path, "WORD_NETWORK_NODES", nodes,
        "Mixed-relation nodes; global statistics preserved with legal per-node Top-400 browser index.",
    )
    write_js(
        manifest_path, "WORD_NETWORK_EDGE_MANIFEST", manifest,
        "Top-400 browser adjacency; classifier→noun restricted to valid_common before ranking.",
    )

    report_path = DATA_DIR / "word_network_build_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    report.update({
        "browserTop400AdjacencyRecordCount": manifest["top400AdjacencyRecordCount"],
        "browserBinaryBytes": int(manifest["top400AdjacencyRecordCount"] * 12),
        "browserRelationValidation": browser_relation_report,
        "classifierNounPolicy": "valid_common_only",
        "topKAppliedAfterLegalRelationFilter": True,
    })
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({
        "browserRecords": manifest["top400AdjacencyRecordCount"],
        "browserBinaryBytes": report["browserBinaryBytes"],
        "browserRelationValidation": browser_relation_report,
        "globalCommunityPreserved": True,
    }, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    if "--browser-only" in sys.argv:
        regenerate_browser_data_only()
    else:
        main()
