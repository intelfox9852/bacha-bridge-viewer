# 八坼大桥三维查看器

静态网站，WebGPU优先，兼容WebGL2。包含旋转、缩放、线框、构件分类、测距和预应力钢束示意。

## 发布

将本目录文件上传到GitHub仓库根目录。进入 Settings → Pages → Build and deployment，Source选 Deploy from a branch，Branch选 main，目录选 / (root)，保存。

入口 index.html 必须位于根目录，vendor 文件夹需完整上传。资源路径均为相对路径，支持仓库子路径。

模型为初步示意，尺寸和预应力线形未按DWG核验，不用于施工放样或精确算量。
