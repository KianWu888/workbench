/* ========== Projects (三层: 客户项目 -> 模块 -> 跟进/待办) ========== */
const prioMap={P0:'badge-p0',P1:'badge-p1',P2:'badge-p2'};
const prioLabel={P0:'P0紧急',P1:'P1重要',P2:'P2一般'};
let editingModuleId=null;
let editingModuleForPid=null;
let expandedModules=new Set();
let expandedAddForms=new Map(); // mid -> 'menu'|'task'|'log'|null
function toggleAddForm(mid,type){
  if(type===null){expandedAddForms.delete(mid);renderProjects();return;}
  expandedAddForms.set(mid, expandedAddForms.get(mid)===type?null:type);
  renderProjects();
}
let expandedResolutions=new Set(); // blocker log id
function toggleResolution(lid){expandedResolutions.has(lid)?expandedResolutions.delete(lid):expandedResolutions.add(lid);renderProjects();}
let expandedBlockerInputs=new Set(); // blocker log id -> show timeline input
function toggleBlockerInput(lid){expandedBlockerInputs.has(lid)?expandedBlockerInputs.delete(lid):expandedBlockerInputs.add(lid);renderProjects();}
function focusBlockerTimeline(lid){const el=document.getElementById('projLogTimeline-'+lid);if(el){el.focus();toggleBlockerInput(lid);}}

let expandedBlockerDetails=new Set(); // blocker log id -> 展开时间线/方案详情
function toggleBlockerDetails(lid){expandedBlockerDetails.has(lid)?expandedBlockerDetails.delete(lid):expandedBlockerDetails.add(lid);renderProjects();}

/* ---- 跟进富文本：文字 + 粘贴截图 + 拖拽排序 ---- */
function walkLogBlocks(node,out){
  node.childNodes.forEach(n=>{
    if(n.nodeType===3){const t=n.textContent;if(t&&t.trim())out.push({t:'text',v:t.trim()});}
    else if(n.nodeName==='IMG'){const s=n.getAttribute('src');if(s&&s.indexOf('data:')===0)out.push({t:'img',v:s});}
    else if(n.nodeName==='BR'){}
    else walkLogBlocks(n,out);
  });
}
function readLogBlocks(editorId){
  const ed=document.getElementById(editorId);if(!ed)return [{t:'text',v:''}];
  const out=[];walkLogBlocks(ed,out);
  if(!out.length&&ed.textContent.trim())out.push({t:'text',v:ed.textContent.trim()});
  return out.length?out:[{t:'text',v:''}];
}
function blocksToEditorHtml(blocks){
  if(!blocks||!blocks.length)return '';
  return blocks.map(b=>b.t==='img'?'<img src="'+b.v+'" class="log-img" draggable="true" contenteditable="false">':escapeHtml(b.v)).join('<br>');
}
function logTextFromBlocks(blocks){return (blocks||[]).filter(b=>b.t==='text').map(b=>b.v).join(' ').trim();}
function renderLogBody(log){
  const blocks=(log.blocks&&log.blocks.length)?log.blocks:[{t:'text',v:log.content||''}];
  return blocks.map(b=>b.t==='img'?'<img src="'+b.v+'" class="log-img-view" draggable="true">':escapeHtml(b.v)).join('<br>');
}
function insertLogImgAtCaret(ed,src){
  const img=document.createElement('img');img.src=src;img.className='log-img';img.draggable=true;img.setAttribute('contenteditable','false');
  const sel=window.getSelection();
  if(sel&&sel.rangeCount){const range=sel.getRangeAt(0);range.deleteContents();range.insertNode(img);range.setStartAfter(img);range.collapse(true);sel.removeAllRanges();sel.addRange(range);}
  else ed.appendChild(img);
  ed.focus();
}
function showImgModal(src){
  document.getElementById('modalTitle').textContent='图片预览';
  document.getElementById('modalText').innerHTML='<img src="'+src+'" style="max-width:100%;border-radius:6px">';
  document.getElementById('modalConfirmBtn').style.display='none';
  document.getElementById('modalOverlay').classList.remove('hidden');
}
document.addEventListener('paste',e=>{
  const ed=document.activeElement;
  if(!ed||!ed.classList||!ed.classList.contains('log-editor'))return;
  let handled=false;
  if(e.clipboardData&&e.clipboardData.items){for(const it of e.clipboardData.items){if(it.type&&it.type.indexOf('image/')===0){const f=it.getAsFile();if(f){const r=new FileReader();r.onload=()=>insertLogImgAtCaret(ed,r.result);r.readAsDataURL(f);handled=true;}}}}
  if(handled)e.preventDefault();
});
document.addEventListener('dragstart',e=>{const img=e.target.closest&&e.target.closest('.log-img');if(img){e.dataTransfer.setData('text/plain',img.src);img.classList.add('dragging');}});
document.addEventListener('dragover',e=>{if(e.target.closest&&e.target.closest('.log-img'))e.preventDefault();});
document.addEventListener('drop',e=>{const img=e.target.closest&&e.target.closest('.log-img');if(img){e.preventDefault();const drag=document.querySelector('.log-img.dragging');if(drag&&drag!==img)img.parentNode.insertBefore(drag,img);if(drag)drag.classList.remove('dragging');}});
document.addEventListener('click',e=>{const img=e.target.closest&&e.target.closest('.log-img-view');if(img)showImgModal(img.src);});

