/* ========== Review ========== */
function renderReview(){
  const now=new Date();
  const weekStart=new Date(now);weekStart.setDate(now.getDate()-now.getDay());weekStart.setHours(0,0,0,0);
  const weekEnd=new Date(weekStart);weekEnd.setDate(weekStart.getDate()+7);
  const weekTasks=state.tasks.filter(t=>t.completed&&t.completedAt>=weekStart.getTime()&&t.completedAt<weekEnd.getTime());
  const totalTasks=state.tasks.length;
  const completedAll=state.tasks.filter(t=>t.completed).length;
  const p0=weekTasks.filter(t=>t.priority==='P0').length;
  const p1=weekTasks.filter(t=>t.priority==='P1').length;
  const p2=weekTasks.filter(t=>t.priority==='P2').length;
  const maxPrio=Math.max(p0,p1,p2,1);
  document.getElementById('reviewStats').innerHTML=`
    <div class="stat-card"><div class="stat-value">${weekTasks.length}</div><div class="stat-label">本周完成</div></div>
    <div class="stat-card"><div class="stat-value">${completedAll}</div><div class="stat-label">累计完成</div></div>
    <div class="stat-card"><div class="stat-value">${totalTasks-completedAll}</div><div class="stat-label">待完成</div></div>
    <div class="stat-card"><div class="stat-value">${state.projects.length}</div><div class="stat-label">跟进项目</div></div>`;
  const barW=160;
  document.getElementById('priorityChart').innerHTML=`<svg class="chart-svg" viewBox="0 0 260 78" xmlns="http://www.w3.org/200/svg">
    <rect x="50" y="4" width="${p0/maxPrio*barW}" height="16" fill="#ef4444" rx="4"/><text x="4" y="16" fill="#1e293b" font-size="11">P0紧急</text><text x="${54+p0/maxPrio*barW}" y="16" fill="#1e293b" font-size="11">${p0}</text>
    <rect x="50" y="29" width="${p1/maxPrio*barW}" height="16" fill="#f59e0b" rx="4"/><text x="4" y="41" fill="#1e293b" font-size="11">P1重要</text><text x="${54+p1/maxPrio*barW}" y="41" fill="#1e293b" font-size="11">${p1}</text>
    <rect x="50" y="54" width="${p2/maxPrio*barW}" height="16" fill="#0d9488" rx="4"/><text x="4" y="66" fill="#1e293b" font-size="11">P2一般</text><text x="${54+p2/maxPrio*barW}" y="66" fill="#1e293b" font-size="11">${p2}</text>
  </svg>`;
  const projData=[];
  state.projects.forEach(p=>(p.modules||[]).forEach(m=>{
    const count=state.tasks.filter(t=>t.moduleId===m.id&&!t.completed).length+state.tasks.filter(t=>t.moduleId===m.id&&t.completed&&t.completedAt>=weekStart.getTime()).length;
    projData.push({name:(p.customer?p.customer+'·':'')+m.name,count});
  }));
  projData.sort((a,b)=>b.count-a.count);
  const maxProj=Math.max(...projData.map(d=>d.count),1);
  const chartH=Math.max(projData.length*22+8,30);
  let projSvg=`<svg class="chart-svg" viewBox="0 0 260 ${chartH}" xmlns="http://www.w3.org/200/svg">`;
  projData.forEach((d,i)=>{
    const y=i*22+4;
    const w=d.count/maxProj*barW;
    projSvg+=`<rect x="60" y="${y}" width="${w}" height="14" fill="#0d9488" rx="3"/><text x="4" y="${y+11}" fill="#1e293b" font-size="10">${escapeHtml(d.name.length>6?d.name.slice(0,5)+'…':d.name)}</text><text x="${64+w}" y="${y+11}" fill="#1e293b" font-size="10">${d.count}</text>`;
  });
  projSvg+='</svg>';
  document.getElementById('projectChart').innerHTML=projData.length?projSvg:'<div class="empty-hint" style="padding:10px">暂无项目数据</div>';
  const blockers=allBlockers(l=>l.blockerStatus!=='已解决');
  document.getElementById('blockerList').innerHTML=blockers.length?blockers.map(b=>`<li><b>${escapeHtml((b.project.customer?b.project.customer+'·':'')+b.module.name)}</b>：${escapeHtml(b.log.content)}</li>`).join(''):'<li style="background:none;border:none;color:var(--text2)">暂无卡点</li>';
}