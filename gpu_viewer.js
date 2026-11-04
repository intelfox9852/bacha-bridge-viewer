import * as T from 'three/webgpu';
import {OrbitControls} from './vendor/OrbitControls.js';
import {createTerrainBasemap} from './terrain_viewer.js?v=caf711ec5d39';
const $=id=>document.getElementById(id),status=$('status'),tip=$('tip');
let renderer,scene,camera,controls,groups=[],displayMode=1,wire=false,xray=true,measuring=false,points=[],markers,scheduled=false,numberLabels=[],numbersVisible=true;
let selectionRoot,selectedUnit=null;const units=new Map();
let divisionColors=true;
let basemap=null;
let previewGroups=[],sectionState=null,sectionIndex=-1;
const menuButton=$('menuToggle');
menuButton.onclick=()=>{const hidden=!$('viewerMenu').hidden;$('viewerMenu').hidden=hidden;menuButton.textContent=hidden?'展开菜单':'隐藏菜单';menuButton.setAttribute('aria-expanded',String(!hidden))};
addEventListener('keydown',e=>{if(e.key==='Escape')clearSelection();if((e.key==='h'||e.key==='H')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){menuButton.click()}});
const palette=[0xb4c1cb,0x859dac,0xae9064,0x394852,0xd6c799,0xff6126,0x26d9eb,0xa38ce5];
function invalidate(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;renderer.render(scene,camera);updateNumberLabels()})}
function updateNumberLabels(){if(!camera)return;const W=innerWidth,H=innerHeight;for(let i=0;i<numberLabels.length;i++){const item=numberLabels[i],p=item.position.clone().project(camera);const visible=numbersVisible&&!sectionState&&p.z>=-1&&p.z<=1&&Math.abs(p.x)<1.1&&Math.abs(p.y)<1.1;item.element.hidden=!visible;if(visible){item.element.style.left=((p.x+1)*W/2)+'px';item.element.style.top=((1-p.y)*H/2-(i%3)*17)+'px'}}}
function toggle(id,state,text){$(id).setAttribute('aria-pressed',state);$(id).textContent=text}
function frame(view){clearSelection();exitSections();const target=view==='railing'?new T.Vector3(-2.4,15.1,8.75):view==='approachCap'?new T.Vector3(-352.62,5.5,0):view==='westAbutment'?new T.Vector3(-472.35,3,0):view==='abutment'?new T.Vector3(388.34,3,0):view==='mainPier'?new T.Vector3(-52.4,-1,0):view==='transition'?new T.Vector3(-112.4,6,0):view==='pile'?new T.Vector3(-52.4,-34,0):view==='all'?new T.Vector3(-42.4,-25,0):new T.Vector3(-2.4,9,0);const span=view==='railing'?7:view==='approachCap'?26:(view==='abutment'||view==='westAbutment')?48:view==='mainPier'?50:view==='transition'?45:view==='pile'?125:view==='all'?950:280;camera.left=-span/2;camera.right=span/2;camera.top=span/2*innerHeight/innerWidth;camera.bottom=-camera.top;camera.zoom=1;camera.updateProjectionMatrix();controls.target.copy(target);const offset=view==='top'?new T.Vector3(0,500,.001):view==='side'?new T.Vector3(0,0,500):new T.Vector3(180,230,500);camera.position.copy(target).add(offset);camera.up.set(0,1,0);controls.update();invalidate()}
function ensureOutline(g){
 if(g.userData.tendon||g.userData.outline)return;
 const edges=new T.EdgesGeometry(g.geometry,20);
 const line=new T.LineSegments(edges,new T.LineBasicMaterial({color:0x17212a,depthTest:true,depthWrite:false}));
 line.renderOrder=1;line.visible=false;scene.add(line);g.userData.outline=line;
}
function ensureQuadGrid(g){
 if(g.userData.quadGrid)return;
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',g.geometry.attributes.position);geometry.setIndex(g.userData.wireIndices);
 const line=new T.LineSegments(geometry,new T.LineBasicMaterial({color:palette[g.userData.mat]??g.material.color,depthTest:true,depthWrite:false}));line.renderOrder=2;line.visible=false;scene.add(line);g.userData.quadGrid=line;
}
function modes(){
 basemap?.setIsolated(Boolean(sectionState));
 wire=displayMode===2;
 for(const g of [...groups,...previewGroups]){
  if(displayMode===1)ensureOutline(g);if(wire)ensureQuadGrid(g);
  if(g.userData.outline)g.userData.outline.visible=displayMode===1&&g.visible;
  if(g.userData.quadGrid){g.userData.quadGrid.visible=wire&&g.visible;g.userData.quadGrid.material.depthTest=!(g.userData.tendon&&xray)}
  // Keep the original surface available to ray picking while only polygon edges are rendered.
  g.material.colorWrite=!wire;g.material.wireframe=false;g.material.polygonOffset=displayMode===1&&!g.userData.tendon;g.material.polygonOffsetFactor=1;g.material.polygonOffsetUnits=1;g.material.depthTest=!(g.userData.tendon&&xray);g.material.depthWrite=!wire&&!(g.userData.tendon&&xray);g.renderOrder=g.userData.tendon&&xray?2:0;g.material.needsUpdate=true;
 }
 if(selectionRoot)for(const child of selectionRoot.children){if(child.isMesh){child.visible=!wire;child.material.wireframe=false;child.material.depthTest=!(xray&&selectedUnit?.parts.some(p=>p.batch.mesh.userData.tendon));child.material.needsUpdate=true}else if(child.isLineSegments){child.material.depthTest=!(xray&&selectedUnit?.parts.some(p=>p.batch.mesh.userData.tendon))}}
 invalidate();
}
function unitKey(m){if(m.unit)return 'division|'+m.unit.id;return m.cat+'|'+(m.cat==='引桥空心板'?m.name.replace(/_(西封头|东封头|孔腔)\d+$/,''):m.name)}
function registerUnit(m,batch,startFace,endFace,wireStart=0,wireEnd=0){
 const key=unitKey(m);let unit=units.get(key);if(!unit){unit={name:m.unit?.name||key.slice(key.indexOf('|')+1),cat:m.unit?.kind||m.cat,division:m.unit?.division,controlRange:m.unit?[m.unit.start,m.unit.end]:null,status:(m.unit?m.unit.source+'；':'')+(m.status||(m.cat.includes('引桥空心板截面')?'SII-48C / SII-49B 截面样段':'SII-7A 截面样段')),parts:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};units.set(key,unit)}
 unit.parts.push({batch,startFace,endFace,wireStart,wireEnd});for(const p of m.v)for(let i=0;i<3;i++){unit.min[i]=Math.min(unit.min[i],p[i]);unit.max[i]=Math.max(unit.max[i],p[i])}return unit
}
function unitAtFace(g,face){const ranges=g.userData.ranges;if(!ranges||!Number.isInteger(face))return null;let lo=0,hi=ranges.length;while(lo<hi){const mid=(lo+hi)>>1;if(face<ranges[mid].endFace)hi=mid;else lo=mid+1}return ranges[lo]?.unit||null}
function clearSelection(){if(selectionRoot){for(const child of [...selectionRoot.children]){child.geometry.dispose();child.material.dispose()}selectionRoot.clear()}selectedUnit=null;$('selectionPanel').hidden=true;if(renderer&&scene&&camera)invalidate()}
function selectUnit(unit){
 clearSelection();if(!unit)return;selectedUnit=unit;
 for(const part of unit.parts){const source=part.batch.mesh.geometry,positions=source.attributes.position,indices=source.index;const remap=new Map(),p=[],idx=[];
  for(let i=part.startFace*3;i<part.endFace*3;i++){const old=indices.getX(i);let n=remap.get(old);if(n===undefined){n=p.length/3;remap.set(old,n);p.push(positions.getX(old),positions.getY(old),positions.getZ(old))}idx.push(n)}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(p,3));geometry.setIndex(idx);
  const material=new T.MeshBasicMaterial({color:0xffd451,side:T.DoubleSide,transparent:true,opacity:.65,depthWrite:false,depthTest:!(part.batch.mesh.userData.tendon&&xray),polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,wireframe:false});const highlight=new T.Mesh(geometry,material);highlight.renderOrder=4;highlight.visible=!wire;selectionRoot.add(highlight);
  const edgeGeometry=new T.BufferGeometry();edgeGeometry.setAttribute('position',geometry.attributes.position.clone());edgeGeometry.setIndex(part.batch.mesh.userData.wireIndices.slice(part.wireStart,part.wireEnd).map(i=>remap.get(i)));
  const edges=new T.LineSegments(edgeGeometry,new T.LineBasicMaterial({color:0xffeab3,depthTest:!(part.batch.mesh.userData.tendon&&xray),depthWrite:false}));edges.renderOrder=5;selectionRoot.add(edges)
 }
 $('selectionName').textContent=unit.name;$('selectionCategory').textContent='类别：'+unit.cat+(unit.division?' · '+unit.division:'');
 const size=unit.max.map((v,i)=>(v-unit.min[i]).toFixed(3));$('selectionSize').textContent=`模型包围尺寸：顺桥 ${size[0]} m × 横桥 ${size[1]} m × 高 ${size[2]} m`;
 const station=s=>'K'+Math.floor(s/1000)+'+'+(s%1000).toFixed(3);$('selectionStation').textContent=(unit.controlRange?'划分桩号：'+station(unit.controlRange[0])+' ～ '+station(unit.controlRange[1]):'桩号范围：'+station(unit.min[0]+1000)+' ～ '+station(unit.max[0]+1000));$('selectionSource').textContent='依据：'+unit.status;$('selectionPanel').hidden=false;invalidate()
}
function focusSelection(){if(!selectedUnit)return;const u=selectedUnit,center=u.min.map((a,i)=>(a+u.max[i])/2),target=new T.Vector3(center[0],center[2],-center[1]);const dx=u.max[0]-u.min[0],dy=u.max[1]-u.min[1],dz=u.max[2]-u.min[2],span=Math.max(5,Math.hypot(dx,dy)*1.5,dz*innerWidth/innerHeight*1.5);const direction=camera.position.clone().sub(controls.target).normalize();camera.left=-span/2;camera.right=span/2;camera.top=span/2*innerHeight/innerWidth;camera.bottom=-camera.top;camera.zoom=1;camera.updateProjectionMatrix();controls.target.copy(target);camera.position.copy(target).addScaledVector(direction,500);controls.update();invalidate()}
function showMeasurement(){for(const child of markers.children){child.geometry.dispose();child.material.dispose()}markers.clear();for(const p of points){const dot=new T.Mesh(new T.SphereGeometry(.3,10,8),new T.MeshBasicMaterial({color:0xffd451,depthTest:false}));dot.position.copy(p);dot.renderOrder=5;markers.add(dot)}if(points.length===2){const line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:0xffd451,depthTest:false}));line.renderOrder=5;markers.add(line);tip.textContent=`A—B 三维直线距离：${points[0].distanceTo(points[1]).toFixed(3)} 米（初步模型几何）`}else tip.textContent=measuring?'点击模型表面选择A、B点；自动吸附命中三角面的最近顶点。':'';invalidate()}
function exitSections(){if(!sectionState)return;groups.forEach((g,i)=>g.visible=sectionState[i]);for(const g of previewGroups){g.visible=false;if(g.userData.outline)g.userData.outline.visible=false}sectionState=null;tip.textContent='';modes()}
async function showSection(approach){
 clearSelection();
 if(!previewGroups.length){const data=await (await fetch('./上部构造剖面预览.json?v=caf711ec5d39')).json();for(const m of data){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(m.v.flatMap(([x,y,z])=>[x,z,-y]),3));geometry.setIndex(m.f.flat());const g=new T.Mesh(geometry,new T.MeshBasicMaterial({color:palette[m.mat],side:T.DoubleSide}));const batch={mesh:g};const unit=registerUnit({...m,cat:m.cat+'（剖面样段）'},batch,0,m.f.length,0,m.w.length*2);g.userData={cat:m.cat,tendon:false,ranges:[{endFace:m.f.length,unit}],wireIndices:m.w.flat()};g.visible=false;previewGroups.push(g);scene.add(g)}}
 if(!sectionState)sectionState=groups.map(g=>g.visible);groups.forEach(g=>g.visible=false);
 const names=['跨中箱梁','根部箱梁','墩顶横梁','梁端横梁'],stations=[997.6,945.6,947.6,888.48];if(!approach)sectionIndex=(sectionIndex+1)%names.length;
 const cat=approach?'引桥空心板截面':names[sectionIndex],station=approach?537.23:stations[sectionIndex],height=approach?3.8:cat==='跨中箱梁'?13.65:cat==='梁端横梁'?12.7:12.2;
 for(const g of previewGroups)g.visible=g.userData.cat===cat;
 const span=25;camera.left=-span/2;camera.right=span/2;camera.top=span/2*innerHeight/innerWidth+1.4;camera.bottom=-span/2*innerHeight/innerWidth+1.4;camera.zoom=1;camera.updateProjectionMatrix();const target=new T.Vector3(station-1000,height,0);controls.target.copy(target);camera.position.copy(target).add(new T.Vector3(55,12,14));camera.up.set(0,1,0);controls.update();tip.textContent=approach?'引桥一般构造剖视：17块/跨，板高90cm、圆孔Φ62.5cm；剖视样段省略端部封头以展示孔腔。':'主桥一般构造剖视：'+cat+'（重复点击切换跨中/根部/墩顶/梁端；其他视图按钮返回全桥模型）';modes()
}
function showPads(main){
 clearSelection();exitSections();sectionState=groups.map(g=>g.visible);for(const g of groups)g.visible=['支座垫石','墩台'].includes(g.userData.cat);
 const target=main?new T.Vector3(-52.4,8.7,0):new T.Vector3(-352.62,6.6,0),span=main?14:5;
 camera.left=-span/2;camera.right=span/2;camera.top=span/2*innerHeight/innerWidth+span*.10;camera.bottom=-span/2*innerHeight/innerWidth+span*.10;camera.zoom=1;camera.updateProjectionMatrix();controls.target.copy(target);camera.position.copy(target).add(new T.Vector3(16,12,22));controls.update();tip.textContent=main?'主桥垫石：SII-39/43C。梁体暂隐藏以便检查，点击其他视图返回。':'引桥垫石：中心高2cm，平面暂按调平钢板46×43cm投影；单独点选可查依据。';modes()
}
async function loadModel(){
 if(typeof DecompressionStream!=='undefined'){
  try{const response=await fetch('./geometry.json.gz?v=caf711ec5d39');if(response.ok&&response.body)return await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()}catch(error){console.warn('Compressed model unavailable; loading JSON fallback.',error)}
 }
 const response=await fetch('./geometry.json?v=caf711ec5d39');if(!response.ok)throw new Error('模型加载失败：HTTP '+response.status);return response.json()
}
async function main(){
 renderer=new T.WebGPURenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);await renderer.init();document.body.append(renderer.domElement);
 scene=new T.Scene();scene.background=new T.Color(0x14212c);camera=new T.OrthographicCamera(-425,425,240,-240,.1,3000);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.addEventListener('change',invalidate);markers=new T.Group();scene.add(markers);selectionRoot=new T.Group();scene.add(selectionRoot);$('selectionClear').onclick=clearSelection;$('selectionFocus').onclick=focusSelection;
 status.textContent='正在加载并合并模型缓冲区…';
 const labels=await (await fetch('./墩台编号.json?v=caf711ec5d39')).json();
 for(const item of labels){const element=document.createElement('span');element.className='pier-number';element.textContent=item.name;element.title=`${item.name} / K${Math.floor(item.station/1000)}+${(item.station%1000).toFixed(3)} / ${item.source}`;$('pierNumbers').append(element);numberLabels.push({element,position:new T.Vector3(item.station-1000,item.elevation,12)})}
 $('numbers').onclick=()=>{numbersVisible=!numbersVisible;toggle('numbers',numbersVisible,numbersVisible?'墩台号：显示':'墩台号：隐藏');invalidate()};

 const raw=await loadModel(),batches=new Map();
 for(const m of raw){const key=m.cat+'|'+m.mat;if(!batches.has(key))batches.set(key,{cat:m.cat,mat:m.mat,p:[],idx:[],wire:[],colors:[],ranges:[]});const b=batches.get(key),off=b.p.length/3,startFace=b.idx.length/3;const shade=m.unit?(m.unit.ordinal%2?1.08:.78):1,c=new T.Color(palette[m.mat]).multiplyScalar(shade);for(const [x,y,z] of m.v){b.p.push(x,z,-y);b.colors.push(c.r,c.g,c.b)}for(const f of m.f)for(const i of f)b.idx.push(i+off);const endFace=b.idx.length/3,wireStart=b.wire.length;for(const [a,c] of m.w)b.wire.push(a+off,c+off);b.ranges.push({endFace,unit:registerUnit(m,b,startFace,endFace,wireStart,b.wire.length)})}
 for(const b of batches.values()){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(b.p,3));geometry.setAttribute('color',new T.Float32BufferAttribute(b.colors,3));geometry.setIndex(b.idx);geometry.computeBoundingSphere();const material=new T.MeshBasicMaterial({color:divisionColors?0xffffff:palette[b.mat],vertexColors:divisionColors,side:T.DoubleSide});const mesh=new T.Mesh(geometry,material);mesh.userData={cat:b.cat,mat:b.mat,tendon:b.mat>=5,ranges:b.ranges,wireIndices:b.wire};mesh.visible=!b.cat.includes('待核对')&&!b.cat.includes('预留孔道');b.mesh=mesh;groups.push(mesh);scene.add(mesh);delete b.p;delete b.idx;delete b.wire;delete b.colors}
 for(const cat of new Set(groups.map(g=>g.userData.cat))){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=groups.find(g=>g.userData.cat===cat).visible;input.onchange=()=>{clearSelection();groups.filter(g=>g.userData.cat===cat).forEach(g=>g.visible=input.checked);modes()};label.append(input,cat);$('cats').append(label)}
 $('all').onclick=()=>frame('all');$('main').onclick=()=>frame('main');$('side').onclick=()=>frame('side');$('top').onclick=()=>frame('top');$('pile').onclick=()=>frame('pile');$('mainPier').onclick=()=>frame('mainPier');$('approachCap').onclick=()=>frame('approachCap');$('railing').onclick=()=>frame('railing');$('abutment').onclick=()=>frame('abutment');$('westAbutment').onclick=()=>frame('westAbutment');$('transition').onclick=()=>frame('transition');
 $('mainPads').onclick=()=>showPads(true);$('approachPads').onclick=()=>showPads(false);
 $('mainSection').onclick=()=>showSection(false);$('approachSection').onclick=()=>showSection(true);
 $('divisionColors').onclick=()=>{divisionColors=!divisionColors;toggle('divisionColors',divisionColors,divisionColors?'分段着色：开启':'分段着色：关闭');for(const g of groups){g.material.vertexColors=divisionColors;g.material.color.set(divisionColors?0xffffff:palette[g.userData.mat]);g.material.needsUpdate=true}invalidate()};
 $('wire').onclick=()=>{displayMode=(displayMode+1)%3;toggle('wire',displayMode!==0,['显示：实体','显示：实体＋轮廓','显示：四边形线框'][displayMode]);modes()};$('xray').onclick=()=>{xray=!xray;toggle('xray',xray,xray?'钢束透视：开启':'钢束透视：关闭');modes()};$('measure').onclick=()=>{measuring=!measuring;toggle('measure',measuring,measuring?'测量：开启':'测量：关闭');showMeasurement()};$('clear').onclick=()=>{points=[];showMeasurement()};
 const ray=new T.Raycaster();let down=null;renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(e.button!==0||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;const rect=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hits=ray.intersectObjects([...groups,...previewGroups].filter(g=>g.visible));if(!hits.length){if(measuring)tip.textContent='未选中模型，请放大后点击构件表面。';else clearSelection();return}let hit=hits[0];if(xray){const tendonHit=hits.find(h=>h.object.userData.tendon);if(tendonHit)hit=tendonHit}if(!measuring){selectUnit(unitAtFace(hit.object,hit.faceIndex));return}const pos=hit.object.geometry.attributes.position;const vertices=[hit.face.a,hit.face.b,hit.face.c].map(i=>new T.Vector3().fromBufferAttribute(pos,i));vertices.sort((a,b)=>a.distanceToSquared(hit.point)-b.distanceToSquared(hit.point));if(points.length===2)points=[];points.push(vertices[0]);showMeasurement()});
 addEventListener('resize',()=>{const width=camera.right-camera.left;camera.top=width/2*innerHeight/innerWidth+(sectionState?1.4:0);camera.bottom=-width/2*innerHeight/innerWidth+(sectionState?1.4:0);camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);invalidate()});
 modes();frame('all');await renderer.renderAsync(scene,camera);status.textContent=`${renderer.backend.isWebGPUBackend?'WebGPU':'WebGL2 兼容模式'} · ${raw.length}个构件合并为${groups.length}批次 · 按需重绘`;window.bridgeViewer={renderer,scene,camera,groups,previewGroups,frame,get basemap(){return basemap},get selectedUnit(){return selectedUnit?.name||null}};
 try{basemap=await createTerrainBasemap({scene,renderer,camera,controls,invalidate,beforeFrame:()=>{clearSelection();exitSections()}});basemap.setIsolated(Boolean(sectionState))}catch(error){console.warn('地形底图未加载',error);$('terrainStatus').textContent='地形底图加载失败，可刷新重试；桥梁仍可浏览。'}
}
main().catch(e=>{console.error(e);status.textContent='GPU初始化失败：'+e.message+'。可打开“旧版Canvas查看器.html”。'});
