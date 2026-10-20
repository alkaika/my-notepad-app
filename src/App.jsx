const { useState, useEffect, useMemo, useRef, useCallback } = React;

const STORAGE_KEY = "vibepilot.notepad.notes.v1";
const SORTS = [
  { value: "edited", label: "Last edited" },
  { value: "created", label: "Date created" },
  { value: "title", label: "Title A–Z" },
];

function uid(){
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,9);
}
function displayTitleOf(n){ return (n.title||"").trim() ? n.title.trim() : "Untitled"; }
function previewOf(n){
  if(!n.body) return "";
  return n.body.replace(/[\r\n]+/g," ").replace(/\s+/g," ").trim().slice(0,100);
}
function wordCountOf(body){
  if(!body || !body.trim()) return 0;
  return body.trim().split(/\s+/).length;
}
function timeAgo(iso, nowMs){
  try{
    const t = new Date(iso).getTime();
    if(isNaN(t)) return "";
    const diff = nowMs - t;
    if(diff < 0) return "Just now";
    const s = Math.floor(diff/1000);
    if(s < 10) return "Just now";
    if(s < 60) return s + "s ago";
    const m = Math.floor(s/60);
    if(m < 60) return m + "m ago";
    const h = Math.floor(m/60);
    if(h < 24) return h + "h ago";
    const d = new Date(t);
    const now = new Date(nowMs);
    const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
    const sameDay = (a,b)=> a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
    if(sameDay(d, yesterday)) return "Yesterday";
    const days = Math.floor(diff/(86400000));
    if(days < 7) return days + "d ago";
    const opts = d.getFullYear()===now.getFullYear() ? {month:"short",day:"numeric"} : {month:"short",day:"numeric",year:"numeric"};
    return d.toLocaleDateString(undefined, opts);
  }catch(e){ return ""; }
}
function highlight(text, query){
  if(!query || !text) return text || "";
  const q = query.trim();
  if(!q) return text;
  const lower = text.toLowerCase();
  const lq = q.toLowerCase();
  const parts = [];
  let i=0, k=0;
  while(true){
    const idx = lower.indexOf(lq, i);
    if(idx===-1){ parts.push(text.slice(i)); break; }
    if(idx>i) parts.push(text.slice(i, idx));
    parts.push({__h: text.slice(idx, idx+q.length)});
    i = idx + q.length;
    if(i>=text.length) break;
    k++; if(k>50) { parts.push(text.slice(i)); break; }
  }
  return parts.map((p,ix)=> typeof p==="string" ? <span key={ix}>{p}</span> : <mark key={ix}>{p.__h}</mark>);
}

function Icon({d, className}){
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={d} /></svg>);
}
// We'll use inline SVGs directly for clarity

