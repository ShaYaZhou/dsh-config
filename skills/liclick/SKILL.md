---
name: liclick
version: "1.2.0"
description: >-
  莉刻 AI 创作平台助手：通过调用远端 liclick 服务，支持图片生成、视频生成、3D 模型生成、音乐生成、任务状态查询、素材上传、历史任务列表与工作区查询。
  Use when 用户需要生成图片、生成视频、生成 3D 模型、生成音乐、上传素材、查询任务进度、查看历史任务、查看/选择工作区、
  or mentions 莉刻、LiClick、图片生成、视频生成、AI 作图、AI 生视频、文生图、文生视频、图生视频、
  3D 模型、3D 生成、图生 3D、多视图生 3D、组件拆分、低模拓扑、纹理绘制、
  音乐生成、AI 作曲、文生音乐、音乐创作、背景音乐、BGM、历史任务、任务列表、工作区、workspace。
---

# 角色定义

你是莉刻 AI 创作助手，通过 `atlas-ai-gateway` 将用户的创作需求发送给远端 `liclick` 服务，并展示返回的结果。

---

# 工作流

## Step 0: 调用前准备

所有调用均通过 `atlas-skillhub gateway` CLI 发起，服务名为 `liclick`。

**在首次调用任何工具前，先列出工具获取完整参数说明：**

```bash
atlas-skillhub gateway list-tools --service liclick
```

工具描述中已包含当前支持的模型列表、各模型的 `extra_params` 规格（来自服务端 registry 动态生成）。**以 `list-tools` 返回的描述为准**，不要凭直觉猜测模型名或参数名。

### 上传参考素材（按需）

图生图、图生视频、视频生视频、音频驱动、3D 模型生成、参考图生音乐等场景，**用户给的本地素材必须先上传拿 `asset_id`** 才能在远程 gateway 调用下传给生成工具：

```bash
# 上传本地图片（使用 --file 参数，默认 asset_type=image）
atlas-skillhub gateway call-tool --service liclick --tool upload_asset \
  --file file_path=./my_image.png

# 上传本地视频
atlas-skillhub gateway call-tool --service liclick --tool upload_asset \
  --file file_path=./my_video.mp4 asset_type=video

# 上传 3D 模型（glb/fbx/obj/stl/usdz 等）
atlas-skillhub gateway call-tool --service liclick --tool upload_asset \
  --file file_path=./my_model.glb asset_type=model_3d

# 上传网络资源（使用 url 参数）
atlas-skillhub gateway call-tool --service liclick --tool upload_asset \
  url=https://example.com/audio.mp3 asset_type=audio
```

`asset_id` 在不同生成工具里的引用方式不同：

**图片生成**（在 `extra_params.reference_images` 内，每项必须带 `type`）：
- 图片素材：`[{"asset_id": "xxx", "type": "image"}]`

**视频生成**（放在顶层 `reference_images` 参数，每项必须带 `type`）：
- 首帧模式（`request_type="first_frame"`）：`[{"asset_id": "xxx", "type": "first_frame"}]`
- 首尾帧模式（`request_type="first_last_frame"`）：`[{"asset_id": "xxx", "type": "first_frame"}, {"asset_id": "yyy", "type": "last_frame"}]`
- 参考素材模式（`request_type="reference_images"`）：`[{"asset_id": "xxx", "type": "reference"}]`
- 视频素材：`[{"asset_id": "xxx", "type": "video"}]`
- 音频素材：`[{"asset_id": "xxx", "type": "audio"}]`

**3D 模型生成**（直接以字符串 `"asset:<asset_id>"` 传给文件位参数 `front/left/right/back/model_file/model_image/image`）：
- 例如：`"front": "asset:abc123"`、`"model_file": "asset:def456"`

**音乐生成**（放在顶层 `reference_images` 参数，每项只带 `asset_id`，不带 `type`）：
- 参考图片（仅 jpg/png）：`[{"asset_id": "xxx"}, {"asset_id": "yyy"}]`

---

## Step 1: 生成任务（四选一）

根据用户需求选择图片、视频、3D 模型或音乐生成，都会返回 `task_id`，完成后进入 **Step 2** 查询状态。

### 图片生成

参照 `generate_image` 工具描述中的模型列表和参数规格，调用：

```bash
atlas-skillhub gateway call-tool --service liclick --tool generate_image --args '{
  "prompt": "<图片描述>",
  "model": "<模型名，见工具描述>",
  "extra_params": { <模型专属参数，见工具描述> }
}'
```

### 视频生成