function renderProjects(){
  const el=document.getElementById('projectList');
  if(!state.projSort)state.projSort='createdDesc';
  const hasActiveBlocker=p=>{
    const mods=p.modules||[];
    return mods.some(m=>(m.logs||[]).some(l=>l.isBlocker&&(l.blockerStatus||'待排查')!=='已解决'));
  };
  const sortProjects=arr=>{
    const a=[...arr];
    if(state.projSort==='createdAsc')a.sort((x,y)=>(x.createdAt||0)-(y.createdAt||0));
    else if(state.projSort==='name')a.sort((x,y)=>(x.customer||'').localeCompare(y.customer||'','zh'));
    else if(state.projSort==='blocker')a.sort((x,y)=>(hasActiveBlocker(y)?1:0)-(hasActiveBlocker(x)?1:0)||((y.createdAt||0)-(x.createdAt||0)));
    else a.sort((x,y)=>(y.createdAt||0)-(x.createdAt||0));
    return a;
  };
  if(!state.projects.length){el.innerHTML='<div class="empty-hint">暂无项目，先在上方添加客户</div>';return;}
  const active=sortProjects(state.projects.filter(p=>!p.completed));
  const done=sortProjects(state.projects.filter(p=>p.completed));
  let html=active.map(p=>{if(editingProjectId===p.id)return renderProjectEditCard(p);return renderProjectCard(p);}).join('');
  if(done.length){
    html+=`<div class="projects-done-header">已完成 (${done.length})</div>`;
    html+=done.map(p=>{if(editingProjectId===p.id)return renderProjectEditCard(p);return renderProjectCard(p);}).join('');
  }
  el.innerHTML=html;
}

function setProjSort(){
  const sel=document.getElementById('projSortSel');
  if(sel)state.projSort=sel.value;
  saveState();renderProjects();
}

function renderProjectCard(p){
  const modules=p.modules||[];
  const title=(p.customer||'未命名客户');
  const menuOpen=openProjectMenuId===p.id?' show':'';
  const completedCls=p.completed?' completed':'';
  const toggleBtn=p.completed?'取消完成':'标记完成';
  let modHtml=modules.slice().sort((a,b)=>(a.completed?1:0)-(b.completed?1:0)).map(m=>renderModuleBlock(p,m)).join('');
  if(editingModuleForPid===p.id){
    modHtml+=`<div class="module-add-card">
      <input type="text" id="newModName-${p.id}" placeholder="模块名称（如：飞连部署）">
      <div class="module-add-actions"><button class="btn-sm btn-primary" onclick="addModule('${p.id}')">添加模块</button><button class="btn-sm btn-outline" onclick="cancelAddModule()">取消</button></div>
    </div>`;
  }else{
    modHtml+=`<button class="btn-sm btn-outline module-add-btn" onclick="startAddModule('${p.id}')">+ 添加模块</button>`;
  }
  return`<div class="project-card${completedCls}"><div class="project-name">${escapeHtml(title)}<span class="project-mod-count">${modules.length} 个模块</span>${p.completed?'<span class="project-done-badge">已完成</span>':''}<div class="project-actions"><button class="btn-icon" onclick="toggleProjectMenu(event,'${p.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="6" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18" r="1"/></svg></button><div class="task-menu${menuOpen}" id="projMenu-${p.id}"><button class="task-menu-item" onclick="editProject('${p.id}')">编辑客户名</button><button class="task-menu-item" onclick="toggleProjectCompleted('${p.id}')">${toggleBtn}</button><button class="task-menu-item danger" onclick="confirmDeleteProject('${p.id}')">删除</button></div></div></div><div class="module-list">${modHtml}</div></div>`;
}

