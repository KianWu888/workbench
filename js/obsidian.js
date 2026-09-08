/* ========== Obsidian Export ========== */
// ponytail: 扫描项目文件夹，双向包含匹配。O(n)扫描，客户数<1000无性能问题
async function matchCustomerFolder(custName){
  const input=custName.trim();
  try{
    const projDir=await vaultDirHandle.getDirectoryHandle('1-项目',{create:true});
    const deliveryDir=await projDir.getDirectoryHandle('客户交付',{create:true});
    const entries=[];
    for await(const[name,handle]of deliveryDir.entries()){if(handle.kind==='directory')entries.push(name);}
    for(const folder of entries){
      const clean=folder.replace(/^\d+_/,'');
      if(clean.includes(input)||input.includes(clean))return{folder,clean};
    }
    let maxNum=entries.reduce((m,f)=>{const n=f.match(/^(\d+)_/);return n?Math.max(m,parseInt(n[1])):m;},0);
    // ponytail: 同时扫描归档目录，避免新客户编号与已归档项目撞号（全局编号池共享）
    try{
      const archiveDir=await vaultDirHandle.getDirectoryHandle('4-存档',{create:false});
      const archProjDir=await archiveDir.getDirectoryHandle('客户项目归档',{create:false});
      for await(const[name,handle]of archProjDir.entries()){if(handle.kind==='directory'){const n=name.match(/^(\d+)_/);if(n)maxNum=Math.max(maxNum,parseInt(n[1]));}}
    }catch(e){/* 归档目录不存在则忽略 */}
    const newFolder=String(maxNum+1).padStart(2,'0')+'_'+input;
    await deliveryDir.getDirectoryHandle(newFolder,{create:true});
    return{folder:newFolder,clean:input};
  }catch(e){console.error('matchCustomerFolder error',e);return{folder:input,clean:input};}
}

/* ========== 跟进截图同步到 Obsidian（与文字同一保存时机） ========== */
// ponytail: base64 解码为二进制写盘；文件名按图片内容哈希，幂等不重复；vault 根目录「附件/」
function _imgExt(mime){const e=(mime||'image/png').split('/')[1]||'png';return e.replace('+xml','').replace('jpeg','jpg');}
function _b64ToBytes(b64){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
async function _imgId(b64){
  try{if(crypto&&crypto.subtle){const buf=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(b64));return [...new Uint8Array(buf)].slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('');}}catch(e){}
  return 'x'+b64.length.toString(36)+'-'+b64.slice(-16).replace(/[^a-z0-9]/gi,'');
}
// 把 blocks 里的 base64 截图写入 vault 附件目录，并在 block 上 memoize 一个稳定 id（供嵌入引用）
async function syncLogImagesToVault(blocks){
  if(!vaultDirHandle||!blocks)return;
  try{
    const perm=await vaultDirHandle.queryPermission({mode:'readwrite'});
    if(perm!=='granted')return;
    const attDir=await vaultDirHandle.getDirectoryHandle('附件',{create:true});
    for(const b of blocks){
      if(b.t!=='img'||!b.v||b.v.indexOf('data:')!==0)continue;
      const mm=b.v.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      if(!mm)continue;
      const mime=mm[1],b64=mm[2],ext=_imgExt(mime);
      if(!b.id)b.id=await _imgId(b64);
      const fname='att-'+b.id+'.'+ext;
      try{const fh=await attDir.getFileHandle(fname,{create:true});const w=await fh.createWritable();await w.write(_b64ToBytes(b64));await w.close();}
      catch(e){console.error('syncLogImagesToVault write',e);}
    }
  }catch(e){console.error('syncLogImagesToVault',e);}
}
// 把 blocks 里的图片转成 Obsidian 嵌入语法（![[附件/att-xxx.png]]）；未同步则留提示
function logImageEmbeds(blocks){
  if(!blocks||!blocks.length)return '';
  const out=[];
  for(const b of blocks){
    if(b.t!=='img')continue;
    if(b.id){const m=b.v.match(/^data:image\/([a-zA-Z0-9.+-]+)/);const e=(m&&m[1])?_imgExt(m[1]):'png';out.push('![[附件/att-'+b.id+'.'+e+']]');}
    else out.push('（截图：未连接知识库，未同步）');
  }
  return out.join('\n');
}

