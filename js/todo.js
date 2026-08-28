/* ========== Today's to handle ========== */
function renderTodayHandle(){
  const today=new Date();today.setHours(0,0,0,0);
  const overdue=state.tasks.filter(t=>!t.completed&&t.deadline&&parseDate(t.deadline)&&parseDate(t.deadline)<=today);
  const stuck=allBlockers(l=>l.blockerStatus!=='已解决').filter(b=>!b.project.completed);
  const el=document.getElementById('todayHandle');
  if(overdue.length===0&&stuck.length===0){el.innerHTML='';return;}
  let html='<div class="today-handle-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>今天要处理</div><div class="today-handle-list">';
  overdue.forEach(t=>{
    const tag=t.moduleId?`(${escapeHtml(moduleDisplayName(t.moduleId))})`:'';
    const canUndo=t.deferredCount>0&&t.deferredDates&&t.deferredDates.length>0;
    html+=`<span class="th-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>${escapeHtml(t.title)}${tag} <button onclick="${canUndo?'confirmUndoDeferTask':'confirmDeferTask'}('${t.id}')">${canUndo?'撤销顺延':'顺延→明天'}</button></span>`;
  });
  stuck.forEach(b=>{
    const pn=(b.project.customer?b.project.customer+'·':'')+b.module.name;
    html+=`<span class="th-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>项目卡住: ${escapeHtml(pn)} — ${escapeHtml(b.log.content)} <button onclick="openResolveBlocker('${b.project.id}','${b.module.id}','${b.log.id}')">解决</button></span>`;
  });
  html+='</div>';
  el.innerHTML=html;
}

/* ========== Tasks ========== */
function groupTasks(){
  const today=new Date();today.setHours(0,0,0,0);
  const eow=new Date(today);eow.setDate(eow.getDate()+(7-today.getDay()));
  const groups={today:[],tomorrow:[],week:[],later:[],none:[],done:[]};
  state.tasks.forEach(t=>{
    if(t.completed){groups.done.push(t);return;}
    if(!t.deadline){groups.none.push(t);return;}
    const dl=parseDate(t.deadline);
    if(!dl){groups.none.push(t);return;}
    const diff=daysBetween(today,dl);
    if(diff<=0)groups.today.push(t);
    else if(diff===1)groups.tomorrow.push(t);
    else if(dl<=eow)groups.week.push(t);
    else groups.later.push(t);
  });
  return groups;
}