function renderProjectEditCard(p){
  return `<div class="project-card" style="background:#f8fafc;border-color:#cbd5e1"><div class="project-edit-form">
    <input type="text" id="editProjCustomer-${p.id}" value="${escapeHtml(p.customer||'')}" placeholder="客户名称">
    <div style="display:flex;gap:8px"><button class="btn-sm btn-primary" onclick="saveProjectEdit('${p.id}')">保存</button><button class="btn-sm btn-outline" onclick="cancelProjectEdit()">取消</button></div>
  </div></div>`;
}

function renderModuleBlock(p,m){
  if(editingModuleId===m.id)return renderModuleEditCard(p,m);
  const collapsed=m.completed&&!expandedModules.has(m.id);
  const tasks=state.tasks.filter(t=>t.moduleId===m.id);
  const completedTasks=tasks.filter(t=>t.completed).length;
  const totalTasks=tasks.length;
  const bStatusMap={待排查:'badge-overdue',排查中:'badge-p1','已解决':'badge-p2'};
  const bStatusLabel={待排查:'待排查',排查中:'排查中','已解决':'已解决'};
  const logs=m.logs||[];
  const blockers=logs.filter(l=>l.isBlocker&&(l.blockerStatus||'待排查')!=='已解决').length;
  const sortedLogs=logs.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const addMode=expandedAddForms.get(m.id)||'';
  const logsHtml=sortedLogs.length?sortedLogs.map((log)=>{
    if(editingProjectLogId===log.id){
      const editOrder=log.isBlocker?`<input type="text" id="editLogOrder-${log.id}" value="${escapeHtml(log.workOrder||'')}" placeholder="工单号" style="max-width:110px">`:'';
      return`<div class="project-log-item" style="background:#f8fafc;border-color:#cbd5e1;align-items:center"><input type="date" id="editLogDate-${log.id}" value="${log.date}" style="width:120px"><div class="log-editor" id="editLogEditor-${log.id}" contenteditable="true" data-ph="当前进度" style="flex:2;min-width:160px">${blocksToEditorHtml(log.blocks||(log.content?[{t:'text',v:log.content}]:[]))}</div><input type="text" id="editLogNext-${log.id}" value="${escapeHtml(log.nextStep||'')}" placeholder="下一步(选填)" style="flex:1;min-width:120px">${editOrder}<button class="btn-sm btn-primary" onclick="saveProjectLogEdit('${p.id}','${m.id}','${log.id}')">保存</button><button class="btn-sm btn-outline" onclick="cancelProjectLogEdit()">取消</button></div>`;
    }
    const isBlk=!!log.isBlocker;
    const st=log.blockerStatus||'待排查';
    const blockerBadge=isBlk?`<span class="badge ${bStatusMap[st]||'badge-overdue'}">卡点·${bStatusLabel[st]||st}</span>`:'';
    const orderHtml=isBlk&&log.workOrder?`<span class="blocker-order">工单 ${escapeHtml(log.workOrder)}</span>`:'';
    let extra='';
    if(isBlk){
      const tl=(log.timeline||[]).map(t=>`<div class="log-timeline-item">· ${fmtTime(t.time)} ${escapeHtml(t.text)}</div>`).join('');
      const resolved=st==='已解决';
      const detailsOpen=expandedBlockerDetails.has(log.id);
      const tlHtml=(detailsOpen&&tl)?`<div class="blocker-timeline">${tl}</div>`:'';
      const resHtml=!log.resolution?'':(detailsOpen?`<div class="blocker-resolution">${escapeHtml(log.resolution)} <button class="link-res" onclick="toggleBlockerDetails('${log.id}')">收起</button></div>`:'');
      const showInput=expandedBlockerInputs.has(log.id);
      const parts=[];
      if(!resolved)parts.push(st==='待排查'?`<span class="action-link" onclick="cycleLogBlockerStatus('${p.id}','${m.id}','${log.id}')">开始排查</span>`:`<span class="action-link" onclick="cycleLogBlockerStatus('${p.id}','${m.id}','${log.id}')">待排查</span>`);
      if(!resolved)parts.push(`<span class="action-link" onclick="openBlockerEditor('${p.id}','${m.id}','${log.id}')">解决</span>`);
      if(!resolved)parts.push(`<span class="action-link" onclick="toggleBlockerInput('${log.id}')">记录排查</span>`);
      if(resolved)parts.push(`<span class="action-link" onclick="openBlockerEditor('${p.id}','${m.id}','${log.id}')">编辑方案</span>`);
      if((tl||log.resolution)&&!detailsOpen)parts.push(`<span class="action-link" onclick="toggleBlockerDetails('${log.id}')">详情</span>`);
      if(detailsOpen)parts.push(`<span class="action-link" onclick="toggleBlockerDetails('${log.id}')">收起</span>`);
      const actions=parts.length?`<div class="action-links">${parts.join('<span class="dot-sep">·</span>')}</div>`:'';
      const timelineInput=(resolved||!showInput)?'':`<div class="blocker-timeline-add"><input type="text" id="projLogTimeline-${log.id}" placeholder="追加排查记录…" onkeydown="if(event.key==='Enter')addBlockerTimeline('${p.id}','${m.id}','${log.id}')"><button class="btn-micro btn-primary" onclick="addBlockerTimeline('${p.id}','${m.id}','${log.id}')">记录</button></div>`;
      extra=`<div class="blocker-body">${tlHtml}${resHtml}${actions}${timelineInput}</div>`;
    }
    return`<div class="project-log-item${isBlk?' is-blocker':''}"><div class="project-log-main"><div class="project-log-header"><span class="project-log-date">${log.date}</span>${blockerBadge}${orderHtml}</div><div class="project-log-content">${renderLogBody(log)}</div>${log.nextStep?`<div class="project-log-next">下一步：${escapeHtml(log.nextStep)}</div>`:''}${extra}</div><div class="project-log-actions"><button class="btn-icon" title="编辑" onclick="editProjectLog('${p.id}','${m.id}','${log.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon danger" title="删除" onclick="confirmDeleteProjectLog('${p.id}','${m.id}','${log.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div>`;
  }).join(''):'';
  const addMenu=addMode==='menu'?`<div class="timeline-add-menu">
    <button class="btn-xs btn-outline" onclick="toggleAddForm('${m.id}','task')">待办</button>
    <button class="btn-xs btn-outline" onclick="toggleAddForm('${m.id}','log')">跟进</button>
    <button class="btn-icon-xs" onclick="toggleAddForm('${m.id}',null)" title="关闭">×</button>
  </div>`:'';
  const taskForm=addMode==='task'?`<div class="timeline-form compact">
    <div class="form-row"><input type="text" id="modTaskInput-${m.id}" placeholder="要计划做的事，完成后会自动记为跟进" onkeydown="if(event.key==='Enter')addModuleTask('${p.id}','${m.id}')"><button class="btn-sm btn-primary" onclick="addModuleTask('${p.id}','${m.id}')">添加</button><button class="btn-sm btn-outline" onclick="toggleAddForm('${m.id}',null)">取消</button></div>
  </div>`:'';
  const logForm=addMode==='log'?`<div class="timeline-form compact">
    <div class="form-row"><input type="date" id="projLogDate-${m.id}" value="${todayStr()}" title="跟进日期" style="width:120px"><div class="log-editor" id="projLogEditor-${m.id}" contenteditable="true" data-ph="今天做到哪了（必填，可粘贴截图）" style="flex:2;min-width:160px"></div><button class="btn-sm btn-primary" onclick="addProjectLog('${p.id}','${m.id}')">添加</button><button class="btn-sm btn-outline" onclick="toggleAddForm('${m.id}',null)">取消</button></div>
    <div class="form-row"><input type="text" id="projLogNext-${m.id}" placeholder="下一步（选填）" style="flex:1;min-width:120px"><label class="log-blocker-chk"><input type="checkbox" id="projLogIsBlocker-${m.id}" onchange="toggleLogBlockerInput('${m.id}')"> 卡点</label><input type="text" id="projLogOrder-${m.id}" placeholder="工单号" style="display:none;max-width:110px"></div>
  </div>`:'';
  const today=new Date();today.setHours(0,0,0,0);
  const undoneTasks=tasks.filter(t=>!t.completed);
  const todoHtml=undoneTasks.length?undoneTasks.map(t=>{
    const dl=t.deadline?parseDate(t.deadline):null;
    let dlBadge='';
    if(dl){
      const diff=daysBetween(today,dl);
      const ds=fmtDate(dl);
      if(diff<0)dlBadge='<span class="badge badge-overdue">已逾期'+(-diff)+'天 '+ds+'</span>';
      else if(diff===0)dlBadge='<span class="badge badge-today">今天 '+ds+'</span>';
      else if(diff===1)dlBadge='<span class="badge badge-deadline">明天 '+ds+'</span>';
      else dlBadge='<span class="badge badge-deadline">'+diff+'天后 '+ds+'</span>';
    }
    const prio=t.priority||'中';
    return '<div class="task-item todo-timeline-item">'
      +'<div class="task-check" onclick="toggleTask(\''+t.id+'\');renderProjects()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>'
      +'<div class="task-body"><div class="task-title">'+escapeHtml(t.title)+'</div>'
      +'<div class="task-meta"><span class="badge '+(prioMap[prio]||'badge-p2')+'">'+(prioLabel[prio]||prio)+'</span>'+dlBadge+'</div></div>'
      +'<button class="btn-xs btn-text todo-done-btn" onclick="toggleTask(\''+t.id+'\');renderProjects()">完成</button></div>';
  }).join(''):'';
  if(collapsed){
    return `<div class="module-block completed collapsed" onclick="toggleModuleExpand('${m.id}')">
      <div class="module-head" style="margin-bottom:0">
        <span class="module-name">${escapeHtml(m.name)}</span>
        <div class="module-actions"><span class="module-done-badge">已完成</span><span class="module-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg></span></div>
      </div>
    </div>`;
  }
  const badges=`<div class="module-badges">
    <span class="mbadge ${totalTasks?'':'muted'}">待办 ${completedTasks}/${totalTasks}</span>
    <span class="mbadge mblue">跟进 ${logs.length}</span>
    <span class="mbadge ${blockers?'mred':'mgreen'}">卡点 ${blockers}</span>
  </div>`;
  const chevUp=m.completed?`<button class="btn-icon" title="收起" onclick="toggleModuleExpand('${m.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M18 15l-6-6-6 6"/></svg></button>`:'';
  const hasContent=undoneTasks.length||logs.length;
  const emptyMsg=hasContent?'':'<div class="timeline-empty">暂无事项，点击下方「+ 添加」</div>';
  return `<div class="module-block${m.completed?' completed':''}">
    <div class="module-head">
      <span class="module-name">${escapeHtml(m.name)}</span>${m.completed?'<span class="module-done-badge">已完成</span>':''}
      <div class="module-actions">
        ${chevUp}
        <button class="btn-icon" title="${m.completed?'取消完成':'标记完成'}" onclick="toggleModuleCompleted('${p.id}','${m.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M5 13l4 4L19 7"/></svg></button>
        <button class="btn-icon" title="编辑模块" onclick="editModule('${p.id}','${m.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-icon danger" title="删除模块" onclick="confirmDeleteModule('${p.id}','${m.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>
    </div>
    ${badges}
    <div class="module-timeline">
      ${addMode?(addMenu+taskForm+logForm):`<div class="timeline-add-row"><button class="btn-text" onclick="toggleAddForm('${m.id}','menu')">+ 添加</button></div>`}
      ${todoHtml}
      ${logsHtml}
      ${emptyMsg}
    </div>
  </div>`;
}

