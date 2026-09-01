const episodeData = {
  14: {
    index:'Ep 14',
    name:'Inspect folder and summarize structure',
    meta:'3m 42s · 14 tools · complete',
    prompt:'Quickly inspect this folder, read a few files, and summarize the structure.',
    stats:'6 turns · 14 tools · 2 messages · 1 retry',
    tools:'14 tools',
    lead:'I inspected the folder and read the key files. Here is the concise structure:',
    tree:`~/Documents/Codex
├── .agents/
├── .codex/
├── .git/
├── outputs/
└── work/`,
    bullets:[
      'No regular files exist in the root.',
      'All subdirectories are present but mostly empty.',
      '<code>.git</code> contains repository metadata.',
      '<code>outputs/</code> and <code>work/</code> are placeholders for generated artifacts.'
    ]
  },
  15: {
    index:'Ep 15',
    name:'Create README',
    meta:'5m 03s · 9 tools · complete',
    prompt:'Create a concise README using the folder structure we just inspected.',
    stats:'4 turns · 9 tools · 1 message · no retries',
    tools:'9 tools',
    lead:'README created with project purpose, structure, setup notes, and a small next-steps section.',
    tree:`README.md
├── Overview
├── Structure
├── Getting started
└── Next steps`,
    bullets:[
      'Kept the README intentionally short.',
      'Documented the repository layout from the previous episode.',
      'Avoided inventing commands that are not present in the repository.',
      'Left CI setup as the next episode.'
    ]
  }
};

function setEpisode(id){
  const d = episodeData[id];
  if(!d) return;
  document.getElementById('episodeIndex').textContent=d.index;
  document.getElementById('episodeName').textContent=d.name;
  document.getElementById('episodeMeta').textContent=d.meta;
  document.getElementById('promptText').textContent=d.prompt;
  document.getElementById('activityStats').textContent=d.stats;
  document.getElementById('toolBadge').textContent=d.tools;
  document.getElementById('responseLead').textContent=d.lead;
  document.getElementById('treeBlock').textContent=d.tree;
  document.getElementById('summaryList').innerHTML=d.bullets.map(x=>`<li>${x}</li>`).join('');

  document.querySelectorAll('[data-episode]').forEach(el=>{
    el.classList.toggle('active', String(el.dataset.episode)===String(id));
  });
  document.getElementById('cardsView').classList.remove('active');
}

document.querySelectorAll('[data-episode]').forEach(el=>{
  el.addEventListener('click',()=>setEpisode(el.dataset.episode));
});

document.getElementById('zoomOut').addEventListener('click',()=>{
  document.getElementById('cardsView').classList.add('active');
});
document.getElementById('zoomIn').addEventListener('click',()=>{
  document.getElementById('cardsView').classList.remove('active');
});
document.getElementById('activityToggle').addEventListener('click',()=>{
  const detail=document.getElementById('activityDetail');
  detail.classList.toggle('open');
  document.getElementById('activityArrow').textContent=detail.classList.contains('open')?'⌃':'⌄';
});
