#!/usr/bin/env bash
#
# 下载中文小模型并打包成 vosk-browser 需要的 gzipped tar，
# 产出到 src/renderer/public/vosk-model-cn.tar.gz（约 40MB，不入库）。
#
# vosk-browser 通过 createModel(url) 加载一个 .tar.gz：解压后顶层即模型目录
# （含 am/ conf/ graph/ ivector/ 等）。这里把官方模型目录里的内容打到 tar 根。
#
set -euo pipefail

MODEL_NAME="vosk-model-small-cn-0.22"
MODEL_ZIP_URL="https://alphacephei.com/vosk/models/${MODEL_NAME}.zip"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DIR="${ROOT_DIR}/src/renderer/public"
OUT_TGZ="${PUBLIC_DIR}/vosk-model-cn.tar.gz"

mkdir -p "${PUBLIC_DIR}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

echo "[fetch-model] 下载 ${MODEL_ZIP_URL}"
curl -fL --retry 3 -o "${WORK_DIR}/model.zip" "${MODEL_ZIP_URL}"

echo "[fetch-model] 解压"
unzip -q "${WORK_DIR}/model.zip" -d "${WORK_DIR}"

# 解压后得到 ${WORK_DIR}/${MODEL_NAME}/...，把其内容作为 tar 根目录打包
MODEL_DIR="${WORK_DIR}/${MODEL_NAME}"
if [ ! -d "${MODEL_DIR}" ]; then
  echo "[fetch-model] 错误：未找到模型目录 ${MODEL_DIR}" >&2
  exit 1
fi

echo "[fetch-model] 打包 -> ${OUT_TGZ}"
tar -czf "${OUT_TGZ}" -C "${MODEL_DIR}" .

echo "[fetch-model] 完成：$(du -h "${OUT_TGZ}" | cut -f1)  ${OUT_TGZ}"
