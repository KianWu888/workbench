/* ========== State ========== */
const STORAGE_KEY = 'wb_office_workspace_v1';
let state = {tasks:[],notes:[],projects:[],dailyReports:[],cases:[],settings:{rootDirName:null},isSample:false};
let currentModule = 'todo';
let vaultDirHandle = null;
let noteTagFilter = null;
let editingTaskId = null;
let editingProjectId = null;
let editingProjectLogId = null;
let openTaskMenuId = null;
let openProjectMenuId = null;
let modalCallback = null;
const fsSupported = 'showDirectoryPicker' in window;
const USER_NAME = '吴天乐';
const USER_POS = '网络工程师（网联卓越）';

/* ========== Utils ========== */
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function pad(n){return n<10?'0'+n:''+n}
function fmtDate(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function fmtTime(ts){const d=new Date(ts||Date.now());return pad(d.getHours())+':'+pad(d.getMinutes())}
function toLocalInput(ts){const d=new Date(ts||Date.now());return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())}
function todayStr(){return fmtDate(new Date())}
function tomorrowStr(){const d=new Date();d.setDate(d.getDate()+1);return fmtDate(d)}
function parseDate(s){if(!s)return null;const d=new Date(s+'T00:00:00');return isNaN(d.getTime())?null:d}
function showToast(msg,type){const t=document.getElementById('toast');t.textContent=msg;t.className='toast show '+(type||'');setTimeout(()=>t.className='toast '+(type||''),2500)}
function escapeHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function daysBetween(d1,d2){return Math.round((d2-d1)/(86400000))}

/* ========== 三层模型 helper: 客户项目 -> 模块 -> 跟进/待办 ========== */
function findModule(moduleId){
  for(const p of (state.projects||[])){
    const m=p.modules&&p.modules.find(x=>x.id===moduleId);
    if(m)return {project:p,module:m};
  }
  return null;
}
function projectOfModule(moduleId){
  const r=findModule(moduleId);return r?r.project:null;
}
function moduleDisplayName(moduleId){
  const r=findModule(moduleId);
  if(!r)return '未关联模块';
  return (r.project.customer?r.project.customer+'·':'')+r.module.name;
}
/* 收集所有卡点 {project,module,log} */
function allBlockers(filterFn){
  const out=[];
  (state.projects||[]).forEach(p=>(p.modules||[]).forEach(m=>(m.logs||[]).forEach(l=>{
    if(l.isBlocker&&(!filterFn||filterFn(l)))out.push({project:p,module:m,log:l});
  })));
  return out;
}

/* ========== 旧数据迁移: 项目(客户·模块) -> 客户项目 + modules ========== */
function migrateToModules(){
  const idMap={};            // 旧 projectId -> 新 moduleId
  const byCust={};           // customer -> 新客户项目
  const newProjects=[];
  (state.projects||[]).forEach(op=>{
    // 已有 modules 字段的新格式项目直接保留，不重建（否则会丢弃已添加的模块）
    if(Array.isArray(op.modules)){newProjects.push(op);return;}
    if(!op.logs)op.logs=[];
    if(op.blockers&&Array.isArray(op.blockers)){
      op.blockers.forEach(b=>{
        op.logs.push({id:b.id||uid(),date:b.createdAt?fmtDate(new Date(b.createdAt)):todayStr(),content:b.description||'',createdAt:b.createdAt||Date.now(),updatedAt:b.resolvedAt||null,isBlocker:true,blockerStatus:b.status==='resolved'?'已解决':(b.status||'待排查'),workOrder:b.workOrder||'',timeline:[],resolution:b.resolution||'',caseId:b.caseId||null});
      });
      delete op.blockers;
    }
    if(op.blocker&&op.blocker.trim()&&!op.logs.some(l=>l.isBlocker)){
      op.logs.push({id:uid(),date:todayStr(),content:op.blocker,createdAt:Date.now(),updatedAt:null,isBlocker:true,blockerStatus:op.blockerStatus==='resolved'?'已解决':'待排查',workOrder:'',timeline:[],resolution:op.blockerResolution||'',caseId:null});
    }
    const cust=(op.customer||'').trim();
    let np=byCust[cust];
    if(!np){
      np={id:uid(),customer:cust,completed:!!op.completed,createdAt:op.createdAt||Date.now(),modules:[]};
      byCust[cust]=np;newProjects.push(np);
    }
    const mid=uid();
    idMap[op.id]=mid;
    np.modules.push({id:mid,name:op.name||'未命名模块',currentStep:op.currentStep||'',nextStep:op.nextStep||'',createdAt:op.createdAt||Date.now(),logs:op.logs||[]});
  });
  (state.tasks||[]).forEach(t=>{
    if(t.projectId&&idMap[t.projectId])t.moduleId=idMap[t.projectId];
    else t.moduleId=null;
    delete t.projectId;
  });
  state.projects=newProjects;
}

