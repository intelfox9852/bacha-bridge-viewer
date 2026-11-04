const decodePath=value=>{try{return decodeURIComponent(value)}catch{return value}};
// 3D Tiles loader. Local folders use per-resource blob proxies; relative child
// tiles, glTF buffers, and textures keep their original directory relationships.
export function createLocalTileSource(C,files,rootPath){
 const entries=new Map(),folded=new Map(),urls=new Map(),prefix='/'+crypto.randomUUID()+'/';let disposed=false;
 for(const file of files){const path=(file.webkitRelativePath||file.name).replaceAll('\\','/');entries.set(path,file);const lower=path.toLowerCase();folded.set(lower,folded.has(lower)?null:path)}
 if(!entries.has(rootPath))throw Error('未找到所选入口文件');
 const base='https://local-3dtiles.invalid'+prefix;
 const proxy={getURL(address){
  if(!address.startsWith(base))return address;
  if(disposed)throw Error('本地数据目录已释放');
  const path=decodePath(new URL(address).pathname.slice(prefix.length)),key=entries.has(path)?path:folded.get(path.toLowerCase()),file=key&&entries.get(key);
  if(!file)throw Error('本地目录缺少文件：'+path);
  if(!urls.has(key)){
   const ext=key.split('.').at(-1).toLowerCase(),mime={json:'application/json',gltf:'model/gltf+json',glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',ktx2:'image/ktx2'}[ext]||'application/octet-stream';
   urls.set(key,URL.createObjectURL(file.slice(0,file.size,mime)));
  }
  return urls.get(key);
 }};
 return {resource:new C.Resource({url:base+rootPath.split('/').map(encodeURIComponent).join('/'),proxy}),dispose(){if(disposed)return;disposed=true;for(const u of urls.values())URL.revokeObjectURL(u);urls.clear()},get urlCount(){return urls.size},name:rootPath};
}

export function setupObliqueLayer(C,viewer){
 const $=id=>document.getElementById(id);if(!$('obliqueControls'))return null;
 const status=$('obliqueStatus'),rootSelect=$('obliqueLocalRoot');let active=null,ticket=0,directoryTicket=0,localFiles=[];
 const notify=(text,failed=false)=>{status.textContent=text;status.style.color=failed?'#ffb39a':'#afcddd';viewer.scene.requestRender()};
 const sync=()=>{for(const id of ['obliqueShow','obliqueFocus','obliqueRemove','obliqueApply','obliqueReset','obliqueQuality'])$(id).disabled=!active;$('obliqueCurrent').textContent=active?'当前数据：'+active.label:'当前数据：未加载'};
 const removeCurrent=entry=>{if(!entry)return;if(viewer.scene.primitives.contains(entry.tileset))viewer.scene.primitives.remove(entry.tileset);else if(!entry.tileset.isDestroyed())entry.tileset.destroy();entry.source?.dispose()};
 function focus(animate=true){if(!active)return;active.tileset.show=true;$('obliqueShow').checked=true;viewer.camera.flyToBoundingSphere(active.tileset.boundingSphere,{offset:new C.HeadingPitchRange(0,C.Math.toRadians(-35),Math.max(100,active.tileset.boundingSphere.radius*2.5)),duration:animate?1.2:0});viewer.scene.requestRender()}
 async function load(resource,source,label){
  const mine=++ticket;notify('正在读取倾斜摄影入口…');let tileset;
  try{
   tileset=await C.Cesium3DTileset.fromUrl(resource,{maximumScreenSpaceError:Number($('obliqueQuality').value),cacheBytes:256*1024*1024,maximumCacheOverflowBytes:128*1024*1024,dynamicScreenSpaceError:true,enableCollision:true});
   if(mine!==ticket){tileset.destroy();source?.dispose();return false}
   const center=C.Cartesian3.clone(tileset.boundingSphere.center),radius=C.Cartesian3.magnitude(center);
   if(radius<5e6||radius>8e6)throw Error('该数据没有有效的地球定位。请确认转换时的坐标系及原点，暂未自动放到桥位。');
   const entry={tileset,source,label,center,baseMatrix:C.Matrix4.clone(tileset.modelMatrix),loads:0,failures:0};
   tileset.tileLoad.addEventListener(()=>{if(active!==entry)return;entry.loads++;notify(`倾斜摄影已加载 · ${entry.loads}次瓦片载入${entry.failures?' · 部分瓦片失败':''}`)});
   tileset.tileFailed.addEventListener(e=>{if(active!==entry)return;entry.failures++;notify('部分倾斜摄影瓦片加载失败：'+(e.message||'请检查子文件与跨域设置'),true)});
   tileset.allTilesLoaded.addEventListener(()=>{if(active===entry&&!entry.failures)notify('倾斜摄影：当前视野瓦片加载完成')});
   viewer.scene.primitives.add(tileset);const old=active;active=entry;removeCurrent(old);
   $('obliqueShow').checked=true;for(const id of ['obliqueEast','obliqueNorth','obliqueHeight'])$(id).value=0;
   sync();notify('入口已加载，正在请求倾斜摄影瓦片…');focus();return true;
  }catch(e){if(tileset&&!tileset.isDestroyed())tileset.destroy();source?.dispose();if(mine===ticket)notify('倾斜摄影加载失败：'+e.message,true);sync();return false}
 }
 async function loadUrl(value){
  const address=value.trim();
  if(!address){notify('请输入 tileset.json 地址。',true);return false}
  if(/^[A-Za-z]:[\\/]/.test(address)){notify('本地路径请使用“选择本地目录”，或提供本地HTTP服务的 tileset.json 地址。',true);return false}
  let parsed;try{parsed=new URL(address,location.href)}catch{notify('服务地址格式无效。',true);return false}
  if(!['http:','https:'].includes(parsed.protocol)){notify('服务地址需使用HTTP或HTTPS；本地文件请选择整个目录。',true);return false}
  return load(new C.Resource({url:parsed.href}),null,parsed.host+decodePath(parsed.pathname));
 }
 async function indexFiles(files){
  const mine=++directoryTicket;localFiles=Array.from(files);rootSelect.replaceChildren();$('obliqueLoadFolder').disabled=true;
  let candidates=localFiles.filter(f=>/(^|\/)tileset\.json$/i.test(f.webkitRelativePath||f.name));
  if(!candidates.length){
   const jsons=localFiles.filter(f=>f.name.toLowerCase().endsWith('.json')).sort((a,b)=>(a.webkitRelativePath||a.name).length-(b.webkitRelativePath||b.name).length).slice(0,40);
   for(const f of jsons)try{const data=JSON.parse(await f.text());if(data.asset&&data.root?.boundingVolume)candidates.push(f)}catch{}
  }
  if(mine!==directoryTicket)return false;
  candidates.sort((a,b)=>{const x=a.webkitRelativePath||a.name,y=b.webkitRelativePath||b.name;return x.split('/').length-y.split('/').length||x.localeCompare(y)});
  for(const f of candidates){const option=document.createElement('option');option.value=f.webkitRelativePath||f.name;option.textContent=option.value;rootSelect.append(option)}
  $('obliqueLoadFolder').disabled=!candidates.length;
  if(!candidates.length){notify(localFiles.some(f=>f.name.toLowerCase().endsWith('.osgb'))?'目录中有OSGB，但没有3D Tiles入口；请先转换为3D Tiles。':'该目录未找到可用的3D Tiles入口。',true);return false}
  notify(`已选择${localFiles.length}个本地文件，请确认入口后点击“加载所选目录”。本地文件不会上传。`);return true;
 }
 async function loadFolder(){if(!localFiles.length||!rootSelect.value)return false;try{const source=createLocalTileSource(C,localFiles,rootSelect.value);return await load(source.resource,source,source.name)}catch(e){notify('本地目录加载失败：'+e.message,true);return false}}
 function applyOffsets(){
  if(!active)return false;const values=['obliqueEast','obliqueNorth','obliqueHeight'].map(id=>Number($(id).value));
  if(values.some(v=>!Number.isFinite(v)||Math.abs(v)>100000)){notify('偏移量需为有效数值，范围为±100000米。',true);return false}
  const enu=C.Transforms.eastNorthUpToFixedFrame(active.center),delta=C.Matrix4.multiplyByPointAsVector(enu,new C.Cartesian3(...values),new C.Cartesian3()),translation=C.Matrix4.fromTranslation(delta);
  active.tileset.modelMatrix=C.Matrix4.multiply(translation,active.baseMatrix,new C.Matrix4());notify('倾斜摄影位置偏移已应用；桥梁定位保持独立。');return true;
 }
 $('obliqueLoadUrl').onclick=()=>loadUrl($('obliqueUrl').value);
 $('obliqueFolder').onchange=async()=>{notify('正在索引本地目录…');try{await indexFiles($('obliqueFolder').files)}catch(e){notify('目录读取失败：'+e.message,true)}};
 $('obliqueLoadFolder').onclick=loadFolder;$('obliqueFocus').onclick=()=>focus();
 $('obliqueShow').onchange=()=>{if(active){active.tileset.show=$('obliqueShow').checked;viewer.scene.requestRender()}};
 $('obliqueApply').onclick=applyOffsets;$('obliqueReset').onclick=()=>{for(const id of ['obliqueEast','obliqueNorth','obliqueHeight'])$(id).value=0;applyOffsets()};
 $('obliqueQuality').onchange=()=>{if(active){active.tileset.maximumScreenSpaceError=Number($('obliqueQuality').value);viewer.scene.requestRender()}};
 const remove=()=>{ticket++;const old=active;active=null;removeCurrent(old);sync();notify('倾斜摄影已移除。')};$('obliqueRemove').onclick=remove;
 sync();notify('尚未加载倾斜摄影。可输入3D Tiles地址或选择本地目录。');
 return {loadUrl,indexFiles,loadFolder,focus,remove,applyOffsets,get active(){return active}};
}
