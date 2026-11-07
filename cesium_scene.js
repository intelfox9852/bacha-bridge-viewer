import {makeProjectSampler,makeEnvironmentTerrain} from './cesium_terrain.js?v=14c89545d6f9';
import {setupObliqueLayer} from './oblique_layer.js?v=14c89545d6f9';
const C=window.Cesium,$=id=>document.getElementById(id),rev=new URL(import.meta.url).searchParams.get('v')||'local',url=name=>'./'+name+'?v='+encodeURIComponent(rev);
const stats={demTiles:0,demFailures:0,terrainTiles:0,imageryTiles:0,imageryFailures:0},models={},layers={},settings={east:0,north:0,height:0,yaw:0};let viewer,frame,config,sampler,ready=false,imageryMode='satellite';
const steelControls={'steel-web':'steelWeb','steel-top':'steelTop','steel-bottom':'steelBottom'},modelControls={bridge:'bridgeLayer',terrain:'projectLayer',water:'waterLayer','site-buildings':'siteBuildings','site-roads':'siteRoads','site-walls':'siteWalls','site-land':'siteLand','site-ponds':'sitePonds',...steelControls},pendingModels=new Map();
function updateBridgeAlpha(){if(models.bridge){const transparent=$('steelXray').checked&&Object.values(steelControls).some(id=>$(id).checked);models.bridge.color=new C.Color(1,1,1,transparent ? .22 : 1);viewer.scene.requestRender()}}
function error(message){$('error').hidden=false;$('error').textContent=message}
function updateStatus(){if(!viewer)return;$('status').textContent=`Cesium ${C.VERSION} · ${window.CESIUM_EXPERIMENT ? viewer.scene.context.rendererType+' 试验版 · ' : ''}${ready?'桥梁与工程地形已加载':'正在加载工程模型…'} · 环境DEM ${stats.demTiles}片 · 影像 ${stats.imageryTiles}片`+(stats.demFailures?' · 部分DEM请求失败，局部回退参考面':'');viewer.scene.requestRender()}
function makeFrame(){
 const p=window.proj4(config.projection,'EPSG:4326',[config.engineering_origin.E,config.engineering_origin.N]),q=window.proj4(config.projection,'EPSG:4326',[config.engineering_origin.E+config.grid_axis[0]*100,config.engineering_origin.N+config.grid_axis[1]*100]);
 const lat=C.Math.toRadians(p[1]),ecc2=.0066943799901413165,n=6378137/Math.sqrt(1-ecc2*Math.sin(lat)**2),m=6378137*(1-ecc2)/(1-ecc2*Math.sin(lat)**2)**1.5;
 const theta=Math.atan2(C.Math.toRadians(q[1]-p[1])*m,C.Math.toRadians(q[0]-p[0])*n*Math.cos(lat))+C.Math.toRadians(settings.yaw);
 const lon=C.Math.toRadians(p[0])+settings.east/(n*Math.cos(lat)),phi=lat+settings.north/m,origin=C.Cartesian3.fromRadians(lon,phi,settings.height),enu=C.Transforms.eastNorthUpToFixedFrame(origin),rotation=C.Matrix3.fromRotationZ(theta),local=C.Matrix4.fromRotationTranslation(rotation);
 return {lon,lat:phi,cos:Math.cos(theta),sin:Math.sin(theta),eastRadius:n*Math.cos(phi),northRadius:m,height:settings.height,origin,matrix:C.Matrix4.multiply(enu,local,new C.Matrix4()),longitude:C.Math.toDegrees(lon),latitude:C.Math.toDegrees(phi)};
}
function terrain(){return makeEnvironmentTerrain(C,{getFrame:()=>frame,sampler,useDem:$('dem').checked,getProjectVisible:()=>$('projectLayer').checked,stats,onChange:updateStatus})}
function frameView(mode,animate=true){
 const range={bridge:1750,near:6500,region:26000,top:1500,earth:18000000,tendons:330}[mode]||1750,pitch=mode==='top'?-Math.PI/2:mode==='earth'?-Math.PI/2:C.Math.toRadians(mode==='tendons'?-28:-42);
 if(mode==='earth'){viewer.camera.flyTo({destination:C.Cartesian3.fromRadians(frame.lon,frame.lat,range),duration:animate?1.4:0});return}
 viewer.camera.flyToBoundingSphere(new C.BoundingSphere(frame.origin,1),{offset:new C.HeadingPitchRange(0,pitch,range),duration:animate?1.2:0});viewer.scene.requestRender();
}
function setImagery(mode){
 imageryMode=mode;
 if(!layers[mode]&&mode!=='offline'){
  const provider=mode==='satellite'?new C.UrlTemplateImageryProvider({url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',maximumLevel:19,credit:new C.Credit('Esri, Maxar, Earthstar Geographics, and the GIS User Community',true)}):new C.OpenStreetMapImageryProvider({url:'https://tile.openstreetmap.org/',maximumLevel:19,credit:new C.Credit('© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',true)});
  const request=provider.requestImage.bind(provider);provider.requestImage=(...args)=>{const result=request(...args);if(!result)return result;return Promise.resolve(result).then(image=>{stats.imageryTiles++;updateStatus();return image})};
  provider.errorEvent.addEventListener(e=>{stats.imageryFailures++;if(e.timesRetried<1)e.retry=true;if(stats.imageryFailures>4)$('hint').textContent='在线影像部分请求失败，可切换道路地图或离线底图。'});
  layers[mode]=viewer.imageryLayers.addImageryProvider(provider);
 }
 for(const [name,layer] of Object.entries(layers))layer.show=name==='offline'||name===mode;
 $('imagery').value=mode;viewer.scene.requestRender();
}
async function createModel(kind){
 const model=await C.Model.fromGltfAsync({url:url('scene-assets/'+kind+'.glb'),modelMatrix:frame.matrix,upAxis:C.Axis.Y,forwardAxis:C.Axis.X,shadows:C.ShadowMode.DISABLED,enableVerticalExaggeration:false,id:{kind}});models[kind]=model;viewer.scene.primitives.add(model);
 if(kind==='water')model.color=new C.Color(1,1,1,Number($('waterAlpha').value)/100);
 model.show=$(modelControls[kind]).checked;model.errorEvent.addEventListener(e=>error('工程模型渲染失败：'+e.message));updateBridgeAlpha();
 viewer.scene.requestRender();if(!model.ready)await new Promise(resolve=>model.readyEvent.addEventListener(resolve));return model;
}
function loadModel(kind){if(pendingModels.has(kind))return pendingModels.get(kind);if(models[kind])return Promise.resolve(models[kind]);const p=createModel(kind).finally(()=>pendingModels.delete(kind));pendingModels.set(kind,p);return p}
function applySettings(save){
 const values={};for(const key of Object.keys(settings)){const n=Number($(key).value);if(!Number.isFinite(n)||Math.abs(n)>(key==='yaw'?180:10000)){error('微调值无效，请输入合理的有限数值。');return}values[key]=n}
 Object.assign(settings,values);frame=makeFrame();for(const model of Object.values(models))model.modelMatrix=C.Matrix4.clone(frame.matrix);viewer.terrainProvider=terrain();$('error').hidden=true;
 if(save)try{localStorage.setItem('bacha-cesium-location-v1',JSON.stringify(settings))}catch{}
 $('alignment').textContent=`近似定位 ${frame.longitude.toFixed(7)}°E / ${frame.latitude.toFixed(7)}°N · 未经当地控制点校核`;
 frameView('bridge');
}
async function main(){
 if(!C)throw new Error('Cesium脚本未加载，请刷新重试。');C.Ion.defaultAccessToken='';
 [config]=await Promise.all([fetch(url('大场景定位与数据说明.json')).then(r=>{if(!r.ok)throw new Error('定位文件 HTTP '+r.status);return r.json()})]);
 const [surface,river]=await Promise.all(['terrain/surface.json','terrain/river.json'].map(n=>fetch(url(n)).then(r=>{if(!r.ok)throw Error(n+' HTTP '+r.status);return r.json()})));sampler=makeProjectSampler(surface,river);
 try{const s=JSON.parse(localStorage.getItem('bacha-cesium-location-v1'));for(const k of Object.keys(settings))if(Number.isFinite(s?.[k])&&Math.abs(s[k])<=(k==='yaw'?180:10000))settings[k]=s[k]}catch{}
 for(const k of Object.keys(settings))$(k).value=settings[k];frame=makeFrame();
 const viewerOptions={baseLayer:false,baseLayerPicker:false,animation:false,timeline:false,geocoder:false,homeButton:false,navigationHelpButton:false,sceneModePicker:false,selectionIndicator:false,infoBox:false,requestRenderMode:true,maximumRenderTimeChange:Infinity,terrainProvider:terrain()};
 if(window.CESIUM_EXPERIMENT){
  const backend=new URL(location.href).searchParams.get('renderer')==='webgl'?'webgl':'webgpu';
  if(backend==='webgpu'&&(!isSecureContext||!navigator.gpu))throw Error('当前浏览器未提供WebGPU，请使用支持WebGPU的Chrome／Edge，并从localhost或HTTPS打开');
  viewer=await C.Viewer.createAsync('globe',{...viewerOptions,contextOptions:{renderer:backend}});
  if(backend==='webgpu'&&!viewer.scene.context.isWebGPU)throw Error('WebGPU未成功启用，实际后端为'+viewer.scene.context.rendererType);
 }else viewer=new C.Viewer('globe',viewerOptions);
 if(window.CESIUM_EXPERIMENT){
  viewer.scene.globe.nightImagery=false;
  if(viewer.scene.context.isWebGPU){
   $('steelXray').checked=false;$('steelXray').disabled=true;$('waterAlpha').disabled=true;
   $('steelXray').parentElement.title='此社区分支的模型透明度尚未通过画面对照；请隐藏桥梁模型查看钢束。';
   $('waterAlpha').parentElement.title='WebGPU模型透明度存在兼容问题，当前水体按实体蓝色显示。';
   $('compatibility').hidden=false;
  }
 }
 viewer.scene.globe.depthTestAgainstTerrain=true;viewer.scene.globe.maximumScreenSpaceError=3;viewer.scene.screenSpaceCameraController.minimumZoomDistance=8;viewer.scene.globe.baseColor=C.Color.fromCssColorString('#6a8794');viewer.scene.postProcessStages.fxaa.enabled=true;viewer.scene.globe.tileLoadProgressEvent.addEventListener(n=>{stats.pendingTiles=n;if(n>0)viewer.scene.requestRender()});
 viewer.scene.renderError.addEventListener((scene,e)=>error('场景渲染失败：'+e.message));
 const offline=await C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl('Assets/Textures/NaturalEarthII'));layers.offline=viewer.imageryLayers.addImageryProvider(offline);setImagery('satellite');frameView('bridge',false);
 $('alignment').textContent=`北京54通用参数近似定位 ${frame.longitude.toFixed(7)}°E / ${frame.latitude.toFixed(7)}°N`;$('alignment').title=config.notes.join('\n');
 for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>frameView(button.dataset.view);
 if($('siteView'))$('siteView').onclick=()=>{$('projectLayer').checked=true;if(models.terrain)models.terrain.show=true;viewer.terrainProvider=terrain();frameView('bridge')};
 $('imagery').onchange=()=>setImagery($('imagery').value);$('dem').onchange=()=>{viewer.terrainProvider=terrain();viewer.scene.requestRender()};
 for(const [id,kind] of [['bridgeLayer','bridge'],['projectLayer','terrain'],['waterLayer','water'],['siteBuildings','site-buildings'],['siteRoads','site-roads'],['siteWalls','site-walls'],['siteLand','site-land'],['sitePonds','site-ponds']])if($(id))$(id).onchange=()=>{if(models[kind])models[kind].show=$(id).checked;if(kind==='terrain')viewer.terrainProvider=terrain();viewer.scene.requestRender()};
 $('waterAlpha').oninput=()=>{if(models.water)models.water.color=new C.Color(1,1,1,Number($('waterAlpha').value)/100);viewer.scene.requestRender()};
 for(const [kind,id] of Object.entries(steelControls))$(id).onchange=async()=>{updateBridgeAlpha();if(!$(id).checked){if(models[kind])models[kind].show=false;viewer.scene.requestRender();return}try{$('hint').textContent='正在加载'+$(id).parentElement.textContent.trim()+'…';const m=await loadModel(kind);m.show=$(id).checked;$('hint').textContent='钢束已按图纸分组；可独立显隐，或进入桥梁细部查看。';viewer.scene.requestRender()}catch(e){$(id).checked=false;updateBridgeAlpha();error('钢束加载失败：'+e.message)}};
 $('steelXray').onchange=updateBridgeAlpha;
 $('apply').onclick=()=>applySettings(true);$('reset').onclick=()=>{for(const k of Object.keys(settings))$(k).value=0;try{localStorage.removeItem('bacha-cesium-location-v1')}catch{}applySettings(false)};
 $('menu').onclick=()=>{const hidden=!$('panel').hidden;$('panel').hidden=hidden;$('menu').textContent=hidden?'展开菜单':'隐藏菜单';$('menu').setAttribute('aria-expanded',String(!hidden))};
 addEventListener('keydown',e=>{if((e.key==='h'||e.key==='H')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))$('menu').click()});
 const oblique=setupObliqueLayer(C,viewer);
 window.cesiumBridge={viewer,models,stats,config,settings,sampler,frameView,setImagery,oblique,get frame(){return frame},get ready(){return ready},get imageryMode(){return imageryMode}};
 updateStatus();await Promise.all(['bridge','terrain','water'].map(loadModel));if($('siteBuildings'))await Promise.all(['site-buildings','site-roads','site-walls','site-land','site-ponds'].filter(k=>config.assets[k]).map(loadModel));ready=true;updateStatus();
}
main().catch(e=>{console.error(e);error('Cesium大场景加载失败：'+e.message+'。可返回桥梁细部查看器。')});