function renderModuleEditCard(p,m){
  return `<div class="module-block" style="background:#f8fafc;border-color:#cbd5e1"><div class="project-edit-form">
    <input type="text" id="editModName-${m.id}" value="${escapeHtml(m.name)}" placeholder="模块名称">
    <div style="display:flex;gap:8px"><button class="btn-sm btn-primary" onclick="saveModuleEdit('${p.id}','${m.id}')">保存</button><button class="btn-sm btn-outline" onclick="cancelModuleEdit()">取消</button></div>
  </div></div>`;
}

// 模块内就地加待办：复用全局任务结构，moduleId 自动预置为本模块
function addModuleTask(pid,mid){
  const inp=document.getElementById('modTaskInput-'+mid);
  if(!inp)return;
  const title=inp.value.trim();
  if(!title){showToast('请输入待办内容','error');return;}
  state.tasks.push({id:uid(),title,priority:'中',deadline:'',moduleId:mid,completed:false,createdAt:Date.now(),deferredCount:0});
  expandedAddForms.delete(mid);
  state.isSample=false;
  saveState();renderProjects();renderTasks();renderTodayHandle();updateBackupBar();
  showToast('待办已添加（已关联本模块）','success');
}

/* ---- 客户项目操作 ---- */
function addProject(){
  const customer=document.getElementById('projCustomer').value.trim();
  if(!customer){showToast('请输入客户名称','error');return;}
  const proj={id:uid(),customer,completed:false,createdAt:Date.now(),modules:[]};
  state.projects.push(proj);
  document.getElementById('projCustomer').value='';
  state.isSample=false;
  saveState();renderProjects();renderTaskProjectDropdown();renderTodayHandle();updateBackupBar();
  ensureCustomerFolderInVault(customer);   // 创建项目即同步在 1-项目/客户交付/ 建对应客户目录
  showToast('客户项目已添加，可继续添加模块','success');
}