function renderTasks(){
  const g=groupTasks();
  const prioMap={P0:'badge-p0',P1:'badge-p1',P2:'badge-p2'};
  const prioLabel={P0:'P0紧急',P1:'P1重要',P2:'P2一般'};
  const today=new Date();today.setHours(0,0,0,0);
  const fmtMd=d=>`${d.getMonth()+1}/${d.getDate()}`;
  const fmtWeek=d=>['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  const eow=new Date(today);eow.setDate(today.getDate()+(7-today.getDay()));
  const dateLabels={
    today:`${fmtMd(today)} ${fmtWeek(today)}`,
    tomorrow:`${fmtMd(new Date(today.getTime()+86400000))} ${fmtWeek(new Date(today.getTime()+86400000))}`,
    week:`至 ${fmtMd(eow)} ${fmtWeek(eow)}`
  };
  const renderGroup=(title,dateLabel,tasks)=>{
    if(!tasks.length)return'';
    let h=`<div class="task-group"><div class="task-group-header">${title}<span class="task-group-date">${dateLabel}</span>${title?`<span class="task-group-count">${tasks.length}</span>`:''}</div>`;
    tasks.forEach(t=>{
      if(editingTaskId===t.id){h+=renderTaskEditRow(t);return;}
      const mod=t.moduleId?findModule(t.moduleId):null;
      const dl=t.deadline?parseDate(t.deadline):null;
      let dlBadge='';
      if(dl&&!t.completed){
        const diff=daysBetween(today,dl);
        const ds=fmtDate(dl);
        if(diff<0)dlBadge=`<span class="badge badge-overdue">已逾期${-diff}天 ${ds}</span>`;
        else if(diff===0)dlBadge=`<span class="badge badge-today">今天 ${ds}</span>`;
        else if(diff===1)dlBadge=`<span class="badge badge-deadline">明天 ${ds}</span>`;
        else dlBadge=`<span class="badge badge-deadline">${diff}天后 ${ds}</span>`;
      }
      const defBadge=t.deferredCount>0?`<span class="badge badge-defer">顺延${t.deferredCount}次</span>`:'';
      const doneBadge=t.completed&&t.completedAt?(()=>{const cd=new Date(t.completedAt);return `<span class="badge badge-done">完成于 ${pad(cd.getMonth()+1)}-${pad(cd.getDate())} ${pad(cd.getHours())}:${pad(cd.getMinutes())}</span>`;})():'';
      const isOverdue=dl&&!t.completed&&dl<=today;
      const canUndo=t.deferredCount>0&&t.deferredDates&&t.deferredDates.length>0;
      h+=`<div class="task-item${t.completed?' done':''}${isOverdue?' overdue':''}">
        <div class="task-check${t.completed?' checked':''}" onclick="toggleTask('${t.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>
        <div class="task-body">
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-meta">
            <span class="badge ${prioMap[t.priority]||'badge-p2'}">${prioLabel[t.priority]||t.priority}</span>
            ${dlBadge}${defBadge}${doneBadge}
            ${mod?`<span class="badge badge-project">${escapeHtml(moduleDisplayName(t.moduleId))}</span>`:''}
          </div>
        </div>
        <div class="task-actions">
          <button class="btn-icon" title="编辑" onclick="editTask('${t.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          ${!t.completed?`<button class="btn-icon" title="${canUndo?'撤销顺延':'顺延到明天'}" onclick="${canUndo?'confirmUndoDeferTask':'confirmDeferTask'}('${t.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${canUndo?'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>':'<path d="M5 12h14M12 5l7 7-7 7"/>'}</svg></button>`:''}
          <button class="btn-icon danger" title="删除" onclick="confirmDeleteTask('${t.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>`;
    });
    return h+'</div>';
  };
  if(!state.taskSort)state.taskSort='doneDesc';
  const projNameOf=id=>moduleDisplayName(id);
  const sortedDone=[...g.done].sort((a,b)=>{
    const s=state.taskSort;
    if(s==='doneAsc')return (a.completedAt||0)-(b.completedAt||0);
    if(s==='proj'||s==='projTime'){const c=projNameOf(a.moduleId).localeCompare(projNameOf(b.moduleId),'zh');if(c!==0)return c;if(s==='projTime')return (b.completedAt||0)-(a.completedAt||0);return 0;}
    return (b.completedAt||0)-(a.completedAt||0);
  });
  let html=renderGroup('逾期 / 今天',dateLabels.today,g.today)+renderGroup('明天',dateLabels.tomorrow,g.tomorrow)+renderGroup('本周',dateLabels.week,g.week)+renderGroup('更远','',g.later)+renderGroup('无截止日期','',g.none);
  if(g.done.length){
    const sortOpts=[['doneDesc','完成：新→旧'],['doneAsc','完成：旧→新'],['proj','仅按客户·模块'],['projTime','客户·模块 → 完成时间(新→旧)']];
    const sortSel=`<select class="task-sort-sel" id="taskSortSel" onchange="setTaskSort()">${sortOpts.map(([v,l])=>`<option value="${v}"${state.taskSort===v?' selected':''}>${l}</option>`).join('')}</select>`;
    html+=`<div class="task-done-bar"><span class="task-done-title">已完成 <span class="task-group-count">${g.done.length}</span></span><span class="task-done-sort"><span class="task-sort-label">排序</span>${sortSel}</span></div>`;
    html+=`<div class="task-done-list">${renderGroup('','',sortedDone)}</div>`;
  }
  if(!state.tasks.length)html='<div class="empty-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><br>暂无任务，添加第一个吧</div>';
  document.getElementById('taskList').innerHTML=html;
}

function setTaskSort(){
  const sel=document.getElementById('taskSortSel');
  if(!sel)return;
  state.taskSort=sel.value;
  saveState();renderTasks();
}

function renderTaskEditRow(t){
  const projOpts=state.projects.flatMap(p=>(p.modules||[]).map(m=>`<option value="${m.id}"${m.id===t.moduleId?' selected':''}>${escapeHtml((p.customer?p.customer+' · ':'')+m.name)}</option>`)).join('');
  return `<div class="task-item" style="background:#f8fafc;border-color:#cbd5e1">
    <div class="task-edit-row">
      <input type="text" id="editTaskTitle-${t.id}" value="${escapeHtml(t.title)}" placeholder="任务名称">
      <select id="editTaskPrio-${t.id}"><option value="P0"${t.priority==='P0'?' selected':''}>P0紧急</option><option value="P1"${t.priority==='P1'?' selected':''}>P1重要</option><option value="P2"${t.priority==='P2'?' selected':''}>P2一般</option></select>
      <input type="date" id="editTaskDate-${t.id}" value="${t.deadline||''}">
      <select id="editTaskProj-${t.id}"><option value="">不关联</option>${projOpts}</select>
      ${t.completed?`<label class="task-edit-extra"><span>完成时间</span><input type="datetime-local" id="editTaskDone-${t.id}" value="${t.completedAt?toLocalInput(t.completedAt):toLocalInput(Date.now())}"></label>`:''}
      <button class="btn-sm btn-primary" onclick="saveTaskEdit('${t.id}')">保存</button>
      <button class="btn-sm btn-outline" onclick="cancelTaskEdit()">取消</button>
    </div>
  </div>`;
}

function addTask(){
  const title=document.getElementById('taskTitle').value.trim();
  if(!title){showToast('请输入任务名称','error');return;}
  state.tasks.push({id:uid(),title,priority:document.getElementById('taskPriority').value,deadline:document.getElementById('taskDeadline').value,moduleId:document.getElementById('taskProject').value||null,completed:false,createdAt:Date.now(),deferredCount:0});
  document.getElementById('taskTitle').value='';
  document.getElementById('taskDeadline').value=todayStr();
  state.isSample=false;
  saveState();renderTasks();renderTodayHandle();renderProjects();updateBackupBar();
  showToast('任务已添加','success');
}

function toggleTask(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  t.completed=!t.completed;
  t.completedAt=t.completed?Date.now():null;
  state.isSample=false;
  saveState();renderTasks();renderTodayHandle();updateBackupBar();
}

function deferTask(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  if(!t.deferredDates)t.deferredDates=[];
  if(t.deadline)t.deferredDates.push(t.deadline);
  t.deadline=tomorrowStr();
  t.deferredCount=(t.deferredCount||0)+1;
  state.isSample=false;
  saveState();renderTasks();renderTodayHandle();
  showToast('已顺延到明天','success');
}

function undoDeferTask(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  if(!t.deferredDates||!t.deferredDates.length){showToast('没有可撤销的顺延记录','error');return;}
  t.deadline=t.deferredDates.pop();
  t.deferredCount=Math.max((t.deferredCount||0)-1,0);
  if(t.deferredCount===0)t.deferredDates=[];
  state.isSample=false;
  saveState();renderTasks();renderTodayHandle();
  showToast('已撤销顺延','success');
}

function deleteTask(id){
  state.tasks=state.tasks.filter(x=>x.id!==id);
  saveState();renderTasks();renderTodayHandle();updateBackupBar();
}

function closeAllTaskMenus(){
  if(openTaskMenuId){openTaskMenuId=null;renderTasks();}
}

function editTask(id){
  editingTaskId=id;renderTasks();
  const input=document.getElementById('editTaskTitle-'+id);
  if(input)input.focus();
}

function cancelTaskEdit(){editingTaskId=null;renderTasks();}

function saveTaskEdit(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  const title=document.getElementById('editTaskTitle-'+id).value.trim();
  if(!title){showToast('任务名称不能为空','error');return;}
  t.title=title;
  t.priority=document.getElementById('editTaskPrio-'+id).value;
  t.deadline=document.getElementById('editTaskDate-'+id).value||null;
  t.moduleId=document.getElementById('editTaskProj-'+id).value||null;
  if(t.completed){
    const dv=document.getElementById('editTaskDone-'+id).value;
    t.completedAt=dv?new Date(dv).getTime():Date.now();
  }
  editingTaskId=null;
  state.isSample=false;
  saveState();renderTasks();renderTodayHandle();updateBackupBar();
  showToast('任务已更新','success');
}

function confirmDeleteTask(id){
  const t=state.tasks.find(x=>x.id===id);
  showModal('删除任务',`确认删除「${t?t.title:''}」？删除后不可恢复。`,()=>{deleteTask(id);closeModal();});
}

function confirmDeferTask(id){
  const t=state.tasks.find(x=>x.id===id);
  showModal('顺延任务',`将「${t?t.title:''}」顺延到明天？`,()=>{deferTask(id);closeModal();});
}

function confirmUndoDeferTask(id){
  const t=state.tasks.find(x=>x.id===id);
  const prevDate=t&&t.deferredDates&&t.deferredDates.length?t.deferredDates[t.deferredDates.length-1]:'';
  showModal('撤销顺延',`将「${t?t.title:''}」恢复到 ${prevDate||'上次截止日期'}？`,()=>{undoDeferTask(id);closeModal();});
}