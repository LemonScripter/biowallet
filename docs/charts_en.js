const LABELS = ['Key storage','Host compromise','TX substitution','Replay','User error','Phishing / SE','Silent theft','Coercion'];
const DATA = { bio:[4,4,4,4,4,4,4,1], ledger:[4,4,4,3,2,4,4,1], trezor:[4,4,4,3,2,4,4,1], meta:[2,1,1,1,1,2,1,1] };
const C = { bio:{b:'#6c63ff',bg:'rgba(108,99,255,0.15)'}, ledger:{b:'#00b4d8',bg:'rgba(0,180,216,0.10)'},
            trezor:{b:'#00c896',bg:'transparent'}, meta:{b:'#f6851b',bg:'rgba(246,133,27,0.10)'} };
const font = { family:"'Segoe UI',system-ui,sans-serif", size:11 };
Chart.defaults.color='#9090b0'; Chart.defaults.font=font;

new Chart(document.getElementById('radarChart'),{type:'radar',data:{labels:LABELS,datasets:[
  {label:'BioWallet',data:DATA.bio,   borderColor:C.bio.b,   backgroundColor:C.bio.bg,   borderWidth:2.5,pointRadius:4},
  {label:'MetaMask', data:DATA.meta,  borderColor:C.meta.b,  backgroundColor:C.meta.bg,  borderWidth:2,  pointRadius:3},
  {label:'Ledger',   data:DATA.ledger,borderColor:C.ledger.b,backgroundColor:C.ledger.bg,borderWidth:2,  pointRadius:3},
  {label:'Trezor',   data:DATA.trezor,borderColor:C.trezor.b,backgroundColor:C.trezor.bg,fill:false,     borderWidth:2.5,pointRadius:3,borderDash:[7,4]},
]},options:{scales:{r:{min:0,max:4,ticks:{stepSize:1,backdropColor:'transparent',font:{size:10}},
  grid:{color:'rgba(255,255,255,0.07)'},angleLines:{color:'rgba(255,255,255,0.07)'},
  pointLabels:{font:{size:11},color:'#c0c0e0'}}},plugins:{legend:{labels:{font,boxWidth:12,padding:16}}}}});

new Chart(document.getElementById('barBioMeta'),{type:'bar',data:{
  labels:LABELS.map(l=>l.length>14?l.slice(0,13)+'…':l),
  datasets:[{label:'BioWallet',data:DATA.bio,backgroundColor:C.bio.b,borderRadius:4},
            {label:'MetaMask', data:DATA.meta,backgroundColor:C.meta.b,borderRadius:4}]},
  options:{scales:{y:{min:0,max:4,ticks:{stepSize:1},grid:{color:'rgba(255,255,255,0.05)'}},
    x:{grid:{display:false},ticks:{font:{size:10}}}},plugins:{legend:{labels:{font,boxWidth:12}}}}});

new Chart(document.getElementById('barBioHW'),{type:'bar',data:{
  labels:LABELS.map(l=>l.length>14?l.slice(0,13)+'…':l),
  datasets:[{label:'BioWallet',data:DATA.bio,   backgroundColor:C.bio.b,   borderRadius:4},
            {label:'Ledger',   data:DATA.ledger,backgroundColor:C.ledger.b,borderRadius:4},
            {label:'Trezor',   data:DATA.trezor,backgroundColor:C.trezor.b,borderRadius:4}]},
  options:{scales:{y:{min:0,max:4,ticks:{stepSize:1},grid:{color:'rgba(255,255,255,0.05)'}},
    x:{grid:{display:false},ticks:{font:{size:10}}}},plugins:{legend:{labels:{font,boxWidth:12}}}}});

const avg=d=>(d.reduce((a,b)=>a+b,0)/d.length).toFixed(2);
new Chart(document.getElementById('barAvg'),{type:'bar',data:{
  labels:['BioWallet','Ledger','Trezor','MetaMask'],
  datasets:[{label:'Average score (max 4)',
    data:[avg(DATA.bio),avg(DATA.ledger),avg(DATA.trezor),avg(DATA.meta)],
    backgroundColor:[C.bio.b,C.ledger.b,C.trezor.b,C.meta.b],borderRadius:6}]},
  options:{indexAxis:'y',scales:{x:{min:0,max:4,ticks:{stepSize:0.5},grid:{color:'rgba(255,255,255,0.05)'}},
    y:{grid:{display:false}}},plugins:{legend:{display:false}}}});