function deleteProject(id){
  const del=state.projects.find(p=>p.id===id);
  const modIds=(del&&del.modules||[]).map(m=>m.id);
  state.projects=state.projects.filter(p=>p.id!==id);
  state.tasks.forEach(t=>{if(t.moduleId&&modIds.includes(t.moduleId))t.moduleId=null;});
  saveState();renderProjects();renderTaskProjectDropdown();renderTodayHandle();updateBackupBar();
}

function toggleProjectMenu(event,id){
  event.stopPropagation();
  if(openProjectMenuId===id){openProjectMenuId=null;}else{openProjectMenuId=id;}
  renderProjects();
}

function toggleProjectCompleted(id){
  const p=state.projects.find(x=>x.id===id);if(!p)return;
  p.completed=!p.completed;
  openProjectMenuId=null;
  saveState();renderProjects();renderTodayHandle();updateBackupBar();
  showToast(p.completed?'客户项目已标记完成':'客户项目已恢复进行中','success');
}

function closeAllProjectMenus(){
  if(openProjectMenuId){openProjectMenuId=null;renderProjects();}
}

function editProject(id){
  openProjectMenuId=null;editingProjectId=id;renderProjects();
  const input=document.getElementById('editProjCustomer-'+id);
  if(input)input.focus();
}

