/* ========== Daily Report ========== */
// 按日报表单所选日期（rptDate）汇总，而非写死“今天”，支持补写过去某天的日报
function autoFillWorkContent(){
  const targetDate=document.getElementById('rptDate').value||todayStr();
  const localDateStr=ts=>{const d=new Date(ts);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
  const projNameOf=t=>moduleDisplayName(t.moduleId)||'未关联项目';
  const lines=[];
  const pushGroup=(title,tasks)=>{
    if(!tasks.length)return;
    lines.push('—— '+title+' ——');
    const byProj={};
    tasks.forEach(t=>{const pn=projNameOf(t);(byProj[pn]=byProj[pn]||[]).push(t);});
    Object.keys(byProj).forEach(pn=>{
      lines.push('【'+pn+'】');
      byProj[pn].forEach((t,i)=>{const pr=t.priority?('['+t.priority+'] '):'';lines.push((i+1)+'、'+pr+t.title);});
      lines.push('');
    });
  };
  const doneToday=state.tasks.filter(t=>t.completed&&(t.completedAt?localDateStr(t.completedAt)===targetDate:targetDate===t.deadline));
  const pending=state.tasks.filter(t=>!t.completed&&targetDate===t.deadline);
  pushGroup('今日完成',doneToday);
  pushGroup('进行中',pending);
  const logs=[];
  state.projects.forEach(p=>(p.modules||[]).forEach(m=>{
    (m.logs||[]).forEach(l=>{if(l.date===targetDate)logs.push({cust:p.customer||'未命名客户',mod:m.name,c:l.content,next:l.nextStep});});
  }));
  if(logs.length){
    lines.push('—— 今日跟进 ——');
    const byCust={};logs.forEach(x=>{(byCust[x.cust]=byCust[x.cust]||[]).push(x);});
    Object.keys(byCust).forEach(cust=>{
      lines.push('【'+cust+'】');
      byCust[cust].forEach(x=>lines.push(x.mod+'：'+x.c+(x.next?('（下一步：'+x.next+'）'):'')));
      lines.push('');
    });
  }
  const notes=state.notes.filter(n=>localDateStr(n.createdAt)===targetDate);
  if(notes.length){lines.push('—— 灵感速记 ——');notes.forEach(n=>lines.push('· '+n.content));lines.push('');}
  const blks=[];
  state.projects.forEach(p=>(p.modules||[]).forEach(m=>{
    (m.logs||[]).forEach(l=>{if(l.isBlocker&&((l.date===targetDate)||(l.updatedAt&&localDateStr(l.updatedAt)===targetDate)))blks.push({cust:p.customer||'未命名客户',mod:m.name,l});});
  }));
  if(blks.length){
    lines.push('—— 今日卡点 ——');
    const byCust={};blks.forEach(x=>{(byCust[x.cust]=byCust[x.cust]||[]).push(x);});
    Object.keys(byCust).forEach(cust=>{
      lines.push('【'+cust+'】');
      byCust[cust].forEach(x=>lines.push(x.mod+'：'+x.l.content+'（'+(x.l.blockerStatus||'待排查')+(x.l.workOrder?' · 工单'+x.l.workOrder:'')+'）'));
      lines.push('');
    });
  }
  document.getElementById('rptWorkContent').value=lines.join('\n').trim()||(targetDate+' 暂无相关记录');
  showToast('已从 '+targetDate+' 的跟进/任务汇总填充','success');
}

/* ========== 日报自动追加（标记区块重建，幂等无冗余） ========== */
// ponytail: 每条跟进自带唯一 id，无需新增字段；每日「今日跟进/今日卡点」用标记包裹，
// 每次仅按当前 state 重建这两段，标记外的手写内容原样保留，删除跟进即自动消失，重复导出不堆叠。
const DR_START='<!-- WB-AUTO:日报跟进 -->';
const DR_END='<!-- /WB-AUTO -->';

function buildDailyAutoBlock(date,customer){
  const lines=[];
  const followLogs=[];
  const blkLogs=[];
  state.projects.forEach(p=>{
    if(p.customer!==customer)return;
    (p.modules||[]).forEach(m=>{
      (m.logs||[]).forEach(l=>{
        if(l.date!==date)return;
        if(l.isBlocker)blkLogs.push({mod:m.name,content:l.content,st:l.blockerStatus||'待排查',order:l.workOrder});
        followLogs.push({mod:m.name,content:l.content,next:l.nextStep});
      });
    });
  });
  if(followLogs.length){
    lines.push('—— 今日跟进 ——');
    lines.push('【'+customer+'】');
    followLogs.forEach(x=>lines.push(x.mod+'：'+x.content+(x.next?('（下一步：'+x.next+'）'):'')));
    lines.push('');
  }
  if(blkLogs.length){
    lines.push('—— 今日卡点 ——');
    lines.push('【'+customer+'】');
    blkLogs.forEach(x=>lines.push(x.mod+'：'+x.content+'（'+(x.st)+(x.order?(' · 工单'+x.order):'')+'）'));
    lines.push('');
  }
  return lines.join('\n').trim();
}

// 填写/修改/删除项目跟进时调用：按客户+日期 upsert 日报，并重建标记区块
async function syncDailyReportFor(customer,date){
  if(!customer||!date)return;
  const block=buildDailyAutoBlock(date,customer);
  let r=state.dailyReports.find(x=>x.date===date&&x.customer===customer);
  if(!r){
    if(!block)return;   // 该客户当天无任何跟进，不建空日报
    r={id:uid(),date,customer,serviceItem:'',supportType:'远程支持',workContent:'',learningPoints:'',takeaways:'',name:USER_NAME,createdAt:Date.now()};
    state.dailyReports.push(r);
  }
  const wb=DR_START+'\n'+block+'\n'+DR_END;
  if(!r.workContent||!r.workContent.includes(DR_START)){
    r.workContent=((r.workContent&&r.workContent.trim())?r.workContent.trim()+'\n\n':'')+wb;
  }else{
    r.workContent=r.workContent.replace(new RegExp(DR_START+'[\\s\\S]*?'+DR_END),wb);
  }
  state.isSample=false;
  saveState();
  renderPastReports();
  if(vaultDirHandle){await exportDailyToObsidian(r);r.exportedToObsidian=true;saveState();}
}

// 从 workContent 中剥离标记注释（导出到 Obsidian 时只留纯文本）
function stripDailyMarkers(txt){
  return (txt||'').replace(new RegExp(DR_START+'[\\s\\S]*?'+DR_END,'g'),'').replace(/<!--\s*\/?WB-AUTO[^>]*-->/g,'').replace(/\n{3,}/g,'\n\n').trim();
}

// 一键把日报表单日期设为昨天，便于补写昨天的日报
function setReportDateToYesterday(){
  const d=new Date();d.setDate(d.getDate()-1);
  const y=(d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()));
  document.getElementById('rptDate').value=y;
  showToast('已填入昨天 '+y+'（跟进也请选同一天，自动填充才会捞到）','success');
}