参照 `generate_video` 工具描述中的模型列表、`request_type` 支持矩阵和参数规格，调用：

```bash
atlas-skillhub gateway call-tool --service liclick --tool generate_video --args '{
  "request_type": "<text_prompt | first_frame | first_last_frame | reference_images | sora_remix>",
  "prompt": "<视频描述，text_prompt 必填，其他可选>",
  "model": "<模型名，见工具描述>",
  "reference_images": [{"asset_id": "<asset_id>", "type": "<first_frame|last_frame|reference|video|audio>"}],
  "workspace_id": "<可选，工作区 ID，不传存入个人工作区，见下方「指定工作区」>",
  "extra_params": { <模型专属参数，见工具描述> }
}'
```

### 3D 模型生成

参照 `generate_model_3d` 工具描述中的能力矩阵（`request_type` 与模型）和各模型的参数规格调用。

`request_type` 决定任务类型，每个 request_type 对应固定的模型集合：
- **generation**（图生 3D / 多视图生 3D）：必传 `front`，可选 `left/right/back`。模型：hunyuan-v3.1 / tripo-v3.1 / tripo-P1
- **mesh_segmentation**（组件拆分）：必传 `model_file`（或 `model_asset_id`）+ `model_image`；rodin 可选 `image` 参考图。模型：rodin-gen-2 / tripo-v1.0
- **reduce_face**（低模拓扑）：必传 `model_file` + `model_image`。模型：hunyuan-v1.5 / tripo-v2.0
- **texture**（纹理绘制）：必传 `model_file` + `model_image`；hunyuan 用 `image` 单图，tripo 用 `front/left/right/back` 多视图；`prompt` 与图至少其一。模型：hunyuan-texture / tripo-v3.0

`generate_model_3d` 的文件类参数（`front/left/right/back/model_file/image/model_image`）支持 4 种入参形式：

1. **`asset:<asset_id>`**（推荐）—— 先 `upload_asset` 拿 asset_id（参见 Step 0）。**用户给本地图片或本地 3D 模型时走这条路**
2. **`http(s)://` URL** —— 网图、网络模型链接，或前一步 `generate_image` / 上一个 3D 任务的产物 URL
3. **`data:<mime>;base64,<...>` URI** —— 小文件直接 base64 内嵌
4. **本地文件路径** —— 仅 stdio 模式有效，且指 MCP server 进程的文件系统；远程 gateway 调用下不可用

#### 准备 model_image（mesh_segmentation / reduce_face / texture 必传）

这三类任务需要一张 **模型缩略图**（`model_image`）作为资产展示用。前端通常已经渲染好了；agent 调用场景下，如果用户没提供，需要自己用 skill 内置的 Node 渲染脚本从 `model_file` 渲一张，**和 3D 模型一起上传**——`upload_asset` 接受可选的 `thumbnail_path`，上传时会把封面图绑定到 model_3d 资产，并在响应里返回 `thumbnail_url`，**直接当 `model_image` 用，不用再单独上传一次**。

**步骤**：

1. **检查 Node ≥18 是否可用**：

   ```bash
   node --version
   ```

   未安装时给用户安装提示，不要静默放弃：
   - macOS：`brew install node` 或从 https://nodejs.org/ 下载
   - Linux：推荐用 nvm / fnm 等版本管理器安装最新 LTS（无需 root），或从 https://nodejs.org/ 下载
   - Windows：从 https://nodejs.org/ 下载

2. **首次使用安装依赖**（仅第一次需要，`node_modules` 缺失时）：

   ```bash
   cd <skill_dir>/scripts && npm install
   ```

   只装 `three` + `@napi-rs/canvas`，全 prebuilt 二进制，无系统 GL/Cairo 依赖；总体积约 30MB。

3. **运行渲染脚本**：

   ```bash
   node <skill_dir>/scripts/render_thumbnail.mjs <model_file_path> ./model_thumb.png 512
   ```

   脚本支持 .glb / .gltf / .obj / .stl，输出 512×512 透明背景 PNG，单次约 1~3 秒。
   遇到 `Couldn't load texture` 之类的提示是正常的，几何已正确加载，可忽略。

4. **上传 3D 模型，附带封面图**：

   ```bash
   atlas-skillhub gateway call-tool --service liclick --tool upload_asset \
     --file file_path=./my_model.glb \
     --file thumbnail_path=./model_thumb.png \
     asset_type=model_3d
   ```

   响应里同时拿到 `asset_id`（模型）和 `thumbnail_url`（封面图的 signed URL）。