function cancelProjectEdit(){editingProjectId=null;renderProjects();}

function saveProjectEdit(id){
  const p=state.projects.find(x=>x.id===id);if(!p)return;
  const customer=document.getElementById('editProjCustomer-'+id).value.trim();
  if(!customer){showToast('客户名称不能为空','error');return;}
  p.customer=customer;
  editingProjectId=null;
  state.isSample=false;
  saveState();renderProjects();renderTaskProjectDropdown();renderTodayHandle();updateBackupBar();
  showToast('客户项目已更新','success');
}

function confirmDeleteProject(id){
  openProjectMenuId=null;
  const p=state.projects.find(x=>x.id===id);
  showModal('删除客户项目',`确认删除客户项目「${p?p.customer:''}」？其下所有模块、跟进记录及关联任务将一并移除。`,()=>{deleteProject(id);closeModal();});
}

/* ---- 模块操作 ---- */
function startAddModule(pid){openProjectMenuId=null;editingModuleForPid=pid;renderProjects();const input=document.getElementById('newModName-'+pid);if(input)input.focus();}
function cancelAddModule(){editingModuleForPid=null;renderProjects();}

function addModule(pid){
  const p=state.projects.find(x=>x.id===pid);if(!p)return;
  const name=document.getElementById('newModName-'+pid).value.trim();
  if(!name){showToast('请输入模块名称','error');return;}
  if(!p.modules)p.modules=[];
  p.modules.push({
    id:uid(),name,completed:false,
    createdAt:Date.now(),logs:[]
  });
  editingModuleForPid=null;
  state.isSample=false;
  saveState();renderProjects();renderTaskProjectDropdown();updateBackupBar();
  showToast('模块已添加','success');
}

function editModule(pid,mid){
  openProjectMenuId=null;editingModuleId=mid;renderProjects();
  const input=document.getElementById('editModName-'+mid);
  if(input)input.focus();
}
// 进度改为"按跟进记录留痕"模式：每次跟进即一条带日期的当前进度，逐步累加即历史，无需单独的 step 字段
function cancelModuleEdit(){editingModuleId=null;renderProjects();}

function toggleModuleCompleted(pid,mid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m)return;
  m.completed=!m.completed;
  state.isSample=false;
  saveState();renderProjects();updateBackupBar();
  showToast(m.completed?'模块已标记完成':'模块已恢复进行中','success');
}

function toggleModuleExpand(mid){
  if(expandedModules.has(mid))expandedModules.delete(mid);else expandedModules.add(mid);
  renderProjects();
}

function saveModuleEdit(pid,mid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m)return;
  const name=document.getElementById('editModName-'+mid).value.trim();
  if(!name){showToast('模块名称不能为空','error');return;}
  m.name=name;
  editingModuleId=null;
  state.isSample=false;
  saveState();renderProjects();renderTaskProjectDropdown();updateBackupBar();
  showToast('模块已更新','success');
}