/* ========== State I/O ========== */
function loadState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){state=JSON.parse(raw);if(!state.settings)state.settings={};}
    if(state.projects&&state.projects.some(p=>!p.modules)){
      migrateToModules();
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){}   // 持久化迁移结果，避免每次刷新重复迁移
    }
    (state.projects||[]).forEach(p=>{
      if(!p.customer)p.customer='';
      if(!p.completed)p.completed=false;
      if(!p.modules)p.modules=[];
      p.modules.forEach(m=>{if(!m.id)m.id=uid();if(!m.logs)m.logs=[];if(m.completed===undefined)m.completed=false;});
    });
    if(!state.cases)state.cases=[];
  }catch(e){console.error('loadState error',e)}
}
function saveState(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
  catch(e){if(e.name==='QuotaExceededError')showToast('存储空间已满，请导出后清理旧数据','error');else console.error(e);}
  if(typeof autoSyncToObsidian==='function')autoSyncToObsidian();   // 保存即静默自动导出到 Obsidian
}

/* ========== Sample Data ========== */

/* ========== Auto-defer ========== */
function autoDeferTasks(){
  const today=new Date();today.setHours(0,0,0,0);
  let changed=false;
  state.tasks.forEach(t=>{
    if(!t.completed&&t.deadline){
      const dl=parseDate(t.deadline);
      if(dl&&dl<today){
        if(!t.deferredDates)t.deferredDates=[];
        t.deferredDates.push(t.deadline);
        t.deadline=fmtDate(today);
        t.deferredCount=(t.deferredCount||0)+1;
        changed=true;
      }
    }
  });
  if(changed)saveState();
}

/* ========== Navigation ========== */
function switchModule(m){
  currentModule=m;
  document.querySelectorAll('.module').forEach(s=>s.classList.add('hidden'));
  document.getElementById('module-'+m).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.module===m));
  if(m==='review')renderReview();
  if(m==='report')renderDailyReports();
  if(m==='todo'){const td=document.getElementById('taskDeadline');if(td&&!td.value)td.value=todayStr();renderTasks();}
  if(m==='notes')renderNotes();
  if(m==='projects')renderProjects();
  if(m==='cases')renderCases();
}

function renderTaskProjectDropdown(){
  const sel=document.getElementById('taskProject');
  const cur=sel.value;
  const opts=[];
  state.projects.forEach(p=>{
    (p.modules||[]).forEach(m=>{
      opts.push(`<option value="${m.id}">${escapeHtml((p.customer?p.customer+' · ':'')+m.name)}</option>`);
    });
  });
  sel.innerHTML='<option value="">不关联</option>'+opts.join('');
  sel.value=cur;
}

/* ========== Render All ========== */
function renderAll(){
  renderTaskProjectDropdown();
  renderTasks();
  renderNotes();
  renderProjects();
  renderReview();
  renderDailyReports();
  renderCases();
  renderTodayHandle();
  updateBackupBar();
}

