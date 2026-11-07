import * as T from 'three/webgpu';

const colors={'建筑':0xc5c3b9,'简易房':0xc7bba5,'棚房':0xb6aa8b,'道路铺面':0x596167,'围护边界':0xa49e8e,'改造陆地':0x718665,'池塘':0x3f91ad};
export async function createSiteFeatures({root,camera,controls,invalidate,beforeFrame}){
 let data;
 if(typeof DecompressionStream!=='undefined')try{const response=await fetch('./地物模型.json.gz?v=14c89545d6f9');if(response.ok&&response.body)data=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()}catch(error){console.warn('地物压缩数据不可用，回退JSON',error)}
 if(!data){const response=await fetch('./地物模型.json?v=14c89545d6f9');if(!response.ok)throw Error('地物数据 HTTP '+response.status);data=await response.json()}
 const group=new T.Group();group.name='原地形图三维地物';root.add(group);
 const pickables=[],batches=new Map();let selected=null,highlight=null,displayMode=1;
 for(const f of data.features){let b=batches.get(f.kind);if(!b){b={kind:f.kind,p:[],c:[],idx:[],w:[],ranges:[]};batches.set(f.kind,b)}const off=b.p.length/3,r=f.render||f;for(let j=0;j<r.v.length;j++){const [x,y,z]=r.v[j];b.p.push(x,z,-y);if(r.c)b.c.push(...r.c[j]);else{const color=new T.Color(colors[f.kind]).multiplyScalar(f.height_m===null?1:z>f.top_m-.01?1.06:.8);b.c.push(color.r,color.g,color.b)}}for(const face of r.f)for(const i of face)b.idx.push(i+off);for(const edge of r.w)for(const i of edge)b.w.push(i+off);b.ranges.push({end:b.idx.length/3,feature:f})}
 for(const b of batches.values()){
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(b.p,3));geometry.setIndex(b.idx);geometry.setAttribute('color',new T.Float32BufferAttribute(b.c,3));geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color:0xffffff,vertexColors:true,side:T.DoubleSide,polygonOffset:!['池塘','改造陆地','道路铺面'].includes(b.kind),polygonOffsetFactor:1,polygonOffsetUnits:1}));mesh.name=b.kind;mesh.userData.siteFeatureBatch=b;group.add(mesh);pickables.push(mesh);b.mesh=mesh;
  const edgeGeometry=new T.BufferGeometry();edgeGeometry.setAttribute('position',geometry.attributes.position);edgeGeometry.setIndex(b.w);const edges=new T.LineSegments(edgeGeometry,new T.LineBasicMaterial({color:0x4e504d,depthWrite:false}));edges.renderOrder=2;group.add(edges);b.edges=edges;
  delete b.p;delete b.c;delete b.idx;delete b.w;
 }
 const panel=document.createElement('details');panel.id='siteFeatureControls';panel.open=true;panel.style.cssText='padding:7px 10px;background:#172b3be8;border:1px solid #496271;border-radius:5px;max-width:1100px';
 const title=document.createElement('summary');title.textContent='地形图三维地物';title.style.cursor='pointer';panel.append(title);
 for(const b of batches.values()){
  const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.siteKind=b.kind;input.onchange=()=>{b.mesh.visible=input.checked;b.edges.visible=input.checked&&displayMode!==0;if(selected?.kind===b.kind)clearSelection();invalidate()};label.append(input,`${b.kind}（${data.counts[b.kind]}）`);panel.append(label);
 }
 const frameButton=document.createElement('button');frameButton.id='siteFeatureView';frameButton.textContent='地物全景';frameButton.onclick=()=>frame();panel.append(frameButton);
 const note=document.createElement('p');note.id='siteFeatureStatus';note.style.fontSize='12px';note.textContent=data.appearance_mode==='white'?`${data.features.length}处地物；建筑按原轮廓显示白模，高度按层数×3m或类别预设示意，点选查看依据。`:`${data.features.length}处地物；建筑采用Kenney模型及轮廓立面，外观和高度均为示意，点选查看来源。`;panel.append(note);document.getElementById('terrainControls').after(panel);
 const $=id=>document.getElementById(id);
 function clearSelection(){if(highlight){group.remove(highlight);highlight.geometry.dispose();highlight.material.dispose();highlight=null}if(selected)$('selectionPanel').hidden=true;selected=null}
 function atFace(mesh,face){return mesh.userData.siteFeatureBatch?.ranges.find(r=>face<r.end)?.feature}
 function select(feature){
  clearSelection();selected=feature;
  const r=feature.render||feature,geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(r.v.flatMap(([x,y,z])=>[x,z,-y]),3));geometry.setIndex(r.w.flat());highlight=new T.LineSegments(geometry,new T.LineBasicMaterial({color:0xffcf56,depthTest:false}));highlight.renderOrder=6;group.add(highlight);
  $('selectionName').textContent=feature.name;$('selectionCategory').textContent='地物类别：'+feature.kind;
  $('selectionSize').textContent=`平面面积 ${feature.area_m2.toFixed(2)} m² · ${feature.floors?feature.floors+'层 · ':''}${feature.height_m!==null?'示意高度 '+feature.height_m.toFixed(1)+' m':'贴地表面'}`;
  $('selectionStation').textContent='地面：'+feature.ground_status+'；高度：'+feature.height_status;
  $('selectionSource').textContent='依据：'+feature.source+' · 图元 '+feature.handles.join('、')+'。'+feature.notes+(feature.render?' 外观：'+feature.render.provider+' / '+feature.render.template+'（'+feature.render.license+'）；'+feature.appearance_status:'');$('selectionPanel').hidden=false;invalidate();
 }
 function frame(feature=null){
  const vertices=feature?feature.v:data.features.flatMap(f=>f.v);const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of vertices)for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],p[j]);hi[j]=Math.max(hi[j],p[j])}
  beforeFrame();const span=feature?Math.max(20,Math.hypot(hi[0]-lo[0],hi[1]-lo[1])*1.7):1350,target=new T.Vector3((lo[0]+hi[0])/2,(lo[2]+hi[2])/2,-(lo[1]+hi[1])/2);camera.left=-span/2;camera.right=span/2;camera.top=span/2*innerHeight/innerWidth;camera.bottom=-camera.top;camera.zoom=1;camera.updateProjectionMatrix();controls.target.copy(target);camera.position.copy(target).add(new T.Vector3(150,550,650));controls.update();if(feature)select(feature);invalidate();
 }
 function setDisplayMode(mode){displayMode=mode;for(const b of batches.values()){b.mesh.material.colorWrite=mode!==2;b.mesh.material.depthWrite=mode!==2;b.edges.visible=b.mesh.visible&&mode!==0}invalidate()}
 function sync(visible){group.visible=visible;if(!visible)clearSelection()}
 return {group,pickables,data,batches,atFace,select,clearSelection,setDisplayMode,sync,frame,focusSelection(){if(selected)frame(selected)},get selected(){return selected}};
}