function App(){
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("edited");
  const [saveStatus, setSaveStatus] = useState("saved");
  const [showDelete, setShowDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const searchRef = useRef(null);
  const titleRefMobile = useRef(null);
  const titleRefDesktop = useRef(null);
  const bodyRefMobile = useRef(null);
  const bodyRefDesktop = useRef(null);
  const saveTimer = useRef(null);
  const justCreatedId = useRef(null);
  const copyTimer = useRef(null);
  const modalCancelRef = useRef(null);
  const modalBoxRef = useRef(null);
  const firstRender = useRef(true);

  // load
  useEffect(()=>{
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        if(Array.isArray(parsed)) setNotes(parsed);
      }
    }catch(e){
      setLoadError("Storage is blocked, but you can still take notes for this session.");
    }finally{
      setLoaded(true);
    }
    const iv = setInterval(()=> setNowMs(Date.now()), 30000);
    return ()=> clearInterval(iv);
  },[]);

  // autosave persist with debounce + indicator
  useEffect(()=>{
    if(!loaded) return;
    if(firstRender.current){ firstRender.current=false; return; }
    setSaveStatus("saving");
    if(saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(()=>{
      try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }
      catch(e){ /* still show saved, session-only */ }
      setSaveStatus("saved");
    }, 600);
    return ()=> { if(saveTimer.current) clearTimeout(saveTimer.current); };
  },[notes, loaded]);

  const activeNote = useMemo(()=> notes.find(n=>n.id===activeNoteId) || null, [notes, activeNoteId]);

  const filtered = useMemo(()=>{
    const q = search.trim().toLowerCase();
    let list = notes;
    if(q) list = notes.filter(n=> (n.title||"").toLowerCase().includes(q) || (n.body||"").toLowerCase().includes(q));
    const sorted = [...list];
    if(sort==="created") sorted.sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    else if(sort==="title") sorted.sort((a,b)=> displayTitleOf(a).localeCompare(displayTitleOf(b)));
    else sorted.sort((a,b)=> new Date(b.updatedAt)-new Date(a.updatedAt));
    return sorted;
  },[notes, search, sort]);

  const pinnedList = useMemo(()=> filtered.filter(n=>n.pinned), [filtered]);
  const unpinnedList = useMemo(()=> filtered.filter(n=>!n.pinned), [filtered]);
  const hasPinned = useMemo(()=> notes.some(n=>n.pinned), [notes]);

  const createNote = useCallback(()=>{
    const now = new Date().toISOString();
    const n = { id: uid(), title:"", body:"", pinned:false, createdAt: now, updatedAt: now };
    setNotes(prev=> [n, ...prev]);
    setActiveNoteId(n.id);
    justCreatedId.current = n.id;
    setShowDelete(false);
  },[]);

  // focus title after create / active change
  useEffect(()=>{
    if(justCreatedId.current && activeNoteId===justCreatedId.current){
      const t = setTimeout(()=>{
        const el = window.innerWidth >= 900 ? titleRefDesktop.current : titleRefMobile.current;
        if(el){ el.focus(); el.select && el.select(); }
        justCreatedId.current = null;
      }, 60);
      return ()=> clearTimeout(t);
    }
  },[activeNoteId]);

  // auto-grow textareas
  const autogrow = (el)=>{
    if(!el) return;
    el.style.height="auto";
    el.style.height = Math.max(220, el.scrollHeight) + "px";
  };
  useEffect(()=>{ autogrow(bodyRefDesktop.current); },[activeNoteId, activeNote?.body]);
  useEffect(()=>{ autogrow(bodyRefMobile.current); },[activeNoteId, activeNote?.body, search]);

  const updateActive = (patch)=>{
    if(!activeNoteId) return;
    const now = new Date().toISOString();
    setNotes(prev=> prev.map(n=> n.id===activeNoteId ? {...n, ...patch, updatedAt: now} : n));
  };
  const togglePin = (id)=>{
    const now = new Date().toISOString();
    setNotes(prev=> prev.map(n=> n.id===id ? {...n, pinned:!n.pinned, updatedAt: now} : n));
  };

  const confirmDelete = ()=> setShowDelete(true);
  const doDelete = ()=>{
    if(!activeNoteId) return;
    const remaining = notes.filter(n=> n.id!==activeNoteId);
    // next most recent
    const sorted = [...remaining].sort((a,b)=> new Date(b.updatedAt)-new Date(a.updatedAt));
    setNotes(remaining);
    setActiveNoteId(sorted.length ? sorted[0].id : null);
    setShowDelete(false);
  };

  const copyBody = async ()=>{
    if(!activeNote) return;
    const text = activeNote.body || "";
    try{
      if(navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else{
        const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
      }
    }catch(e){
      try{
        const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
      }catch(_){}
    }
    setCopied(true);
    if(copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current=setTimeout(()=> setCopied(false), 2000);
  };

  // keyboard
  useEffect(()=>{
    const onKey=(e)=>{
      const isMod = e.ctrlKey || e.metaKey;
      if(isMod && e.key.toLowerCase()==="n"){ e.preventDefault(); createNote(); return; }
      if(isMod && e.key.toLowerCase()==="f"){ e.preventDefault(); searchRef.current && searchRef.current.focus(); return; }
      if(e.key==="Escape"){
        if(showDelete){ setShowDelete(false); return; }
        if(document.activeElement===searchRef.current && search){ setSearch(""); return; }
      }
    };
    window.addEventListener("keydown", onKey);
    return ()=> window.removeEventListener("keydown", onKey);
  },[createNote, showDelete, search]);

  // focus trap for modal
  useEffect(()=>{
    if(showDelete && modalCancelRef.current) modalCancelRef.current.focus();
  },[showDelete]);
  const onModalKeyDown=(e)=>{
    if(e.key==="Tab" && modalBoxRef.current){
      const f = modalBoxRef.current.querySelectorAll('button');
      if(!f.length) return;
      const first=f[0], last=f[f.length-1];
      if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    }
  };

  const total = notes.length;
  const countLabel = search.trim() ? `${filtered.length} of ${total} ${total===1?"note":"notes"}` : `${total} ${total===1?"note":"notes"}`;

  const renderNoteRow=(n)=>{
    const isActive = n.id===activeNoteId;
    const q = search.trim();
    return (
      <button key={n.id} onClick={()=> setActiveNoteId(n.id)}
        className={`w-full text-left rounded-xl border p-3 transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${isActive?"bg-indigo-50 border-indigo-300 shadow-sm":"bg-white border-stone-200 hover:border-stone-300"}`}>
        <div className="flex items-start gap-2">
          {n.pinned && (
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 mt-1 shrink-0 text-amber-600" fill="currentColor" aria-label="Pinned"><path d="M14 3l7 7-3 1-4 4v5l-2 2-2-2v-5L6 11l-1-1 1-1 7-7 1 1zM16 5l-5 5 3 3 5-5-3-3z"/></svg>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-[15px] line-clamp-1 flex-1 text-stone-900">{q ? highlight(displayTitleOf(n), q) : displayTitleOf(n)}</span>
              <span className="text-[11px] text-stone-500 shrink-0 tabular-nums">{timeAgo(n.updatedAt, nowMs)}</span>
            </div>
            <div className="text-[13px] text-stone-500 line-clamp-2 mt-0.5 leading-snug min-h-[18px]">
              {previewOf(n) ? (q ? highlight(previewOf(n), q) : previewOf(n)) : <span className="italic text-stone-400">No additional text</span>}
            </div>
          </div>
        </div>
      </button>
    );
  };

  const editorFooter = activeNote ? (
    <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 border-t border-stone-200 bg-white text-[12px] text-stone-500">
      <span aria-live="polite">{wordCountOf(activeNote.body)} words · {activeNote.body.length} characters</span>
      <span className="flex items-center gap-1.5" aria-live="polite">
        <span className={`w-1.5 h-1.5 rounded-full ${saveStatus==="saving"?"bg-amber-500 pulse-dot":"bg-emerald-500"}`}></span>
        <span className={saveStatus==="saving"?"text-amber-700":"text-stone-500"}>{saveStatus==="saving"?"Saving…":"Saved"}</span>
      </span>
    </div>
  ) : null;

  const editorTopButtons = (isMobile)=>(
    <div className="flex items-center gap-1">
      <button onClick={()=> togglePin(activeNote.id)} title={activeNote.pinned?"Unpin":"Pin"}
        aria-label={activeNote.pinned?"Unpin note":"Pin note"} aria-pressed={activeNote.pinned}
        className={`p-2 rounded-lg transition ${activeNote.pinned?"text-amber-600 bg-amber-100 hover:bg-amber-200":"text-stone-500 hover:bg-stone-100 hover:text-stone-700"}`}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill={activeNote.pinned?"currentColor":"none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7z"/></svg>
      </button>
      <button onClick={copyBody} title="Copy note body" aria-label="Copy note body"
        className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition relative">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        {copied && <span className="absolute -bottom-7 right-0 text-[11px] bg-stone-900 text-white px-2 py-0.5 rounded-md whitespace-nowrap fade-in">Copied</span>}
      </button>
      <button onClick={confirmDelete} title="Delete note" aria-label="Delete note"
        className="p-2 rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-600 transition">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>
      </button>
    </div>
  );

  const editorBody = (mode)=>{ // mode: mobile|desktop
    if(!activeNote) return null;
    const titleRef = mode==="mobile"? titleRefMobile : titleRefDesktop;
    const bodyRef = mode==="mobile"? bodyRefMobile : bodyRefDesktop;
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        <div className={`flex-1 overflow-y-auto scroll-thin ${mode==="desktop"?"px-4 sm:px-8 py-5":"px-4 py-4"}`}>
          <div className={`${mode==="desktop"?"max-w-[760px] mx-auto w-full":"w-full"}`}>
            <label htmlFor={`title-${mode}`} className="sr-only">Note title</label>
            <input id={`title-${mode}`} ref={titleRef} value={activeNote.title} maxLength={200}
              onChange={(e)=> updateActive({title: e.target.value.slice(0,200)})}
              placeholder="Untitled" autoComplete="off"
              className="w-full text-2xl sm:text-[28px] font-bold placeholder:text-stone-300 text-stone-900 outline-none border-0 focus:ring-0 bg-transparent py-1" />
            <div className="text-[11px] text-stone-400 mt-0.5 mb-2">Created {new Date(activeNote.createdAt).toLocaleString()} · Updated {timeAgo(activeNote.updatedAt, nowMs)}</div>
            <label htmlFor={`body-${mode}`} className="sr-only">Note body</label>
            <textarea id={`body-${mode}`} ref={bodyRef} value={activeNote.body}
              onChange={(e)=>{ updateActive({body: e.target.value}); autogrow(e.target); }}
              placeholder="Start writing…"
              rows={12}
              className="w-full resize-none outline-none border-0 focus:ring-0 bg-transparent text-[16px] leading-7 text-stone-800 placeholder:text-stone-300 min-h-[50vh]" />
          </div>
        </div>
        {editorFooter}
      </div>
    );
  };

  return (
    <div className="h-dvh flex flex-col min-[900px]:flex-row min-h-screen bg-stone-100" style={{height:"100dvh"}}>
      {loadError && (
        <div className="bg-amber-100 text-amber-900 text-[13px] px-4 py-2 text-center border-b border-amber-200" role="alert">{loadError}</div>
      )}
      {/* LEFT COLUMN */}
      <aside className="w-full min-[900px]:w-[360px] min-[900px]:shrink-0 min-[900px]:border-r border-stone-200 bg-stone-50 flex flex-col min-h-0 flex-1 min-[900px]:flex-none min-[900px]:h-full" style={{minHeight:0}}>
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white grid place-items-center shadow-sm">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </span>
            Notepad
          </h1>
          <button onClick={createNote} aria-label="Create new note (Ctrl+N)" title="New note (Ctrl+N)"
            className="w-9 h-9 grid place-items-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition shadow-sm">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>

        <div className="px-4 pb-2 flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            </span>
            <label htmlFor="search" className="sr-only">Search notes</label>
            <input id="search" ref={searchRef} value={search} onChange={(e)=> setSearch(e.target.value)}
              placeholder="Search notes…  (Ctrl+F)" autoComplete="off"
              className="w-full pl-9 pr-8 py-2 rounded-xl border border-stone-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 placeholder:text-stone-400" />
            {search && (
              <button onClick={()=> setSearch("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
          <div>
            <label htmlFor="sort" className="sr-only">Sort notes</label>
            <select id="sort" value={sort} onChange={(e)=> setSort(e.target.value)}
              className="py-2 px-2 rounded-xl border border-stone-200 bg-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer max-w-[118px]">
              {SORTS.map(s=> <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div className="px-4 py-2 flex items-center justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-stone-500" aria-live="polite">{countLabel}</span>
          <button onClick={createNote} className="min-[900px]:hidden text-[13px] font-semibold text-indigo-600 hover:text-indigo-800">+ New note</button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin px-4 pb-6 space-y-2 min-h-[200px]">
          {!loaded && <div className="text-center text-stone-400 text-sm py-10">Loading…</div>}
          {loaded && total===0 && (
            <div className="text-center py-14 px-6 bg-white rounded-2xl border border-dashed border-stone-300">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 text-indigo-500 grid place-items-center mb-3">
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </div>
              <p className="font-bold text-stone-800">No notes yet</p>
              <p className="text-sm text-stone-500 mt-1 mb-4">Create your first note to get started</p>
              <button onClick={createNote} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 active:scale-95 transition">New note</button>
            </div>
          )}
          {loaded && total>0 && filtered.length===0 && (
            <div className="text-center py-14 px-6 bg-white rounded-2xl border border-stone-200">
              <p className="font-semibold text-stone-700">No notes match “{search.trim()}”</p>
              <p className="text-sm text-stone-500 mt-1 mb-4">Try a different search term</p>
              <button onClick={()=> setSearch("")} className="px-4 py-2 rounded-xl bg-stone-900 text-white text-sm font-semibold hover:bg-stone-700 transition">Clear search</button>
            </div>
          )}
          {pinnedList.length>0 && (
            <React.Fragment>
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-stone-400 pt-2">Pinned</h2>
              {pinnedList.map(renderNoteRow)}
            </React.Fragment>
          )}
          {(hasPinned ? unpinnedList.length>0 : filtered.length>0) && hasPinned && (
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-stone-400 pt-3">All notes</h2>
          )}
          {unpinnedList.map(renderNoteRow)}
          <p className="text-center text-[11px] text-stone-400 pt-4 hidden min-[900px]:block">Ctrl+N new · Ctrl+F search · Esc close</p>
        </div>
      </aside>

      {/* RIGHT DESKTOP EDITOR */}
      <main className="hidden min-[900px]:flex flex-1 flex-col min-h-0 bg-white min-[900px]:h-full">
        {!activeNote ? (
          <div className="flex-1 grid place-items-center p-10">
            <div className="text-center max-w-sm">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 text-indigo-500 grid place-items-center mb-4">
                <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </div>
              <p className="text-lg font-bold text-stone-800">Select a note or create a new one</p>
              <p className="text-sm text-stone-500 mt-1 mb-5">Your notes save automatically as you type. No account needed.</p>
              <button onClick={createNote} className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 active:scale-95 transition shadow-sm">New note</button>
            </div>
          </div>
        ) : (
          <React.Fragment>
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-stone-200 bg-white">
              <div className="text-[13px] text-stone-500 truncate">Editing · <span className="font-semibold text-stone-700">{displayTitleOf(activeNote)}</span></div>
              {editorTopButtons(false)}
            </div>
            {editorBody("desktop")}
          </React.Fragment>
        )}
      </main>

      {/* MOBILE FULLSCREEN OVERLAY */}
      {activeNote && (
        <div className="fixed inset-0 z-30 bg-white flex flex-col min-[900px]:hidden fade-in" role="dialog" aria-label="Note editor">
          <div className="flex items-center justify-between px-2 py-2 border-b border-stone-200 bg-white">
            <button onClick={()=> setActiveNoteId(null)} aria-label="Back to notes" className="p-2 rounded-lg text-stone-700 hover:bg-stone-100 active:scale-95 transition flex items-center gap-1">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            {editorTopButtons(true)}
          </div>
          {editorBody("mobile")}
        </div>
      )}

      {/* DELETE MODAL */}
      {showDelete && activeNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="del-title">
          <div className="absolute inset-0 bg-stone-900/50" onClick={()=> setShowDelete(false)}></div>
          <div ref={modalBoxRef} onKeyDown={onModalKeyDown} className="relative bg-white rounded-2xl shadow-2xl p-5 w-full min-[900px]:w-[360px] max-w-[420px] fade-in">
            <h2 id="del-title" className="text-[17px] font-bold text-stone-900">Delete this note?</h2>
            <p className="text-sm text-stone-600 mt-1.5">This cannot be undone. <span className="font-medium text-stone-800">“{displayTitleOf(activeNote)}”</span> will be permanently removed.</p>
            <div className="flex gap-2 mt-5">
              <button ref={modalCancelRef} onClick={()=> setShowDelete(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition">Cancel</button>
              <button onClick={doDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 active:scale-95 transition">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
