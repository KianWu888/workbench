/* ========== Cases ========== */
function renderCases(){
  const el=document.getElementById('caseList');
  if(!el)return;
  const search=(document.getElementById('caseSearch')?.value||'').toLowerCase();
  let cases=(state.cases||[]).slice().sort((a,b)=>(b.resolvedAt||0)-(a.resolvedAt||0));
  if(search)cases=cases.filter(c=>(c.projectName+' '+c.blocker+' '+(c.resolution||'')).toLowerCase().includes(search));
  if(!cases.length){el.innerHTML='<div class="empty-hint">暂无案例。解除项目卡点后会自动入库。</div>';return;}
  el.innerHTML=cases.map(c=>{
    const d=c.resolvedAt?new Date(c.resolvedAt):null;
    const ds=d?fmtDate(d):'';
    const badge=c.projectName?`<span class="case-project-badge">${escapeHtml(c.projectName)}</span>`:'';
    const st=c.status||'已解决';
    const stCls=st==='已解决'?'case-status-resolved':(st==='排查中'?'case-status-investigating':'case-status-pending');
    const stBadge=`<span class="case-status-badge ${stCls}">${st}</span>`;
    return `<div class="case-card"><div class="case-project">${badge}${stBadge}<div class="case-actions"><button class="btn-icon" title="编辑" onclick="editCase('${c.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon danger" title="删除" onclick="confirmDeleteCase('${c.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div><div class="case-blocker">卡点：${escapeHtml(c.blocker||'')}</div><div class="case-resolution">解决方案：${escapeHtml(c.resolution||'（未填写）')}</div><div class="case-date">${ds}</div></div>`;
  }).join('');
}

function confirmDeleteCase(id){
  const c=state.cases.find(x=>x.id===id);if(!c)return;
  const preview=(c.blocker||'').slice(0,30);
  showModal('删除案例',`确认删除这条案例？\n${preview}`,()=>{state.cases=state.cases.filter(x=>x.id!==id);saveState();renderCases();updateBackupBar();closeModal();});
}

function editCase(id){
  const c=state.cases.find(x=>x.id===id);if(!c)return;
  const body=document.getElementById('modalText');
  document.getElementById('modalTitle').textContent='编辑案例';
  body.style.whiteSpace='normal';
  const ds=c.resolvedAt?fmtDate(new Date(c.resolvedAt)):todayStr();
  const curStatus=c.status||'已解决';
  body.innerHTML=`<div style="display:flex;flex-direction:column;gap:10px">
    <label style="font-size:12px;color:var(--text2);font-weight:500">客户 / 项目名称</label>
    <input type="text" id="editCaseProject" value="${escapeHtml(c.projectName||'')}" placeholder="例如：吉祥航空">
    <label style="font-size:12px;color:var(--text2);font-weight:500">卡点描述</label>
    <textarea id="editCaseBlocker" style="min-height:60px" placeholder="问题现象">${escapeHtml(c.blocker||'')}</textarea>
    <label style="font-size:12px;color:var(--text2);font-weight:500">状态</label>
    <select id="editCaseStatus" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px">
      <option value="待排查"${curStatus==='待排查'?' selected':''}>待排查</option>
      <option value="排查中"${curStatus==='排查中'?' selected':''}>排查中</option>
      <option value="已解决"${curStatus==='已解决'?' selected':''}>已解决</option>
    </select>
    <label style="font-size:12px;color:var(--text2);font-weight:500">解决方案</label>
    <textarea id="editCaseResolution" style="min-height:80px" placeholder="怎么解决的？">${escapeHtml(c.resolution||'')}</textarea>
    <label style="font-size:12px;color:var(--text2);font-weight:500">解决日期</label>
    <input type="date" id="editCaseDate" value="${ds}">
  </div>`;
  const btn=document.getElementById('modalConfirmBtn');
  btn.textContent='保存';
  btn.onclick=()=>{
    c.projectName=document.getElementById('editCaseProject').value.trim();
    c.blocker=document.getElementById('editCaseBlocker').value.trim();
    const newStatus=document.getElementById('editCaseStatus').value;
    c.status=newStatus;
    c.resolution=document.getElementById('editCaseResolution').value.trim();
    c.exportedToObsidian=false;
    if(newStatus!=='已解决'){
      c.resolution='';
      c.resolvedAt=null;
      if(c.caseId){const lnk=(state.projects||[]).flatMap(p=>(p.modules||[]).flatMap(m=>(m.logs||[]).filter(l=>l.caseId===c.caseId)))[0];if(lnk){lnk.blockerStatus=newStatus;lnk.resolution='';}}
      else if(c.projectName){(state.projects||[]).forEach(p=>(p.modules||[]).forEach(m=>(m.logs||[]).forEach(l=>{if(l.isBlocker&&l.caseId===c.id){l.blockerStatus=newStatus;l.resolution='';}})));}
    }else{
      const pd=parseDate(document.getElementById('editCaseDate').value);
      c.resolvedAt=pd?pd.getTime():Date.now();
      const cn=(state.projects||[]).flatMap(p=>(p.modules||[]).flatMap(m=>(m.logs||[]).filter(l=>l.caseId===c.id)))[0];
      if(cn){cn.resolution=c.resolution;cn.blockerStatus='已解决';}
    }
    state.isSample=false;
    saveState();renderCases();renderProjects();renderTodayHandle();updateBackupBar();closeModal();
    showToast('案例已更新','success');
  };
  document.getElementById('modalOverlay').classList.remove('hidden');
}