function confirmDeleteModule(pid,mid){
  openProjectMenuId=null;
  const p=state.projects.find(x=>x.id===pid);
  const m=p&&p.modules?p.modules.find(x=>x.id===mid):null;
  showModal('删除模块',`确认删除模块「${m?m.name:''}」？该模块下的跟进记录将一并删除，关联任务将变为未关联。`,()=>{deleteModule(pid,mid);closeModal();});
}
function deleteModule(pid,mid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  p.modules=p.modules.filter(x=>x.id!==mid);
  state.tasks.forEach(t=>{if(t.moduleId===mid)t.moduleId=null;});
  state.isSample=false;
  saveState();renderProjects();renderTaskProjectDropdown();renderTodayHandle();updateBackupBar();
  showToast('模块已删除','success');
}

/* ---- 跟进 / 卡点（位于模块内） ---- */
function toggleLogBlockerInput(mid){
  const chk=document.getElementById('projLogIsBlocker-'+mid);
  const order=document.getElementById('projLogOrder-'+mid);
  if(order)order.style.display=chk&&chk.checked?'inline-block':'none';
}

function addBlockerTimeline(pid,mid,lid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m)return;
  const log=(m.logs||[]).find(x=>x.id===lid);if(!log)return;
  const inp=document.getElementById('projLogTimeline-'+lid);
  const text=inp?inp.value.trim():'';
  if(!text){showToast('请填写排查记录','error');return;}
  if(!log.timeline)log.timeline=[];
  log.timeline.push({time:Date.now(),text});
  log.updatedAt=Date.now();
  state.isSample=false;
  saveState();renderProjects();updateBackupBar();
  showToast('已记录排查进展','success');
}

function cycleLogBlockerStatus(pid,mid,lid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m)return;
  const log=(m.logs||[]).find(x=>x.id===lid);if(!log)return;
  log.blockerStatus=log.blockerStatus==='待排查'?'排查中':'待排查';
  log.updatedAt=Date.now();
  state.isSample=false;
  syncDailyReportFor(p.customer, log.date);
  renderProjects();updateBackupBar();
}

function openBlockerEditor(pid,mid,lid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m)return;
  const log=(m.logs||[]).find(x=>x.id===lid);if(!log)return;
  const pname=(p.customer?p.customer+' · ':'')+m.name;
  const body=document.getElementById('modalText');
  const resolved=log.blockerStatus==='已解决';
  document.getElementById('modalTitle').textContent=resolved?'编辑卡点方案':'解决卡点';
  body.style.whiteSpace='normal';
  const curStatus=log.blockerStatus||'待排查';
  body.innerHTML=`<div style="margin-bottom:8px;font-size:13px;color:var(--text2)">项目：${escapeHtml(pname)}</div><div style="margin-bottom:10px;font-size:13px;padding:8px 10px;background:var(--danger-bg);border-radius:6px;color:var(--danger)">卡点：${escapeHtml(log.content)}</div><label style="font-size:12px;color:var(--text2);font-weight:500;display:block;margin-bottom:4px">状态</label><select id="blkEditorStatus" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;width:100%"><option value="待排查"${curStatus==='待排查'?' selected':''}>待排查</option><option value="排查中"${curStatus==='排查中'?' selected':''}>排查中</option><option value="已解决"${curStatus==='已解决'?' selected':''}>已解决</option></select><label style="font-size:12px;color:var(--text2);font-weight:500;display:block;margin-bottom:4px">问题发生日期（可回溯到前几天）</label><input type="date" id="blkEditorOccurred" value="${log.date||todayStr()}" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px"><label style="font-size:12px;color:var(--text2);font-weight:500;display:block;margin-bottom:4px">解决方案（将记入案例库，后续可复用）</label><textarea id="blkEditorResolution" placeholder="怎么解决的？关键步骤是什么？" style="min-height:80px">${escapeHtml(log.resolution||'')}</textarea>`;
  const btn=document.getElementById('modalConfirmBtn');
  btn.style.display='';
  btn.textContent=resolved?'保存修改':'确认解决';
  btn.onclick=()=>{
    const newStatus=document.getElementById('blkEditorStatus').value;
    const occurred=document.getElementById('blkEditorOccurred').value||log.date||todayStr();
    const resolution=document.getElementById('blkEditorResolution').value.trim();
    log.blockerStatus=newStatus;log.resolution=resolution;log.updatedAt=Date.now();
    let cse=state.cases.find(c=>c.id===log.caseId);
    if(newStatus==='已解决'){
      if(cse){cse.blocker=log.content;cse.resolution=resolution||'（未填写）';cse.projectName=pname;cse.status='已解决';cse.resolvedAt=Date.now();cse.occurredDate=occurred;cse.obsidianLink=computeCaseLink(cse);}
      else{const cid=uid();log.caseId=cid;const clink=computeCaseLink({id:cid,blocker:log.content,occurredDate:occurred});state.cases.push({id:cid,projectName:pname,blocker:log.content,resolution:resolution||'（未填写）',status:'已解决',resolvedAt:Date.now(),occurredDate:occurred,obsidianLink:clink,tags:[]});}
    }else if(cse){
      cse.status=newStatus;cse.resolution='';cse.resolvedAt=null;cse.occurredDate=occurred;
    }
    state.isSample=false;
    syncDailyReportFor(p.customer, log.date);
    renderProjects();renderTodayHandle();renderCases();updateBackupBar();
    closeModal();
    showToast(resolved?'卡点方案已更新':'卡点已解决，已记入案例库','success');
  };
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function addProjectLog(pid,mid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m)return;
  const date=document.getElementById('projLogDate-'+mid).value;
  const blocks=readLogBlocks('projLogEditor-'+mid);
  const content=logTextFromBlocks(blocks);
  if(!date){showToast('请选择跟进日期','error');return;}
  if(!content&&!blocks.some(b=>b.t==='img')){showToast('请填写当前进度或粘贴截图','error');return;}
  const nextStep=document.getElementById('projLogNext-'+mid).value.trim();
  const isBlk=document.getElementById('projLogIsBlocker-'+mid).checked;
  const order=document.getElementById('projLogOrder-'+mid).value.trim();
  if(!m.logs)m.logs=[];
  const log={id:uid(),date,content,blocks:blocks.length?blocks:undefined,nextStep:nextStep,createdAt:Date.now(),updatedAt:Date.now()};
  if(isBlk){log.isBlocker=true;log.blockerStatus='待排查';log.workOrder=order;log.timeline=[];log.resolution='';log.caseId=null;}
  m.logs.push(log);
  expandedAddForms.delete(mid);
  state.isSample=false;
  syncDailyReportFor(p.customer, log.date);
  renderProjects();updateBackupBar();
  showToast('跟进记录已添加','success');
}