function renderCustomerList(){
  const customers=new Set();
  state.tasks.forEach(t=>{if(t.customerName)customers.add(t.customerName)});
  state.projects.forEach(p=>{});
  state.dailyReports.forEach(r=>{if(r.customer)customers.add(r.customer)});
  ['北京恒舟','长桥','颗粒机器人','领格教育','药图智能','高测股份','山东奥太电气','太极图形'].forEach(c=>customers.add(c));
  document.getElementById('customerList').innerHTML=[...customers].sort().map(c=>`<option value="${escapeHtml(c)}">`).join('');
}

function renderDailyReports(){
  document.getElementById('rptDate').value=todayStr();
  renderCustomerList();
  renderPastReports();
}

function renderPastReports(){
  const el=document.getElementById('pastReports');
  if(!state.dailyReports.length){el.innerHTML='<div class="empty-hint">暂无历史日报</div>';return;}
  const sorted=state.dailyReports.slice().sort((a,b)=>b.createdAt-a.createdAt);
  el.innerHTML=sorted.map(r=>{
    return`<div class="past-report"><div class="past-report-info"><b>${r.date}</b> | ${escapeHtml(r.customer)} | ${r.supportType}</div><div style="display:flex;gap:4px"><button class="btn-sm btn-outline" onclick="loadReport('${r.id}')">加载</button><button class="btn-sm btn-outline" onclick="exportDailyReportById('${r.id}')">导出</button><button class="btn-sm btn-outline" onclick="copyReportById('${r.id}','detail')">详细版</button><button class="btn-sm btn-outline" onclick="copyReportById('${r.id}','simple')">精简版</button><button class="btn-icon" onclick="confirmDeleteReport('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div>`;
  }).join('');
}

function loadReport(id){
  const r=state.dailyReports.find(x=>x.id===id);if(!r)return;
  document.getElementById('rptDate').value=r.date;
  document.getElementById('rptCustomer').value=r.customer||'';
  document.getElementById('rptServiceItem').value=r.serviceItem||'';
  document.getElementById('rptSupportType').value=r.supportType;
  document.getElementById('rptWorkContent').value=r.workContent||'';
  document.getElementById('rptLearning').value=r.learningPoints||'';
  document.getElementById('rptTakeaways').value=r.takeaways||'';
  showToast('已加载历史日报','success');
}

function generateReportText(r,style){
  const d=parseDate(r.date)||new Date();
  const dateCN=d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';
  const dateShort=d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate();
  if(style==='detail'){
    let txt='实习日报\n\n';
    txt+=`日期：${dateCN}\n姓名：${r.name||USER_NAME}\n岗位：${USER_POS}\n`;
    if(r.serviceItem)txt+=`服务项：${r.serviceItem}\n`;
    txt+=`服务方式：${r.supportType}\n\n`;
    txt+='今日工作内容\n'+(r.workContent||'')+'\n\n';
    if(r.learningPoints)txt+='学习要点与易错点\n'+r.learningPoints+'\n\n';
    if(r.takeaways)txt+='今日收获\n'+r.takeaways+'\n';
    return txt;
  }else{
    let txt=`日期：${dateShort}\n客户：${r.customer||''}\n`;
    if(r.supportType)txt+=`支持方式：${r.supportType}\n`;
    txt+='今日工作：\n';
    const lines=(r.workContent||'').split('\n').filter(l=>l.trim());
    lines.forEach(l=>txt+=l+'\n');
    return txt;
  }
}

