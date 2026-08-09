"""为中文量词语义网络生成静态 JavaScript 数据文件。"""

from pathlib import Path
import json

import numpy as np
import pandas as pd
from scipy import sparse


BASE_DIR = Path(__file__).resolve().parent
SOURCE_PATH = BASE_DIR.parent / "valid_common.xlsx"
DATA_DIR = BASE_DIR / "data"

CLASSIFIER_COL = "classifier"
NOUN_COL = "word"
WEIGHT_COL = "NPMI_log_co_score"
REQUIRED_COLUMNS = [CLASSIFIER_COL, NOUN_COL, WEIGHT_COL]


def write_js(path, variable_name, records, source_note):
    """以 window 全局变量形式写入数据，便于静态网页直接加载。"""
    payload = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
    path.write_text(
        f"// {source_note}\nwindow.{variable_name} = {payload};\n",
        encoding="utf-8",
    )


def main():
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"未找到原始数据：{SOURCE_PATH}")

    excel_file = pd.ExcelFile(SOURCE_PATH)
    if len(excel_file.sheet_names) != 1:
        raise ValueError(
            f"valid_common.xlsx 含 {len(excel_file.sheet_names)} 个工作表，"
            "无法在不猜测的情况下选择数据表。"
        )

    raw = pd.read_excel(excel_file, sheet_name=excel_file.sheet_names[0])
    missing_columns = [col for col in REQUIRED_COLUMNS if col not in raw.columns]
    if missing_columns:
        raise ValueError(f"缺少必需字段：{missing_columns}")

    data = raw[REQUIRED_COLUMNS].copy()
    data[WEIGHT_COL] = pd.to_numeric(data[WEIGHT_COL], errors="coerce")
    invalid_mask = (
        data[[CLASSIFIER_COL, NOUN_COL]].isna().any(axis=1)
        | data[WEIGHT_COL].isna()
        | ~np.isfinite(data[WEIGHT_COL])
    )
    if invalid_mask.any():
        raise ValueError(f"必需字段存在 {int(invalid_mask.sum())} 条缺失或非有限记录，停止转换。")

    duplicate_mask = data.duplicated([CLASSIFIER_COL, NOUN_COL], keep=False)
    if duplicate_mask.any():
        duplicate_groups = data.loc[
            duplicate_mask, [CLASSIFIER_COL, NOUN_COL]
        ].drop_duplicates()
        raise ValueError(
            f"发现 {len(duplicate_groups)} 个重复量词—名词组合；"
            "未核实重复原因前不进行聚合。"
        )

    classifiers = pd.Index(pd.unique(data[CLASSIFIER_COL]), name=CLASSIFIER_COL)
    nouns = pd.Index(pd.unique(data[NOUN_COL]), name=NOUN_COL)
    classifier_codes = pd.Categorical(
        data[CLASSIFIER_COL], categories=classifiers
    ).codes
    noun_codes = pd.Categorical(data[NOUN_COL], categories=nouns).codes

    weights = data[WEIGHT_COL].to_numpy(dtype=float)
    weight_matrix = sparse.csr_matrix(
        (weights, (classifier_codes, noun_codes)),
        shape=(len(classifiers), len(nouns)),
    )
    row_norms = np.sqrt(weight_matrix.multiply(weight_matrix).sum(axis=1)).A1
    if (row_norms == 0).any():
        zero_names = classifiers[row_norms == 0].tolist()
        raise ValueError(f"以下量词的权重向量范数为 0：{zero_names}")

    normalized = sparse.diags(1.0 / row_norms) @ weight_matrix
    cosine_matrix = (normalized @ normalized.T).toarray()
    upper_i, upper_j = np.triu_indices(len(classifiers), k=1)
    similarities = cosine_matrix[upper_i, upper_j]

    binary_matrix = weight_matrix.copy()
    binary_matrix.data = np.ones(binary_matrix.nnz, dtype=np.int32)
    common_noun_matrix = (binary_matrix @ binary_matrix.T).toarray()

    positive = similarities > 0
    positive_i = upper_i[positive]
    positive_j = upper_j[positive]
    positive_similarities = similarities[positive]

    noun_records = [
        {
            "classifier": classifier,
            "word": word,
            "score": float(score),
        }
        for classifier, word, score in data.itertuples(index=False, name=None)
    ]

    similarity_records = [
        {
            "source": str(classifiers[i]),
            "target": str(classifiers[j]),
            "similarity": float(similarity),
            "commonNouns": int(common_noun_matrix[i, j]),
        }
        for i, j, similarity in zip(
            positive_i, positive_j, positive_similarities, strict=True
        )
    ]
    similarity_records.sort(key=lambda row: row["similarity"], reverse=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_js(
        DATA_DIR / "classifier_noun_data.js",
        "CLASSIFIER_NOUN_DATA",
        noun_records,
        f"Generated from valid_common.xlsx; records: {len(noun_records)}",
    )
    write_js(
        DATA_DIR / "classifier_similarity_data.js",
        "CLASSIFIER_SIMILARITY_DATA",
        similarity_records,
        "Generated from the complete cosine_similarity > 0 network; "
        f"records: {len(similarity_records)}",
    )

    theoretical_pairs = len(classifiers) * (len(classifiers) - 1) // 2
    print(f"工作表：{excel_file.sheet_names[0]}")
    print(f"量词—名词关系：{len(noun_records):,}")
    print(f"量词：{len(classifiers):,}")
    print(f"名词：{len(nouns):,}")
    print(f"理论量词对：{theoretical_pairs:,}")
    print(f"cosine_similarity > 0：{len(similarity_records):,}")
    print(f"最小正相似度：{positive_similarities.min():.12f}")
    print(f"最大相似度：{positive_similarities.max():.12f}")
    print(f"输出目录：{DATA_DIR}")


if __name__ == "__main__":
    main()