function editProjectLog(pid,mid,logId){
  editingProjectLogId=logId;renderProjects();
  const input=document.getElementById('editLogContent-'+logId);
  if(input)input.focus();
}
function cancelProjectLogEdit(){editingProjectLogId=null;renderProjects();}

function saveProjectLogEdit(pid,mid,logId){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m||!m.logs)return;
  const log=m.logs.find(x=>x.id===logId);if(!log)return;
  const date=document.getElementById('editLogDate-'+logId).value;
  const blocks=readLogBlocks('editLogEditor-'+logId);
  const content=logTextFromBlocks(blocks);
  if(!date){showToast('请选择跟进日期','error');return;}
  if(!content&&!blocks.some(b=>b.t==='img')){showToast('请填写当前进度或粘贴截图','error');return;}
  const nextStep=document.getElementById('editLogNext-'+logId).value.trim();
  if(log.isBlocker){const o=document.getElementById('editLogOrder-'+logId);if(o)log.workOrder=o.value.trim();}
  log.date=date;log.content=content;log.blocks=blocks.length?blocks:undefined;log.nextStep=nextStep;log.updatedAt=Date.now();
  editingProjectLogId=null;
  state.isSample=false;
  syncDailyReportFor(p.customer, log.date);
  renderProjects();updateBackupBar();
  showToast('跟进记录已更新','success');
}

function deleteProjectLog(pid,mid,logId){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m||!m.logs)return;
  const del=m.logs.find(x=>x.id===logId);
  const delDate=del?del.date:todayStr();
  m.logs=m.logs.filter(x=>x.id!==logId);
  state.isSample=false;
  syncDailyReportFor(p.customer, delDate);
  renderProjects();updateBackupBar();
}

function confirmDeleteProjectLog(pid,mid,logId){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);
  const log=m&&m.logs?m.logs.find(x=>x.id===logId):null;
  const preview=log?log.content.slice(0,30)+(log.content.length>30?'…':''):'';
  const tag=log&&log.isBlocker?'（卡点）':'';
  showModal('删除跟进记录',`确认删除这条跟进记录${tag}？\n${preview}`,()=>{deleteProjectLog(pid,mid,logId);closeModal();});
}
