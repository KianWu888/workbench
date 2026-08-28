/* ========== Projects (三层: 客户项目 -> 模块 -> 跟进/待办) ========== */
const prioMap={P0:'badge-p0',P1:'badge-p1',P2:'badge-p2'};
const prioLabel={P0:'P0紧急',P1:'P1重要',P2:'P2一般'};
let editingModuleId=null;
let editingModuleForPid=null;
let expandedModules=new Set();

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
  const logsHtml=sortedLogs.length?sortedLogs.map((log)=>{
    if(editingProjectLogId===log.id){
      const editOrder=log.isBlocker?`<input type="text" id="editLogOrder-${log.id}" value="${escapeHtml(log.workOrder||'')}" placeholder="工单号" style="max-width:110px">`:'';
      return`<div class="project-log-item" style="background:#f8fafc;border-color:#cbd5e1;align-items:center"><input type="date" id="editLogDate-${log.id}" value="${log.date}" style="width:130px"><input type="text" id="editLogContent-${log.id}" value="${escapeHtml(log.content)}" placeholder="当前进度" style="flex:2;min-width:160px"><input type="text" id="editLogNext-${log.id}" value="${escapeHtml(log.nextStep||'')}" placeholder="下一步(选填)" style="flex:1;min-width:120px">${editOrder}<button class="btn-sm btn-primary" onclick="saveProjectLogEdit('${p.id}','${m.id}','${log.id}')">保存</button><button class="btn-sm btn-outline" onclick="cancelProjectLogEdit()">取消</button></div>`;
    }
    const isBlk=!!log.isBlocker;
    const st=log.blockerStatus||'待排查';
    const blockerBadge=isBlk?`<span class="badge ${bStatusMap[st]||'badge-overdue'}">卡点·${bStatusLabel[st]||st}</span>`:'';
    const orderHtml=isBlk&&log.workOrder?`<span class="blocker-order">工单 ${escapeHtml(log.workOrder)}</span>`:'';
    let extra='';
    if(isBlk){
      const tl=(log.timeline||[]).map(t=>`<div class="log-timeline-item">· ${fmtTime(t.time)} ${escapeHtml(t.text)}</div>`).join('');
      const resolved=st==='已解决';
      const tlInput=resolved?'':`<div class="log-timeline-add"><input type="text" id="projLogTimeline-${log.id}" placeholder="追加排查记录（如：已联系厂商，等待回复）"><button class="btn-sm btn-primary" onclick="addBlockerTimeline('${p.id}','${m.id}','${log.id}')">记录</button></div>`;
      const actions=resolved?'':`<div class="blocker-actions"><button class="btn-sm btn-outline" onclick="cycleLogBlockerStatus('${p.id}','${m.id}','${log.id}')">${st==='待排查'?'开始排查':'标记待排查'}</button><button class="btn-sm btn-success" onclick="openResolveBlocker('${p.id}','${m.id}','${log.id}')">解决</button></div>`;
      extra=`<div class="blocker-timeline">${tl}${tlInput}</div>${resolved&&log.resolution?`<div class="blocker-resolution">解决方案：${escapeHtml(log.resolution)}</div>`:''}${actions}`;
    }
    return`<div class="project-log-item${isBlk?' is-blocker':''}"><div class="project-log-main"><div class="project-log-date">${log.date}</div><div><b>当前进度：</b>${escapeHtml(log.content)}${log.nextStep?`<div style="color:var(--text2);font-size:12px;margin-top:2px">下一步：${escapeHtml(log.nextStep)}</div>`:''}</div><div class="project-log-tags">${blockerBadge}${orderHtml}</div></div><div class="project-log-actions"><button class="btn-icon" title="编辑" onclick="editProjectLog('${p.id}','${m.id}','${log.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon danger" title="删除" onclick="confirmDeleteProjectLog('${p.id}','${m.id}','${log.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div>${extra}</div>`;
  }).join(''):'<div style="font-size:12px;color:var(--text2)">暂无跟进记录</div>';
  const logForm=`<div class="project-log-form"><input type="date" id="projLogDate-${m.id}" value="${todayStr()}" title="跟进日期"><input type="text" id="projLogContent-${m.id}" placeholder="当前进度（必填）：今天做到哪了…" style="flex:2;min-width:160px"><input type="text" id="projLogNext-${m.id}" placeholder="下一步（选填）" style="flex:1;min-width:120px"><label class="log-blocker-chk"><input type="checkbox" id="projLogIsBlocker-${m.id}" onchange="toggleLogBlockerInput('${m.id}')"> 卡点</label><input type="text" id="projLogOrder-${m.id}" placeholder="工单号" style="display:none;max-width:110px"><button class="btn-sm btn-primary" onclick="addProjectLog('${p.id}','${m.id}')">添加</button></div>`;
  const today=new Date();today.setHours(0,0,0,0);
  const linkedHtml=tasks.length?tasks.map(t=>{
    const dl=t.deadline?parseDate(t.deadline):null;
    let dlBadge='';
    if(dl&&!t.completed){
      const diff=daysBetween(today,dl);
      const ds=fmtDate(dl);
      if(diff<0)dlBadge='<span class="badge badge-overdue">已逾期'+(-diff)+'天 '+ds+'</span>';
      else if(diff===0)dlBadge='<span class="badge badge-today">今天 '+ds+'</span>';
      else if(diff===1)dlBadge='<span class="badge badge-deadline">明天 '+ds+'</span>';
      else dlBadge='<span class="badge badge-deadline">'+diff+'天后 '+ds+'</span>';
    }
    return '<div class="task-item'+(t.completed?' done':'')+'">'
      +'<div class="task-check'+(t.completed?' checked':'')+'" onclick="toggleTask(\''+t.id+'\');renderProjects()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>'
      +'<div class="task-body"><div class="task-title">'+escapeHtml(t.title)+'</div>'
      +'<div class="task-meta"><span class="badge '+(prioMap[t.priority]||'badge-p2')+'">'+(prioLabel[t.priority]||t.priority)+'</span>'+dlBadge+'</div></div></div>';
  }).join(''):'<div style="font-size:12px;color:var(--text2)">暂无关联待办</div>';
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
    <div class="project-logs"><div class="project-logs-title">关联待办<span class="task-group-count">${tasks.length}</span></div>${linkedHtml}</div>
    <div class="project-logs"><div class="project-logs-title">跟进记录</div>${logForm}${logsHtml}</div>
  </div>`;
}

function renderModuleEditCard(p,m){
  return `<div class="module-block" style="background:#f8fafc;border-color:#cbd5e1"><div class="project-edit-form">
    <input type="text" id="editModName-${m.id}" value="${escapeHtml(m.name)}" placeholder="模块名称">
    <div style="display:flex;gap:8px"><button class="btn-sm btn-primary" onclick="saveModuleEdit('${p.id}','${m.id}')">保存</button><button class="btn-sm btn-outline" onclick="cancelModuleEdit()">取消</button></div>
  </div></div>`;
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

function openResolveBlocker(pid,mid,lid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m)return;
  const log=(m.logs||[]).find(x=>x.id===lid);if(!log)return;
  const pname=(p.customer?p.customer+' · ':'')+m.name;
  const body=document.getElementById('modalText');
  document.getElementById('modalTitle').textContent='解决卡点';
  body.style.whiteSpace='normal';
  body.innerHTML=`<div style="margin-bottom:8px;font-size:13px;color:var(--text2)">项目：${escapeHtml(pname)}</div><div style="margin-bottom:10px;font-size:13px;padding:8px 10px;background:var(--danger-bg);border-radius:6px;color:var(--danger)">卡点：${escapeHtml(log.content)}</div><label style="font-size:12px;color:var(--text2);font-weight:500;display:block;margin-bottom:4px">解决方案（将记入案例库，后续可复用）</label><textarea id="resolveBlockerInput" placeholder="怎么解决的？关键步骤是什么？" style="min-height:80px">${escapeHtml(log.resolution||'')}</textarea>`;
  const btn=document.getElementById('modalConfirmBtn');
  btn.textContent='确认解决';
  btn.onclick=()=>{
    const resolution=document.getElementById('resolveBlockerInput').value.trim();
    log.blockerStatus='已解决';log.resolution=resolution;log.updatedAt=Date.now();
    let cse=state.cases.find(c=>c.id===log.caseId);
    if(cse){cse.blocker=log.content;cse.resolution=resolution||'（未填写）';cse.projectName=pname;cse.status='已解决';cse.resolvedAt=Date.now();}
    else{const cid=uid();log.caseId=cid;state.cases.push({id:cid,projectName:pname,blocker:log.content,resolution:resolution||'（未填写）',status:'已解决',resolvedAt:Date.now(),tags:[]});}
    state.isSample=false;
    syncDailyReportFor(p.customer, log.date);
    renderProjects();renderTodayHandle();renderCases();updateBackupBar();
    closeModal();
    showToast('卡点已解决，已记入案例库','success');
  };
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function addProjectLog(pid,mid){
  const p=state.projects.find(x=>x.id===pid);if(!p||!p.modules)return;
  const m=p.modules.find(x=>x.id===mid);if(!m)return;
  const date=document.getElementById('projLogDate-'+mid).value;
  const content=document.getElementById('projLogContent-'+mid).value.trim();
  if(!date){showToast('请选择跟进日期','error');return;}
  if(!content){showToast('请填写当前进度','error');return;}
  const nextStep=document.getElementById('projLogNext-'+mid).value.trim();
  const isBlk=document.getElementById('projLogIsBlocker-'+mid).checked;
  const order=document.getElementById('projLogOrder-'+mid).value.trim();
  if(!m.logs)m.logs=[];
  const log={id:uid(),date,content,nextStep:nextStep,createdAt:Date.now(),updatedAt:Date.now()};
  if(isBlk){log.isBlocker=true;log.blockerStatus='待排查';log.workOrder=order;log.timeline=[];log.resolution='';log.caseId=null;}
  m.logs.push(log);
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
  const content=document.getElementById('editLogContent-'+logId).value.trim();
  if(!date){showToast('请选择跟进日期','error');return;}
  if(!content){showToast('请填写当前进度','error');return;}
  const nextStep=document.getElementById('editLogNext-'+logId).value.trim();
  if(log.isBlocker){const o=document.getElementById('editLogOrder-'+logId);if(o)log.workOrder=o.value.trim();}
  log.date=date;log.content=content;log.nextStep=nextStep;log.updatedAt=Date.now();
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