/* 构建单条案例的 md 块，末尾嵌入 caseId 锚点（HTML 注释，不影响阅读） */
function buildCaseBlock(c){
  const d=c.resolvedAt?new Date(c.resolvedAt):null;
  const ds=d?fmtDate(d):todayStr();
  const title=(c.projectName?`[${c.projectName}] `:'')+(c.blocker||'');
  let b=ds+'\n\n### 事件：'+title+'\n\n';
  b+='**问题描述**\n'+(c.blocker||'（无）')+'\n\n';
  b+='**解决方案**\n'+(c.resolution||'（未填写）')+'\n\n';
  b+='<!-- case-id:'+c.id+' -->\n\n---\n';
  return b;
}

/* 从 md 块中提取 caseId 锚点 */
function parseCaseIdFromBlock(block){
  const m=block.match(/<!--\s*case-id:([a-zA-Z0-9]+)\s*-->/);
  return m?m[1]:null;
}

/* 从 md 块解析案例内容 */
function parseCaseFromBlock(block){
  const lines=block.split('\n');
  const header=lines[0]||'';
  let projectName='',blocker='',resolution='';
  let resolvedAt=null;
  /* 格式1：旧工作台 —— "1. [项目名] 卡点" */
  let m=header.match(/^\d+\.\s*\[([^\]]*)\]\s*(.*)/);
  if(m){
    projectName=m[1].trim();blocker=m[2].trim();
    for(const l of lines){
      const rm=l.match(/\*\*解决方案\*\*[：:]\s*(.*)/);if(rm)resolution=rm[1].trim();
      const dm=l.match(/\*\*解决时间\*\*[：:]\s*(\d{4}-\d{2}-\d{2})/);if(dm){const pd=parseDate(dm[1]);if(pd)resolvedAt=pd.getTime();}
    }
  }else{
    /* 格式2：踩坑日志 —— "2026-06-16" + ### 事件 + **问题描述/解决方案** */
    const dm=header.match(/(\d{4}-\d{2}-\d{2})/);
    if(!dm)return null;
    resolvedAt=parseDate(dm[1])?parseDate(dm[1]).getTime():Date.now();
    for(const l of lines){
      const ev=l.match(/^###\s+事件：(.*)/);
      if(ev){
        const title=ev[1].trim();
        const pn=title.match(/^\[([^\]]*)\]\s*(.*)/);
        if(pn){projectName=pn[1].trim();blocker=pn[2].trim();}
        else blocker=title;
        break;
      }
    }
    let cur=null,problemText=[],causeText=[],solutionText=[],otherText=[];
    for(const l of lines){
      if(/^###\s/.test(l)||/^---/.test(l)||/^>/.test(l)||/^<!--\s*case-id/.test(l)||!l.trim())continue;
      if(/^\*\*问题描述\*\*/.test(l)){cur='problem';continue;}
      if(/^\*\*原因分析\*\*/.test(l)){cur='cause';continue;}
      if(/^\*\*解决方案\*\*/.test(l)){cur='solution';continue;}
      if(/^\*\*.+\*\*/.test(l)){cur='other';continue;}
      if(cur==='problem')problemText.push(l);
      else if(cur==='cause')causeText.push(l);
      else if(cur==='solution')solutionText.push(l);
      else if(cur==='other')otherText.push(l);
    }
    if(problemText.length)blocker=problemText.join('\n').trim();
    resolution=[causeText.join('\n').trim(),solutionText.join('\n').trim(),otherText.join('\n').trim()].filter(Boolean).join('\n\n');
  }
  if(!blocker)return null;
  return {projectName,blocker:blocker.trim(),resolution:resolution.trim()||'（未填写）',resolvedAt};
}
