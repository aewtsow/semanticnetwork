# 无损数据发布与部署

2026-10-06 的独立预览保留在 `preview/lossless-20261006`。
2026-10-07 根据用户上线要求，正式版本由 `main` 构建发布；构建脚本只允许
`VERCEL_GIT_COMMIT_REF=main` 的 Production 构建，其他分支仍用于 Preview。

## 存档

实施前已创建工作区内 ZIP 快照，包含当前代码、旧图/星图数据及全部 23,231 行
原始双精度数据；排除可再生的 build_cache、旧复制目录 git 和 Python 缓存。
ZIP 已全文件 CRC 验证，SHA256 记录在同名 JSON 中。线上旧版另保存在
`archive/original-20260905`，不修改该分支及 main。

## 数据格式

科学计算方法与原始 manifest 不变。SNR1 文件只改变传输格式：

- 48 字节头：SNR1、词数、两个 gzip 流长度、原始整行 SHA256。
- 余弦部分按 Float64 的 8 个字节位置重排，再 gzip(level=6)。
- 共现部分保留原始 Float64 字节并 gzip(level=6)。
- 不转 Float32、不量化、不删零、不截 Top K、不合并对称词对。
- 每个文件都解压、逆排列，与原始行逐字节比较后才加入发布包。
- 每 1,024 行封装为无外层压缩的 tar，避免发布端重复压缩。

执行 `python package_release_data.py`，输出至 `build_cache/release-lossless-20261006/`。
分包及每包校验支持续算；原始数据和 manifest 不改写。重新生成或改变数据时应使用
新的版本目录和 Release tag，不能覆盖已经公开的数据版本。

## GitHub Releases

数据 Release tag 为 `semantic-data-v2-lossless-20261006`。附件是全部 `rows-*.tar`
及 `release-manifest.json`。项目中的 `data/semantic_v2/release-lock.json` 锁定版本、
每包字节数及 SHA256。附件不是 Git blobs，也不使用 Git LFS。

Release 必须完整上传、可公开下载后才部署预览。所有数据为公开附件；不得上传原语料、
账户信息、构建缓存或无关研究文件。不要让浏览器直接依赖 GitHub 附件跨域读取。

## Vercel 部署

使用现有 GitHub 连接：`main` 发布正式站点，其他分支用于 Preview。
构建命令与输出目录由 `vercel.json` 配置，不改变账户权限或付费方案。

构建下载并校验 Release 附件，仅拆开 tar，不展开行内的 gzip。输出只含网页、vendor、
原星图数据和压缩行；不会包含原始 8.63 GB 行文件。每个下载包最多重试三次，失败则
构建失败，不会静默发布缺失的数据。

网页 Worker 按需读取、解压、逆字节排列并核对 SHA256，再交给原有计算代码。
原始行的缓存上限仍为 96 MiB；解压临时内存与本次构图数据另计。取消过时请求也会取消解压。
当前仍读取所选邻居的完整行：无损压缩降低传输量，但不会让 400 邻居的全部边模式变轻量。

Vercel Hobby 的部署存储及流量额度仍适用，保留多个大预览会累积存储。不要为验证而
升级付费套餐、降低访问保护，或未经确认删除已有部署。

## 本地验证

```text
python build_release_site.py --local-assets build_cache/release-lossless-20261006 --output build_cache/preview-lossless
node test_release_codec.js
python -m http.server 8766 --bind 127.0.0.1 --directory build_cache/preview-lossless
```

输出目录必须为空；脚本不会删除现有目录。`test_release_codec.js` 核验浏览器实际使用的
解码器与原始行一致，并覆盖损坏、截断及取消请求。原图模型、筛选、社区、布局、动画和
星图实现不随传输优化改变。