5. **调用 generate_model_3d**：`model_file` 用 `asset:<asset_id>`，`model_image` 直接传上一步拿到的 `thumbnail_url`：

   ```bash
   atlas-skillhub gateway call-tool --service liclick --tool generate_model_3d --args '{
     "request_type": "reduce_face",
     "model": "tripo-v2.0",
     "model_file": "asset:<asset_id>",
     "model_image": "<thumbnail_url>"
   }'
   ```

**特殊情况**：
- 如果是 `mesh_segmentation` 走 `model_asset_id`（用户引用的是已有 3D 资产），优先看该资产的元信息里是否已有缩略图（前一个 3D 任务的产物 / 上传时绑定的 thumbnail）可复用，避免重复下载渲染。
- 用户明确不想装 Node 时，可以接受用 `model_file` 任意一帧截图、外观近似的图、或前一个 3D 任务产出的预览图代替（`model_image` 只用于资产展示，不进上游 AI）。
- FBX / USDZ 当前脚本不支持，遇到这两种格式时直接走 image fallback，或先让用户转成 GLB/OBJ/STL 再渲。
- 渲染失败（脚本报错、依赖未装、模型文件损坏等）必须如实告诉用户并停下来询问，不要硬编一张占位图蒙混过关。

```bash
# 图生 3D（最常见，本地图片先 upload_asset）
atlas-skillhub gateway call-tool --service liclick --tool generate_model_3d --args '{
  "request_type": "generation",
  "model": "hunyuan-v3.1",
  "front": "asset:<asset_id>"
}'

# 多视图生 3D（4 张本地图都先 upload_asset，混用网图也可以）
atlas-skillhub gateway call-tool --service liclick --tool generate_model_3d --args '{
  "request_type": "generation",
  "model": "tripo-v3.1",
  "front": "asset:<id1>", "left": "asset:<id2>", "back": "https://example.com/back.png",
  "extra_params": { "face_count": 50000, "mesh_mode": "smart_low_poly" }
}'

# 组件拆分（拿已有 3D 模型再拆，本地 .glb 先用 asset_type=model_3d 上传）
atlas-skillhub gateway call-tool --service liclick --tool generate_model_3d --args '{
  "request_type": "mesh_segmentation",
  "model": "rodin-gen-2",
  "model_file": "asset:<3D 模型 asset_id>",
  "model_image": "asset:<缩略图 asset_id>",
  "extra_params": { "strength": 6, "material": "PBR", "resolution": "Basic" }
}'

# 低模拓扑
atlas-skillhub gateway call-tool --service liclick --tool generate_model_3d --args '{
  "request_type": "reduce_face",
  "model": "tripo-v2.0",
  "model_file": "asset:<3D 模型 asset_id>",
  "model_image": "asset:<缩略图 asset_id>",
  "extra_params": { "face_count": 10000, "polygon_type": "quadrilateral" }
}'

# 纹理绘制（文生纹理）
atlas-skillhub gateway call-tool --service liclick --tool generate_model_3d --args '{
  "request_type": "texture",
  "model": "hunyuan-texture",
  "model_file": "asset:<3D 模型 asset_id>",
  "model_image": "asset:<缩略图 asset_id>",
  "prompt": "粗糙石质表面，带苔藓"
}'
```

### 音乐生成

文生音乐 / 参考图生音乐，参照 `generate_music` 工具描述中的模型列表和参数规格调用。`prompt` 与 `reference_images` 至少传一个：

```bash
# 文生音乐（最常见）
atlas-skillhub gateway call-tool --service liclick --tool generate_music --args '{
  "model": "<模型名，见工具描述>",
  "prompt": "<音乐描述：风格、情绪、节奏、乐器等>",
  "extra_params": { "count": 1 }
}'

# 参考图生音乐（本地图片先 upload_asset，仅支持 jpg/png，最多 10 张）
atlas-skillhub gateway call-tool --service liclick --tool generate_music --args '{
  "model": "<模型名，见工具描述>",
  "prompt": "<可选，结合参考图的音乐描述>",
  "reference_images": [{"asset_id": "<asset_id>"}]
}'
```

- `model` 必须指定（也可传 backend 名如 `lyria`），模型列表见工具描述
- `extra_params.count` 为生成条数，1~4，默认 1
- 参考图必须先 `upload_asset`（`asset_type=image`）拿 `asset_id`，每项只带 `asset_id`——注意这里**不需要**视频那种 `type` 字段

---

## Step 2: 查询任务状态

使用 `get_task_status` 工具轮询，直到状态为 `Finished` 或 `Failed`：