function copyReport(style){
  const r=collectReportData();if(!r)return;
  const txt=generateReportText(r,style);
  navigator.clipboard.writeText(txt).then(()=>showToast(style==='detail'?'详细版已复制':'精简版已复制','success')).catch(()=>{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);showToast('已复制','success')});
}

function copyReportById(id,style){
  const r=state.dailyReports.find(x=>x.id===id);if(!r)return;
  r.name=USER_NAME;
  const txt=generateReportText(r,style);
  navigator.clipboard.writeText(txt).then(()=>showToast('已复制','success')).catch(()=>{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);showToast('已复制','success')});
}

function collectReportData(){
  const date=document.getElementById('rptDate').value||todayStr();
  const customer=document.getElementById('rptCustomer').value.trim();
  const serviceItem=document.getElementById('rptServiceItem').value.trim();
  const supportType=document.getElementById('rptSupportType').value;
  const workContent=document.getElementById('rptWorkContent').value.trim();
  const learningPoints=document.getElementById('rptLearning').value.trim();
  const takeaways=document.getElementById('rptTakeaways').value.trim();
  if(!customer){showToast('请输入客户名称','error');return null;}
  if(!workContent){showToast('请填写今日工作内容','error');return null;}
  return{id:uid(),date,customer,serviceItem,supportType,workContent,learningPoints,takeaways,name:USER_NAME,createdAt:Date.now()};
}

async function saveDailyReport(){
  const data=collectReportData();if(!data)return;
  // ponytail: 按 (日期,客户) upsert，避免重复保存生成多条同日日报
  let rep=state.dailyReports.find(x=>x.date===data.date&&x.customer===data.customer);
  if(rep){
    rep.serviceItem=data.serviceItem;rep.supportType=data.supportType;
    rep.workContent=data.workContent;rep.learningPoints=data.learningPoints;
    rep.takeaways=data.takeaways;rep.name=data.name;
  }else{
    rep=data;state.dailyReports.push(rep);
  }
  state.isSample=false;
  saveState();renderPastReports();updateBackupBar();
  if(vaultDirHandle){await exportDailyToObsidian(rep);rep.exportedToObsidian=true;saveState();}
  showToast('日报已保存'+(vaultDirHandle?'，已同步到知识库':''),'success');
}

async function exportDailyReportById(id){
  const r=state.dailyReports.find(x=>x.id===id);if(!r)return;
  if(!vaultDirHandle){await pickVaultDir();}
  if(!vaultDirHandle){showToast('未选择知识库目录，无法导出','error');return;}
  await exportDailyToObsidian(r);
  r.exportedToObsidian=true;saveState();
  showToast('已导出 '+r.date+' 日报到 6-日记','success');
}

async function exportCurrentDaily(){
  const data=collectReportData();if(!data)return;   // 校验客户+工作内容
  let rep=state.dailyReports.find(x=>x.date===data.date&&x.customer===data.customer);
  if(rep){
    rep.serviceItem=data.serviceItem;rep.supportType=data.supportType;
    rep.workContent=data.workContent;rep.learningPoints=data.learningPoints;
    rep.takeaways=data.takeaways;rep.name=data.name;
  }else{
    rep=data;state.dailyReports.push(rep);
  }
  if(!vaultDirHandle){await pickVaultDir();}
  if(!vaultDirHandle){showToast('未选择知识库目录，无法导出','error');return;}
  await exportDailyToObsidian(rep);
  rep.exportedToObsidian=true;saveState();renderPastReports();
  showToast('已导出日报到知识库','success');
}

function confirmDeleteReport(id){
  const r=state.dailyReports.find(x=>x.id===id);if(!r)return;
  showModal('删除日报',`确认从工作台删除 ${r.date} 的日报（客户：${r.customer}）？\n\n仅移除工作台中的这条记录；\n知识库 6-日记/${r.date}.md 不受影响，仍需在 Obsidian 中手动删除。`,()=>{deleteReport(id);closeModal();},'确认删除');
}
function deleteReport(id){
  state.dailyReports=state.dailyReports.filter(x=>x.id!==id);
  saveState();renderPastReports();updateBackupBar();
}

function clearReportForm(){
  document.getElementById('rptCustomer').value='';
  document.getElementById('rptServiceItem').value='';
  document.getElementById('rptWorkContent').value='';
  document.getElementById('rptLearning').value='';
  document.getElementById('rptTakeaways').value='';
  document.getElementById('rptDate').value=todayStr();
}