/* ========== Modal ========== */
function showModal(title,text,callback,confirmText){
  document.getElementById('modalTitle').textContent=title;
  const body=document.getElementById('modalText');
  body.textContent=text;
  body.style.whiteSpace='pre-wrap';
  modalCallback=callback||null;
  const btn=document.getElementById('modalConfirmBtn');
  btn.textContent=confirmText||'确认';
  btn.onclick=callback?()=>{if(modalCallback)modalCallback();}:closeModal;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal(){document.getElementById('modalOverlay').classList.add('hidden');modalCallback=null}


/* ========== Backup ========== */
function exportData(){
  const data={version:'1.0',exportDate:todayStr(),data:state};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='办公工作台备份_'+todayStr()+'.json';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('备份已导出','success');
}

function showFeishuSyncHelp(){
  const text='浏览器无法直接调用飞书 API，需要用本地 Python 脚本作为桥梁。\n\n步骤：\n1. 点击「导出备份」，得到 workspace_export.json\n2. 下载配置示例，填入 app_id / app_secret / 多维表格 token\n3. 安装依赖：pip install requests urllib3\n4. 同步日报到飞书云文档：python3 feishu_sync.py -c feishu_sync_config.json -e workspace_export.json -m push-daily\n5. 同步任务到多维表格：python3 feishu_sync.py -c feishu_sync_config.json -e workspace_export.json -m push-tasks\n6. 从多维表格拉取任务：python3 feishu_sync.py -c feishu_sync_config.json -e workspace_export.json -m pull-tasks -o workspace_import.json';
  showModal('飞书同步说明',text,downloadFeishuConfigExample,'下载配置示例');
}

function downloadFeishuConfigExample(){
  const cfg={
    app_id:'cli_xxxxxxxxxxxxxxxx',
    app_secret:'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    folder_token:'fldcnxxxxxxxxxxxxxxxx',
    daily_report_doc_id:'',
    daily_report_doc_title:'日报汇总',
    task_bitable:{app_token:'N5Rtb7zKHa0qcmsBfQUcKTcXnUe',table_id:'tblhaxBpESt24p7X'}
  };
  const blob=new Blob([JSON.stringify(cfg,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='feishu_sync_config.json';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  closeModal();
  showToast('配置示例已下载','success');
}

function importData(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.data)throw new Error('格式错误');
      showModal('确认导入','导入将覆盖当前所有数据（'+(state.tasks.length+state.notes.length+state.projects.length+state.dailyReports.length)+'条）。确认继续？',()=>{
        state=Object.assign({tasks:[],notes:[],projects:[],dailyReports:[],settings:{}},data.data);
        saveState();renderAll();updateBackupBar();
        showToast('数据已导入','success');
      });
    }catch(err){showToast('导入失败：文件格式错误','error')}
  };
  reader.readAsText(file);
  event.target.value='';
}

function updateBackupBar(){
  const count=state.tasks.length+state.notes.length+state.projects.length+state.dailyReports.length+(state.cases?state.cases.length:0);
  document.getElementById('dataCount').textContent='数据: '+count+' 条';
  const reminder=document.getElementById('backupReminder');
  if(count>=20){reminder.classList.remove('hidden')}else{reminder.classList.add('hidden')}
}

/* ========== File System Access API ========== */
async function pickVaultDir(){
  if(!fsSupported){showToast('当前浏览器不支持文件系统API，请使用Chrome或Edge','error');return;}
  try{
    vaultDirHandle=await window.showDirectoryPicker({mode:'readwrite'});
    state.settings.vaultDirName=vaultDirHandle.name;
    saveState();
    await persistVaultDirHandle(vaultDirHandle);
    updateVaultDirStatus();
    showToast('已设置知识库目录：'+vaultDirHandle.name,'success');
  }catch(e){
    if(e.name!=='AbortError')showToast('设置目录失败：'+(e.message||''),'error');
  }
}

function updateVaultDirStatus(){
  const el=document.getElementById('vaultDirStatus');
  const txt=document.getElementById('vaultDirStatusText');
  if(vaultDirHandle){
    el.className='dir-status set';
    txt.textContent='Obsidian知识库：'+vaultDirHandle.name+'（日报将导出到 6-日记/ 目录）';
  }else{
    el.className='dir-status unset';
    txt.textContent='未设置知识库目录，日报仅保存在浏览器本地';
  }
}

// IndexedDB for directory handle
function openIDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open('workspace_fsa',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('handles');
    req.onsuccess=()=>res(req.result);
    req.onerror=()=>rej(req.error);
  });
}

async function persistVaultDirHandle(handle){
  try{const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction('handles','readwrite');tx.objectStore('handles').put(handle,'vaultDir');tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}catch(e){console.error(e)}
}

async function loadVaultDirHandle(){
  try{const db=await openIDB();return new Promise((res,rej)=>{const tx=db.transaction('handles','readonly');const r=tx.objectStore('handles').get('vaultDir');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}catch(e){return null}
}

/* ========== Init ========== */
async function init(){
  loadState();
  if(fsSupported){
    vaultDirHandle=await loadVaultDirHandle();
    if(vaultDirHandle){
      const ok=await vaultDirHandle.queryPermission({mode:'readwrite'});
      if(ok!=='granted'){const req=await vaultDirHandle.requestPermission({mode:'readwrite'});if(req!=='granted')vaultDirHandle=null;}
    }
    updateVaultDirStatus();
  }
  autoDeferTasks();
  const td=document.getElementById('taskDeadline');if(td&&!td.value)td.value=todayStr();
  renderAll();
}

document.addEventListener('click',()=>{closeAllTaskMenus();closeAllProjectMenus();});