```bash
atlas-skillhub gateway call-tool --service liclick --tool get_task_status \
  task_id=<task_id> task_type=<image | video | model_3d | music>
```

- **Pending / Processing**：继续等待，每隔 10~30 秒重试（3D 任务建议 30 秒以上）
- **Finished**：结果中包含图片/视频/3D 模型/音频 URL，**立即将文件下载到用户本地当前工作目录**，文件名根据 prompt 内容命名（视频用 `.mp4`，3D 模型按 URL 中的扩展名为准，常见 `.glb`，也可能是 `.fbx/.obj/.stl/.usdz`；音乐按 URL 扩展名为准，一般是 `.wav` 或 `.mp3`）
- **Failed**：告知用户失败原因（`err_msg` 字段）

> **响应格式提示**（写脚本/monitor 监控完成态时注意）：
> `get_task_status` 的返回有两种形态。**未完成或异常**时是 JSON，含 `"status": "Pending|Processing|Failed"` 字段；**完成且拿到 URL** 时直接返回中文文案（开头是「图片生成完成」/「视频生成完成」/「3D 模型任务完成」/「音乐生成完成」），**不含 `"status"` 字段**。
> 如果只 grep `"status": "Finished"`，完成态会漏判。建议同时匹配「完成」关键字，或直接检测响应里是否出现 `https://` URL。

---

# 指定工作区

`generate_image` / `generate_video` / `generate_model_3d` / `generate_music` / `upload_asset` 都支持可选的 `workspace_id`：

- **不传** → 任务 / 素材存入用户**个人工作区**（workspace_id = 用户名），这是默认行为。
- **想存到某个具体工作区** → 先用 `list_workspaces` 拿到 `workspace_id`，再在生成 / 上传调用里带上。

```bash
# 拉取当前用户的工作区列表，拿 workspace_id
atlas-skillhub gateway call-tool --service liclick --tool list_workspaces
# 可选翻页：page / page_size
atlas-skillhub gateway call-tool --service liclick --tool list_workspaces --args '{"page": 0, "page_size": 20}'
```

---

# 查询历史任务

`list_tasks` 分页拉取某工作区下的历史任务，支持时间区间、关键词、状态、类型过滤：

```bash
# 查个人工作区最近一页任务（不传 workspace_id 即个人工作区）
atlas-skillhub gateway call-tool --service liclick --tool list_tasks

# 指定工作区 + 翻页 + 时间区间 + 关键词 + 类型过滤
atlas-skillhub gateway call-tool --service liclick --tool list_tasks --args '{
  "workspace_id": "<可选，来自 list_workspaces>",
  "page": 0,
  "page_size": 20,
  "start_date": "2026-05-01",
  "end_date": "2026-05-25",
  "keyword": "<按任务名称模糊搜索>",
  "statuses": ["Finished", "Failed"],
  "task_types": ["image", "video", "model_3d", "music"]
}'
```

- `start_date` / `end_date` 格式为 `YYYY-MM-DD`，按任务创建时间过滤。
- 返回每条任务含 `request_id` / `status` / `task_type` / `name` / `source`；`has_more=true` 时把 `page` 加 1 继续翻页。
- 拿到 `request_id` 后可用 `get_task_status`（`task_id=request_id`）查单个任务的结果 URL。
- **`source` 字段**：经本 skill（MCP）提交的任务会标记 `source=mcp`，便于在历史里识别；前端 / Web 提交的任务 `source` 为 `null`。无需手动传，提交时自动打标。

---

# 注意事项

- 所有调用必须通过 `atlas-skillhub gateway` CLI，不得手写 curl 或直接拼请求
- 模型名和 `extra_params` 规格以 `list-tools` 返回的工具描述为准，不要硬编码
- 图片任务通常 1~2 分钟完成，视频任务可能需要 5~20 分钟，3D 模型任务通常 3~10 分钟，音乐任务通常 1~5 分钟，请耐心轮询
- `generate_model_3d` 的文件类参数支持 `asset:<id>` / URL / data URI / 本地路径（仅 stdio）四种形式。**远程 gateway 调用下，"本地路径" 指的是 MCP server 端的文件系统，不是用户机器** —— 用户给的本地图片或本地 3D 模型，必须先 `upload_asset`（图片用 `asset_type=image`，3D 模型用 `asset_type=model_3d`）拿 `asset_id`，再以 `"asset:<asset_id>"` 形式传入
- 任务完成后务必将结果文件下载到本地，不只是展示 URL
