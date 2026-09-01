const modes=["compressed","normal","expanded"];
let modeIndex=0;

const episodes={
  1:{
    heading:"Ep 1 · Recover work state",
    meta:"1m 03s · settled",
    user:"Recover the interrupted extension task, verify current state, then continue the writer.",
    summary:"6 turns · 8 tools · 1 message",
    agent:"Recovered the task and resumed the existing worker. The durable bead, branch, and prior commit were intact; the review had identified missing contract requirements rather than a runtime failure.",
    block:"active task   unitAI-xoum6\\nbranch        agent/pi/unitAI-xoum6-readme\\ncommit        1f81d357\\nnext          writer → review → validation"
  },
  2:{
    heading:"Ep 2 · Review extension contract",
    meta:"2m 16s · settled",
    user:"Review the xtrm-ui renderer contract and find what can become native in our own Pi shell.",
    summary:"4 turns · 12 tools · 0 retries",
    agent:"The existing xtrm-ui is already more than a theme. It owns the custom editor, header, thinking presentation, native tool renderers, external tool frames, and persisted UI preferences. We should extract those renderer primitives and make the extension adapter thin.",
    block:"reuse          tool renderers · thinking row · theme · editor\\nchange         boolean expanded → tri-state view\\nnew shell      EpisodeViewport + overlays\\navoid          hard fork of Pi interactive mode"
  },
  3:{
    heading:"Ep 3 · Implement renderer",
    meta:"live · 5 tools",
    user:"Implement the first tri-state tool display and episode navigation.",
    summary:"3 turns · 5 tools · running",
    agent:"Implementation is active. The compressed mode renders only the action, subject, status/count, duration, and payload size; normal keeps bounded previews; expanded exposes the complete renderable result.",
    block:"Ctrl+O   compressed → normal → expanded\\nCtrl+E   episode overview overlay\\nCtrl+B   branch tree overlay"
  }
};

function setMode(next){
  modeIndex=next;
  const m=modes[modeIndex];
  document.body.dataset.toolview=m;
  document.getElementById("toolViewText").textContent=m;
  document.getElementById("viewLabel").textContent=m;
}
function cycleMode(){ setMode((modeIndex+1)%modes.length); }

function setEpisode(id){
  const e=episodes[id]; if(!e)return;
  document.getElementById("episodeHeading").textContent=e.heading;
  document.getElementById("episodeMeta").textContent=e.meta;
  document.getElementById("userText").textContent=e.user;
  document.getElementById("activitySummary").textContent=e.summary;
  document.getElementById("agentText").textContent=e.agent;
  document.getElementById("agentBlock").textContent=e.block;
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.episode==id));
  document.querySelectorAll(".card[data-card]").forEach(x=>x.classList.toggle("active",x.dataset.card==id));
  document.getElementById("overlay").classList.remove("open");
}

document.querySelectorAll(".tab").forEach(el=>el.addEventListener("click",()=>setEpisode(el.dataset.episode)));
document.querySelectorAll(".card[data-card]").forEach(el=>el.addEventListener("click",()=>setEpisode(el.dataset.card)));

const overlay=document.getElementById("overlay");
document.getElementById("episodesBtn").onclick=()=>overlay.classList.add("open");
document.getElementById("closeBtn").onclick=()=>overlay.classList.remove("open");
document.getElementById("treeBtn").onclick=()=>document.getElementById("tree").classList.toggle("open");

document.addEventListener("keydown",(e)=>{
  if(e.ctrlKey && e.key.toLowerCase()==="o"){e.preventDefault();cycleMode();}
  if(e.ctrlKey && e.key.toLowerCase()==="e"){e.preventDefault();overlay.classList.toggle("open");}
  if(e.ctrlKey && e.key.toLowerCase()==="b"){e.preventDefault();overlay.classList.add("open");document.getElementById("tree").classList.add("open");}
  if(e.key==="Escape"){overlay.classList.remove("open");}
});
