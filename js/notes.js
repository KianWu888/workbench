/* ========== Notes ========== */
function getAllTags(){const s=new Set();state.notes.forEach(n=>(n.tags||[]).forEach(t=>s.add(t)));return[...s].sort()}

function renderNotes(){
  const search=document.getElementById('noteSearch').value.trim().toLowerCase();
  let notes=state.notes.slice().sort((a,b)=>b.createdAt-a.createdAt);
  if(noteTagFilter)notes=notes.filter(n=>(n.tags||[]).includes(noteTagFilter));
  if(search)notes=notes.filter(n=>(n.content||'').toLowerCase().includes(search));
  const tags=getAllTags();
  const tf=document.getElementById('tagFilterBar');
  tf.innerHTML=tags.map(t=>`<span class="tag-filter${noteTagFilter===t?' active':''}" onclick="${noteTagFilter===t?'noteTagFilter=null;':''}filterNotesByTag('${t.replace(/'/g,"\\'")}')">${escapeHtml(t)}</span>`).join('');
  if(noteTagFilter)tf.innerHTML=`<span class="tag-filter active" onclick="noteTagFilter=null;renderNotes()">✕ ${escapeHtml(noteTagFilter)} (清除)</span>`+tf.innerHTML;
  const el=document.getElementById('noteList');
  if(!notes.length){el.innerHTML='<div class="empty-hint">暂无速记</div>';return;}
  el.innerHTML=notes.map(n=>{
    const d=new Date(n.createdAt);
    const dateStr=d.getMonth()+1+'月'+d.getDate()+'日 '+pad(d.getHours())+':'+pad(d.getMinutes());
    const tags=(n.tags||[]).map(t=>`<span class="tag" onclick="filterNotesByTag('${t.replace(/'/g,"\\'")}')">${escapeHtml(t)}</span>`).join('');
    return`<div class="note-card"><div class="note-content">${escapeHtml(n.content)}</div><div class="note-meta"><div class="note-tags">${tags}</div><div class="note-date">${dateStr} <button class="btn-icon" onclick="confirmDeleteNote('${n.id}')" style="margin-left:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div></div>`;
  }).join('');
}

function filterNotesByTag(t){noteTagFilter=noteTagFilter===t?null:t;renderNotes();}

function addNote(){
  const content=document.getElementById('noteContent').value.trim();
  if(!content){showToast('请输入内容','error');return;}
  const tagsStr=document.getElementById('noteTags').value.trim();
  const tags=tagsStr?tagsStr.split(/[,，]/).map(s=>s.trim()).filter(Boolean):[];
  state.notes.push({id:uid(),content,tags,createdAt:Date.now()});
  document.getElementById('noteContent').value='';
  document.getElementById('noteTags').value='';
  state.isSample=false;
  saveState();renderNotes();updateBackupBar();
  showToast('已记录','success');
}

function deleteNote(id){state.notes=state.notes.filter(x=>x.id!==id);saveState();renderNotes();updateBackupBar();}

function confirmDeleteNote(id){
  const n=state.notes.find(x=>x.id===id);
  const preview=n?n.content.slice(0,30)+(n.content.length>30?'…':''):'';
  showModal('删除速记',`确认删除这条速记？\n${preview}`,()=>{deleteNote(id);closeModal();});
}