async function exportDailyToObsidian(r){
  if(!vaultDirHandle)return;
  try{
    const perm=await vaultDirHandle.queryPermission({mode:'readwrite'});
    if(perm!=='granted'){const req=await vaultDirHandle.requestPermission({mode:'readwrite'});if(req!=='granted')return;}
    const date=r.date;
    const diaryDir=await vaultDirHandle.getDirectoryHandle('6-日记',{create:true});
    const fileName=date+'.md';
    let existing='';
    try{const fh=await diaryDir.getFileHandle(fileName);const f=await fh.getFile();existing=await f.text();}catch(e){}
    const d=parseDate(date)||new Date();
    const dateCN=d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';
    // ponytail: 按日期汇总当天所有日报（支持一日多客户），整块 regenerate，不再 append（避免重复）
    const dayReports=state.dailyReports.filter(x=>x.date===date);
    if(!dayReports.length)return;   // 该日期无任何日报则不生成/覆盖文件
    let blocks='';
    for(const rep of dayReports){
      const mc=await matchCustomerFolder(rep.customer);
      const linkPath='1-项目/客户交付/'+mc.folder+'/项目概述';
      let entry='### [['+linkPath+'|'+mc.clean+']]\n';
      entry+='- 日期：'+dateCN+'\n';
      if(rep.serviceItem)entry+='- 服务项：'+rep.serviceItem+'\n';
      entry+='- 支持方式：'+rep.supportType+'\n\n';
      const wc=stripDailyMarkers(rep.workContent);
      if(wc)entry+='**今日工作内容**\n'+wc+'\n\n';
      // ponytail: 从 log.blocks 重建今日跟进/卡点（含粘贴截图），与文字同一时机写盘到附件目录
      const logMd=await buildDailyLogMd(date, rep.customer);
      if(logMd)entry+='\n'+logMd+'\n';
      if(rep.learningPoints)entry+='**学习要点与易错点**\n'+rep.learningPoints+'\n\n';
      if(rep.takeaways)entry+='**今日收获**\n'+rep.takeaways+'\n';
      // 今日灵感（双向链接到 5-卡片盒 灵感文件）
      const notes=state.notes.filter(n=>{const dn=new Date(n.createdAt||Date.now());return dn.getFullYear()+'-'+pad(dn.getMonth()+1)+'-'+pad(dn.getDate())===date;});
      if(notes.length){
        entry+='\n## 今日灵感\n';
        notes.forEach(n=>{
          const dt=new Date(n.createdAt||Date.now());
          const ds=String(dt.getFullYear()).slice(2)+pad(dt.getMonth()+1)+pad(dt.getDate());
          const kw=(n.content||'未命名').replace(/[\/\\:*?"<>|]/g,'-').replace(/\s+/g,' ').trim().slice(0,12)||'未命名';
          entry+='- [['+'5-卡片盒/灵感-'+ds+'-'+kw+'|'+(n.content||'').slice(0,30)+']]\n';
        });
      }
      const today=state.tasks.filter(t=>{
        const td=t.doneAt&&new Date(t.doneAt).toDateString()===d.toDateString();
        const cd=t.createdAt&&new Date(t.createdAt).toDateString()===d.toDateString();
        return td||cd;
      });
      if(today.length){
        entry+='\n## 今日待办\n';
        const done=today.filter(t=>t.completed);
        const pending=today.filter(t=>!t.completed);
        if(done.length){entry+='\n### 已完成\n';done.forEach(t=>{entry+='- [x] '+t.title+(t.moduleId?'`'+moduleDisplayName(t.moduleId)+'`':'')+'\n';});}
        if(pending.length){entry+='\n### 未完成\n';pending.forEach(t=>{entry+='- [ ] '+t.title+(t.moduleId?'`'+moduleDisplayName(t.moduleId)+'`':'')+'\n';});}
      }
      blocks+='\n'+entry+'\n';
    }
    const WB_START='<!-- WB-AUTO:日报 -->';
    const WB_END='<!-- /WB-AUTO -->';
    const wrapped=WB_START+'\n'+blocks.trim()+'\n'+WB_END;
    let out;
    if(existing.includes(WB_START))out=existing.replace(new RegExp(WB_START+'[\\s\\S]*?'+WB_END),wrapped);
    else out='# '+dateCN+'\n\n> 当日日报\n\n'+wrapped;   // 旧 append 版整块替换（以工作台为准，清理历史重复）
    const fh=await diaryDir.getFileHandle(fileName,{create:true});
    const w=await fh.createWritable();
    await w.write(out);
    await w.close();
    dayReports.forEach(rep=>{rep.exportedToObsidian=true;});
    // ponytail: 不在此处 saveState —— 避免 autoSync↔export 重入死循环，由调用方负责保存
  }catch(e){console.error('exportDailyToObsidian error',e)}
}

async function exportNotesToObsidian(silent){
  if(!vaultDirHandle){await pickVaultDir();}
  if(!vaultDirHandle){showToast('未选择知识库目录，无法导出','error');return;}
  const perm=await vaultDirHandle.queryPermission({mode:'readwrite'});
  if(perm!=='granted'){const req=await vaultDirHandle.requestPermission({mode:'readwrite'});if(req!=='granted'){showToast('需要写入权限','error');return;}}
  // ponytail: 灵感统一进 5-卡片盒，每条独立文件，文件名=日期时间+关键词，好找不撞名
  const cardDir=await vaultDirHandle.getDirectoryHandle('5-卡片盒',{create:true});
  const fresh=state.notes.filter(n=>!n.exportedToObsidian);
  if(!fresh.length){if(!silent)showToast('没有新的灵感需要导出','error');return;}
  let exported=0;
  for(const n of fresh){
    const d=new Date(n.createdAt||Date.now());
    const ds=String(d.getFullYear()).slice(2)+pad(d.getMonth()+1)+pad(d.getDate());
    const kw=(n.content||'未命名').replace(/[\/\\:*?"<>|]/g,'-').replace(/\s+/g,' ').trim().slice(0,12)||'未命名';
    const safeName='灵感-'+ds+'-'+kw;
    let md='';
    if(n.tags)md+='- 标签：'+n.tags+'\n';
    md+='- 时间：'+d.toLocaleString('zh-CN')+'\n\n';
    md+=n.content+'\n';
    // 双向链接：灵感文件头反链到当天日报，Obsidian 两边可见
    const nd=new Date(n.createdAt||Date.now());
    const ndate=nd.getFullYear()+'-'+pad(nd.getMonth()+1)+'-'+pad(nd.getDate());
    md+='\n- 关联日报：[['+'6-日记/'+ndate+'|'+ndate+' 日报]]\n';
    const fh=await cardDir.getFileHandle(safeName+'.md',{create:true});
    const w=await fh.createWritable();
    await w.write(md);
    await w.close();
    n.exportedToObsidian=true;
    exported++;
  }
  saveState();renderNotes();
  if(!silent)showToast('已导出 '+exported+' 条灵感到 5-卡片盒','success');
}

async function exportProjectLogsToObsidian(silent){
  if(!vaultDirHandle){await pickVaultDir();}
  if(!vaultDirHandle){showToast('未选择知识库目录，无法导出','error');return;}
  const perm=await vaultDirHandle.queryPermission({mode:'readwrite'});
  if(perm!=='granted'){const req=await vaultDirHandle.requestPermission({mode:'readwrite'});if(req!=='granted'){showToast('需要写入权限','error');return;}}
  const prioLabel={P0:'P0紧急',P1:'P1重要',P2:'P2一般'};
  let exported=0;
  for(const p of state.projects){
    let hasContent=false;
    const modSections=[];
    const currentIds=new Set();
    for(const m of (p.modules||[])){
      const logs=(m.logs||[]).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
      const tasks=state.tasks.filter(t=>t.moduleId===m.id);
      const blks=(m.logs||[]).filter(l=>l.isBlocker);
      hasContent=true;   // 模块本身即结构内容：创建即有则写入知识库，不再因空模块跳过
      let sec='### '+m.name+'\n\n';
      sec+='#### 跟进记录（当前进度 / 下一步）\n\n';
      if(logs.length){
        for(const l of logs){
          currentIds.add(l.id);
          let line='- '+l.date+' '+(l.isBlocker?'(卡点) ':'')+'【当前进度】'+l.content;
          if(l.nextStep)line+=' · 【下一步】'+l.nextStep;
          line+=' <!-- id:'+l.id+' -->\n';
          sec+=line;
          if(l.blocks&&l.blocks.some(b=>b.t==='img')){await syncLogImagesToVault(l.blocks);const emb=logImageEmbeds(l.blocks);if(emb)sec+=emb+'\n';}
        }
      }else{sec+='（暂无）\n';}
      sec+='\n#### 关联待办\n\n';
      if(tasks.length){tasks.forEach(t=>{const box=t.completed?'[x]':'[ ]';const prio=prioLabel[t.priority]||t.priority||'';const dl=t.deadline?(' · '+fmtDate(parseDate(t.deadline))):'';currentIds.add(t.id);sec+='- '+box+' '+(prio?prio+' ':'')+dl+' '+t.title+(t.completed?'（已完成）':'')+' <!-- id:'+t.id+' -->\n';});}else{sec+='（暂无）\n';}
      sec+='\n#### 卡点记录\n\n';
      if(blks.length){
        for(const b of blks){
          currentIds.add(b.id);
          const tag=b.blockerStatus==='已解决'?'✓ 已解决':(b.blockerStatus==='排查中'?'排查中':'待排查');
          sec+='- '+tag+' '+b.content+(b.workOrder?('（工单 '+b.workOrder+'）'):'');
          if(b.timeline&&b.timeline.length){sec+='\n  - 排查过程：\n'+b.timeline.map(t=>'    · '+fmtTime(t.time)+' '+t.text).join('\n');}
          if(b.blockerStatus==='已解决'&&b.resolution)sec+=' → '+b.resolution;
          sec+=' <!-- id:'+b.id+' -->\n';
          if(b.blocks&&b.blocks.some(x=>x.t==='img')){await syncLogImagesToVault(b.blocks);const emb=logImageEmbeds(b.blocks);if(emb)sec+=emb+'\n';}
        }
      }else{sec+='（暂无）\n';}
      modSections.push(sec);
    }
    if(!hasContent)continue;
    const mc=await matchCustomerFolder(p.customer||'未命名客户');
    const projDir=await vaultDirHandle.getDirectoryHandle('1-项目',{create:true});
    const deliveryDir=await projDir.getDirectoryHandle('客户交付',{create:true});
    const custDir=await deliveryDir.getDirectoryHandle(mc.folder,{create:true});
    let existing='';
    try{const fh=await custDir.getFileHandle('项目概述.md');const f=await fh.getFile();existing=await f.text();}catch(e){}
    // ponytail: 按 id 合并——vault 只增不减。工作台删除的跟进保留归档，编辑的跟进同步更新，绝不整段重画
    const WB_START='<!-- WB-AUTO:项目跟进记录 -->';
    const WB_END='<!-- /WB-AUTO -->';
    const vaultIdLines=new Map();
    existing.split('\n').forEach(line=>{const mm=line.match(/<!-- id:([\w-]+) -->/);if(mm)vaultIdLines.set(mm[1],line);});
    const orphanLines=[];
    for(const[id,line] of vaultIdLines){if(!currentIds.has(id))orphanLines.push(line);}
    // ponytail: 反向链接——客户概述里列出该客户所有已导出踩坑，与踩坑文件里的 [[客户概述]] 形成双向链接
    const custCases=state.cases.filter(c=>c.obsidianLink&&c.projectName&&(c.projectName.includes(p.customer)||p.customer.includes(c.projectName)));
    let caseSec='';
    if(custCases.length){caseSec='\n## 相关踩坑\n\n';custCases.forEach(c=>{caseSec+='- [['+c.obsidianLink+'|'+(c.blocker||'未命名案例')+']]\n';});}
    let body='## 项目跟进记录\n\n'+modSections.join('\n')+caseSec;
    if(orphanLines.length){body+='\n### 已从工作台移除的跟进（保留归档）\n'+orphanLines.join('\n')+'\n';}
    const wrapped=WB_START+'\n'+body+'\n'+WB_END;
    let out;
    if(existing.includes(WB_START)){
      out=existing.replace(new RegExp(WB_START+'[\\s\\S]*?'+WB_END), wrapped);
    }else if(existing.indexOf('## 项目跟进记录')>=0){
      out=existing.replace(/\s*$/,'')+'\n\n'+wrapped;   // 旧文件/手写：整体保留，自动块追加末尾
    }else if(existing.trim()){
      out=existing.replace(/\s*$/,'')+'\n\n'+wrapped;
    }else{
      out='# '+mc.clean+'\n\n'+wrapped;
    }
    const fh=await custDir.getFileHandle('项目概述.md',{create:true});
    const w=await fh.createWritable();
    await w.write(out);
    await w.close();
    exported++;
  }
  if(!silent){
    if(exported)showToast('已导出 '+exported+' 个项目到 1-项目/客户交付','success');
    else showToast('没有可导出的项目','error');
  }
}

/* ponytail: 统一踩坑卡片的 Obsidian 链接命名，避免日报/客户概述/卡片互相引用时文件名对不上 */
function computeCaseLink(c){
  const dt=c.occurredDate?new Date(c.occurredDate):(c.resolvedAt?new Date(c.resolvedAt):new Date());
  const ds2=String(dt.getFullYear()).slice(2)+pad(dt.getMonth()+1)+pad(dt.getDate());
  const blocker=(c.blocker||'未命名案例').trim().replace(/[\/\\:*?"<>|]/g,'-').slice(0,20);
  return '5-卡片盒/踩坑-'+ds2+'-'+blocker;
}

async function exportCasesToKnowledgeBase(silent){
  if(!vaultDirHandle){await pickVaultDir();}
  if(!vaultDirHandle){showToast('未选择知识库目录，无法导出','error');return;}
  const perm=await vaultDirHandle.queryPermission({mode:'readwrite'});
  if(perm!=='granted'){const req=await vaultDirHandle.requestPermission({mode:'readwrite'});if(req!=='granted'){showToast('需要写入权限','error');return;}}
  const fresh=state.cases.filter(c=>!c.exportedToObsidian);
  if(!fresh.length){if(!silent)showToast('没有新的案例需要导出','error');return;}
  // ponytail: 原子笔记统一进 5-卡片盒；2-领域/飞连产品 只留 MOC 索引
  const cardDir=await vaultDirHandle.getDirectoryHandle('5-卡片盒',{create:true});
  let exported=0;
  for(const c of fresh){
    const ds=c.occurredDate?fmtDate(new Date(c.occurredDate)):(c.resolvedAt?fmtDate(new Date(c.resolvedAt)):todayStr());
    const blocker=(c.blocker||'未命名案例').trim();
    const link=c.obsidianLink||computeCaseLink(c);
    const safeName=link.replace(/^5-卡片盒\//,'');
    let custLink='';
    if(c.projectName){
      const mc=await matchCustomerFolder(c.projectName);
      custLink='[['+'1-项目/客户交付/'+mc.folder+'/项目概述|'+mc.clean+']]';
    }
    // ponytail: 不设 H1——文件名即标题，避免文件名与正文标题重复
    let md='';
    if(c.projectName)md+='- 关联客户：'+custLink+'\n';
    md+='- 日期：'+ds+'\n';
    if(c.resolvedAt){const rd=fmtDate(new Date(c.resolvedAt));if(rd!==ds)md+='- 解决日期：'+rd+'\n';}
    md+='\n';
    md+='## 问题描述\n'+blocker+'\n\n';
    md+='## 解决方案\n'+(c.resolution||'（未填写）')+'\n';
    // 双向链接：踩坑卡片反链到含该卡点的当日日报（log.date），Obsidian 两边都可见
    let logDate=null;
    for(const p of state.projects)for(const m of (p.modules||[]))for(const l of (m.logs||[]))if(l.caseId===c.id){logDate=l.date;break;}
    if(logDate)md+='\n- 关联日报：[['+'6-日记/'+logDate+'|'+logDate+' 日报]]\n';
    const fh=await cardDir.getFileHandle(safeName+'.md',{create:true});
    const w=await fh.createWritable();
    await w.write(md);
    await w.close();
    c.exportedToObsidian=true;
    c.obsidianLink=link;  // 供客户概述反向链接 + 日报反链
    exported++;
  }
  saveState();renderCases();
  if(!silent)showToast('已导出 '+exported+' 条案例到 5-卡片盒','success');
}

/* ========== 创建/确保客户在 1-项目/客户交付/ 的目录（带序号前缀） ========== */
async function ensureCustomerFolderInVault(custName){
  if(!vaultDirHandle)return null;
  try{
    const perm=await vaultDirHandle.queryPermission({mode:'readwrite'});
    if(perm!=='granted'){const req=await vaultDirHandle.requestPermission({mode:'readwrite'});if(req!=='granted')return null;}
    const mc=await matchCustomerFolder(custName);
    const projDir=await vaultDirHandle.getDirectoryHandle('1-项目',{create:true});
    const deliveryDir=await projDir.getDirectoryHandle('客户交付',{create:true});
    const custDir=await deliveryDir.getDirectoryHandle(mc.folder,{create:true});
    try{await custDir.getFileHandle('项目概述.md');}catch(e){
      const fh=await custDir.getFileHandle('项目概述.md',{create:true});
      const w=await fh.createWritable();
      await w.write('# '+mc.clean+'\n\n');
      await w.close();
    }
    return mc;
  }catch(e){console.error('ensureCustomerFolderInVault',e);return null;}
}

/* ========== 保存即自动导出（静默、防抖、不弹权限窗） ========== */
let _autoSyncBusy=false,_autoSyncDirty=false;
async function autoSyncToObsidian(){
  if(!vaultDirHandle)return;            // 未选知识库则跳过，不弹窗
  if(_autoSyncBusy){_autoSyncDirty=true;return;}
  _autoSyncBusy=true;
  try{
    const perm=await vaultDirHandle.queryPermission({mode:'readwrite'});
    if(perm!=='granted')return;         // 权限未授予则跳过，等手动导出时再要
    if(state.projects&&state.projects.length)await exportProjectLogsToObsidian(true);
    if(state.cases&&state.cases.some(c=>!c.exportedToObsidian))await exportCasesToKnowledgeBase(true);
    if(state.notes&&state.notes.some(n=>!n.exportedToObsidian))await exportNotesToObsidian(true);
    const dr=state.dailyReports.find(r=>r.date===todayStr());
    if(dr)await exportDailyToObsidian(dr);   // 每次保存即整块 regenerate 当日日报（含今日待办），幂等无重复
  }catch(e){console.error('autoSync',e);}
  finally{_autoSyncBusy=false;}
  if(_autoSyncDirty){_autoSyncDirty=false;autoSyncToObsidian();}
}