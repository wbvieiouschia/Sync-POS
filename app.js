"use strict";
// DB is provided by firebase-db.js (loaded before this script in index.html)
// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
const S = {
  user:null, orderItems:[], orderMeta:null, discount:0,
  activeCat:'all', products:[], addons:[], npmState:{cat:'Coffee & Espresso',sv:'BOTH',addons:[],recipe:[]},
  pmState:{cat:'Coffee & Espresso',storage:'fresh',recipe:[]},
};

// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
const peso = n => `₱ ${Number(n||0).toFixed(2)}`;
const isAdmin = () => S.user?.role==='admin'||S.user?.admin_access;
function showToast(msg,type='info',dur=3000){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`toast toast-${type} show`;
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),dur);
}
function confirm(title,msg){ return new Promise(res=>{
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-message').textContent=msg;
  openModal('modal-confirm');
  const ok=document.getElementById('btn-confirm-ok');
  const ca=document.getElementById('btn-confirm-cancel');
  const done=v=>{ closeModal('modal-confirm'); ok.onclick=null; ca.onclick=null; res(v); };
  ok.onclick=()=>done(true); ca.onclick=()=>done(false);
}); }
function openModal(id){ closeCatPopover(); const d=document.getElementById(id); d?.showModal?.(); const mb=document.getElementById('modal-backdrop'); if(mb) mb.hidden=false; }
function closeModal(id){ if(id==='cat-edit-popover'){ closeCatPopover(); return; } const d=document.getElementById(id); d?.close?.(); const any=[...document.querySelectorAll('dialog')].filter(x=>x.id!=='cat-edit-popover').some(x=>x.open); const mb=document.getElementById('modal-backdrop'); if(mb && !any) mb.hidden=true; }
function showScreen(id){ document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active');s.style.display='';s.style.opacity='';}); document.getElementById(id).classList.add('active'); }
function showPage(k){ document.querySelectorAll('.page').forEach(p=>{p.hidden=true;p.classList.remove('active')}); const p=document.querySelector(`.page[data-page="${k}"]`); if(p){p.hidden=false;p.classList.add('active');} document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===k)); }
function catMatch(p,k){
  const c=(p.category||'').toLowerCase();
  if(k==='all') return true;
  if(k==='coffee') return c.includes('coffee')||c.includes('espresso');
  if(k==='matcha') return c.includes('matcha');
  if(k==='milktea') return c.includes('milktea')||c.includes('milk tea');
  if(k==='food') return c.includes('food')||c.includes('pastry')||c.includes('rice');
  if(k==='premade') return c.includes('pre made')||c.includes('premade');
  return true;
}
function stockLevel(cur,max){ const p=max>0?(cur/max)*100:0; if(p>=60)return{label:'OK',cls:'level-ok'}; if(p>=25)return{label:'Low',cls:'level-low'}; return{label:'Critical',cls:'level-crit'}; }
function deductRecipeFromInventory(recipe, multiplier){
  if(!recipe||!recipe.length) return;
  multiplier=parseFloat(multiplier)||1;
  const inv=DB.get('inventory');
  recipe.forEach(r=>{
    const sid=r.stockId||r.id;
    const idx=inv.findIndex(s=>s.id===sid);
    if(idx!==-1) inv[idx].current_qty=Math.max(0,(parseFloat(inv[idx].current_qty)||0)-(parseFloat(r.qty)*multiplier));
  });
  DB.set('inventory',inv);
}
function mergeStocks(stocks){
  const map=new Map();
  stocks.forEach(s=>{
    const k=`${(s.name||'').toLowerCase()}__${s.expiry_date||'none'}`;
    if(map.has(k)){const e=map.get(k);e.current_qty+=parseFloat(s.current_qty)||0;e.max_qty=Math.max(e.max_qty,parseFloat(s.max_qty)||0);e._ids.push(s.id);}
    else map.set(k,{...s,current_qty:parseFloat(s.current_qty)||0,max_qty:parseFloat(s.max_qty)||0,_ids:[s.id]});
  });
  return [...map.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
}


// Expose S on window so db-server.js can set S.user during session restore
window.S = S;



(function tick(){
  const el=document.getElementById('login-shift-time'); if(!el) return;
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  function up(){ const n=new Date(); let h=n.getHours(),m=n.getMinutes(); const ap=h>=12?'PM':'AM'; h=h%12||12; el.textContent=`${days[n.getDay()]} ${h}:${String(m).padStart(2,'0')} ${ap}`; }
  up(); setInterval(up,30000);
})();

// ═══════════════════════════════════════════════════
//  TEMPORARY / DEMO ACCOUNTS
//  email + password used in Step 1
//  account_id + pin used in Step 2
// ═══════════════════════════════════════════════════
const TEMP_ACCOUNTS = [
  {
    email: 'staff@26thcafe.com',
    password: 'staff123',
    account_id: 'STF-TEMP',
    pin: '111111',
    name: 'Temp Staff',
    role: 'staff',
    admin_access: false,
  },
  {
    email: 'admin@26thcafe.com',
    password: 'admin2025',
    account_id: 'MGR-ADMIN',
    pin: '000000',
    name: 'Admin',
    role: 'admin',
    admin_access: true,
  },
];

// Holds the user matched in Step 1 until Step 2 confirms
window._loginStep1User = null;

// Role toggle (Step 2 only)
document.querySelector('.login-role-toggle')?.addEventListener('click',e=>{
  const t=e.target.closest('.role-tab'); if(!t) return;
  document.querySelectorAll('.role-tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
  document.getElementById('account-id').placeholder=t.dataset.role==='admin'?'MGR-0001':'STF-0001';
});

function showForgotHint(e){
  e.preventDefault();
  const users=(typeof DB!=='undefined')?DB.get('users'):[];
  const mgrs=users.filter(u=>u.role_type==='manager'&&u.email);
  if(mgrs.length){
    const emails=mgrs.map(u=>u.email).join(', ');
    showToast(`Contact a Manager to reset your PIN. Manager email(s): ${emails}`,'info',8000);
  } else {
    showToast('Contact your Admin/Manager to reset your PIN.','info',5000);
  }
}

// ─── Step indicator helpers ───────────────────────
function setLoginStep(step){
  const s1=document.getElementById('login-step-1');
  const s2=document.getElementById('login-step-2');
  const c1=document.getElementById('step-circle-1');
  const c2=document.getElementById('step-circle-2');
  const conn=document.getElementById('step-connector');
  if(step===1){
    s1.hidden=false; s2.hidden=true;
    c1.className='step-circle active'; c1.textContent='1';
    c2.className='step-circle'; c2.textContent='2';
    conn.classList.remove('active');
    document.getElementById('login-error-1').hidden=true;
  } else {
    s1.hidden=true; s2.hidden=false;
    c1.className='step-circle done'; c1.textContent='✓';
    c2.className='step-circle active'; c2.textContent='2';
    conn.classList.add('active');
    document.getElementById('login-error').hidden=true;
    document.getElementById('account-id').value='';
    document.getElementById('pin').value='';
    // Pre-fill account ID if we know the user
    if(window._loginStep1User && window._loginStep1User.account_id){
      document.getElementById('account-id').value=window._loginStep1User.account_id;
    }
    setTimeout(()=>{ const el=document.getElementById('account-id'); if(!el.value) el.focus(); else document.getElementById('pin').focus(); },50);
  }
}

// ─── STEP 1: password only ────────────────────────
document.getElementById('btn-login-next')?.addEventListener('click',()=>{
  const password=(document.getElementById('password').value||'').trim();
  const errEl=document.getElementById('login-error-1');
  errEl.hidden=true;

  if(!password){
    errEl.textContent='⚠️ Please enter your password.';
    errEl.hidden=false; return;
  }

  // Check temp accounts first
  let found=TEMP_ACCOUNTS.find(u=>u.password===password);

  // Then check DB users (password field or pin as fallback)
  if(!found && typeof DB!=='undefined'){
    const dbUsers=DB.get('users');
    found=dbUsers.find(u=>{
      return (u.password && u.password===password) || (!u.password && u.pin===password);
    });
  }

  if(!found){
    errEl.textContent='⚠️ Incorrect password. Please try again.';
    errEl.hidden=false; return;
  }

  window._loginStep1User=found;
  const greet=document.getElementById('step2-greeting-name');
  greet.textContent=`Welcome back, ${found.name}!`;
  setLoginStep(2);
});

// ─── Back button ──────────────────────────────────
document.getElementById('btn-login-back')?.addEventListener('click',()=>{
  window._loginStep1User=null;
  setLoginStep(1);
});

// ═══════════════════════════════════════════════════
//  LOGIN – STEP 2: Account ID + PIN
// ═══════════════════════════════════════════════════
document.getElementById('login-form')?.addEventListener('submit',e=>{
  e.preventDefault();
  if(document.getElementById('login-step-2').hidden) return; // guard: only run on step 2

  const id=document.getElementById('account-id').value.trim();
  const pin=document.getElementById('pin').value.trim();
  const errEl=document.getElementById('login-error');
  errEl.hidden=true;

  if(!id || !pin){
    errEl.textContent='⚠️ Please enter your Account ID and PIN.';
    errEl.hidden=false; return;
  }

  const step1User=window._loginStep1User;

  // Verify account_id + pin matches the user authenticated in Step 1
  let user=null;
  if(step1User){
    const idOk=step1User.account_id===id;
    const pinOk=step1User.pin===pin;
    if(idOk && pinOk) user=step1User;
  }

  // Fallback: also search DB (in case step1User is a shell/preview object)
  if(!user && typeof DB!=='undefined'){
    const dbUsers=DB.get('users');
    const dbMatch=dbUsers.find(u=>u.account_id===id && u.pin===pin);
    // Must also match the email from step 1
    if(dbMatch && step1User && dbMatch.email && dbMatch.email.toLowerCase()===(step1User.email||'').toLowerCase()){
      user=dbMatch;
    } else if(dbMatch && !step1User){
      user=dbMatch;
    }
  }

  if(!user){
    errEl.textContent='⚠️ Invalid Account ID or PIN. Please try again.';
    errEl.hidden=false; return;
  }

  S.user=user;
  // Persist session locally so page refresh restores login
  try { localStorage.setItem('syncpos_session', JSON.stringify({account_id:user.account_id,pin:user.pin})); } catch(_){}
  window._loginStep1User=null;
  // Record every login as a new attendance entry
  const _today=todayStr();
  try {
    DB.push('attendance',{id:DB.uid(),account_id:S.user.account_id,name:S.user.name,date:_today,clock_in:nowTime(),clock_out:null});
    DB.push('system_log',{id:DB.uid(),account_id:S.user.account_id,name:S.user.name,date:_today,sign_in:nowTime(),sign_out:null});
  } catch(_){}
  initPOS();
  showScreen('screen-pos');
});

// ═══════════════════════════════════════════════════
//  INIT POS
// ═══════════════════════════════════════════════════
function initPOS(){
  document.getElementById('staff-name').textContent=S.user.name;
  document.getElementById('staff-role').textContent=S.user.role.charAt(0).toUpperCase()+S.user.role.slice(1);
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=isAdmin()?'':'none');
  document.getElementById('profile-name-text').textContent=S.user.name;
  document.getElementById('profile-role-badge').textContent=S.user.role;
  document.getElementById('profile-id-text').textContent=S.user.account_id;
  const _nameInp = document.getElementById('profile-display-name');
  if(_nameInp) _nameInp.value = S.user.name;
  S.products=DB.get('products');
  S.addons=DB.get('addons');
  navigateTo('order');
}

// ═══════════════════════════════════════════════════
//  NAV
// ═══════════════════════════════════════════════════
document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>navigateTo(b.dataset.page)));
function navigateTo(page){ closeCatPopover();
  showPage(page);
  if(page==='order') renderOrderSetup();
  else if(page==='inventory') loadInventory();
  else if(page==='stocks') loadStocksPage();
  else if(page==='waste') loadWaste();
  else if(page==='sales') loadSales();
  else if(page==='sales-performance') loadSalesPerformance();
  else if(page==='expenses') renderExpenses();
  else if(page==='attendance') renderAttendance();
  else if(page==='profile'){
    const nameInput = document.getElementById('profile-display-name');
    if(nameInput) nameInput.value = S.user?.name || '';
  }
  else if(page==='edit-items') loadEditItems('all');
  else if(page==='premade-stock') loadPremade();
  else if(page==='manage-staff') loadStaff();
}

// ═══════════════════════════════════════════════════
//  ORDER TAB
// ═══════════════════════════════════════════════════
const OT={codeAlpha:'',codeNum:'',queue:'',type:null,discType:null,discAmt:0,seniorAmt:20,pwdAmt:20,customs:[],convFee:0};
OT.gen=()=>{
  const L=()=>[...Array(4)].map(()=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random()*26)]).join('');
  OT.codeAlpha=L().slice(0,2)+L().slice(2,4)+String(Math.floor(Math.random()*90)+10);
  OT.codeNum=String(Math.floor(Math.random()*900000)+100000);
  const RL=()=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random()*26)];
  OT.queue=RL()+RL()+String(Math.floor(Math.random()*9000)+1000);
};
OT.reset=()=>{OT.gen();OT.type=null;OT.discType=null;OT.discAmt=0;OT.customs=[];OT.convFee=0;};
OT.totalDisc=()=>OT.discAmt+OT.customs.reduce((s,d)=>s+d.amount,0);

function renderOrderSetup(){
  document.getElementById('order-setup').style.display='';
  document.getElementById('order-grid-view').hidden=true;
  document.getElementById('order-panel').hidden=true;
  resetOrder(); OT.reset(); renderOT();
}
function renderOT(){
  document.getElementById('ot-code-alpha').textContent=OT.codeAlpha;
  document.getElementById('ot-code-num').textContent=OT.codeNum;
  document.getElementById('ot-queue').textContent=OT.queue;
  document.getElementById('ot-cashier').textContent=`${S.user.account_id}  ${S.user.name}`;
  OT.seniorAmt=parseFloat(DB.get('disc_senior','20')||20);
  OT.pwdAmt=parseFloat(DB.get('disc_pwd','20')||20);
  document.getElementById('disc-senior-amt').textContent=OT.seniorAmt.toFixed(2);
  document.getElementById('disc-pwd-amt').textContent=OT.pwdAmt.toFixed(2);
  refreshDiscTiles(); refreshTypeBtns();
  const addBtn=document.getElementById('btn-add-discount');
  if(addBtn) addBtn.style.display=isAdmin()?'':'none';
}
function refreshDiscTiles(){
  document.getElementById('disc-senior').classList.toggle('active',OT.discType==='senior');
  document.getElementById('disc-pwd').classList.toggle('active',OT.discType==='pwd');
  const cc=document.getElementById('ot-custom-disc-tiles'); cc.innerHTML='';
  OT.customs.forEach((d,i)=>{
    const t=document.createElement('button'); t.className='ot-disc-tile active';
    t.innerHTML=`<span class="ot-disc-name">${d.label}</span><span class="ot-disc-amt">${d.amount.toFixed(2)}</span>${isAdmin()?`<button class="disc-remove-x" data-i="${i}">✕</button>`:''}`;
    t.addEventListener('click',e=>{const x=e.target.closest('.disc-remove-x');if(x){OT.customs.splice(+x.dataset.i,1);refreshDiscTiles();}});
    cc.appendChild(t);
  });
}
function refreshTypeBtns(){ document.querySelectorAll('.ot-type-btn').forEach(b=>b.classList.toggle('active',b.dataset.type===OT.type)); }

document.getElementById('disc-senior').addEventListener('click',()=>{OT.discType=OT.discType==='senior'?null:'senior';OT.discAmt=OT.discType?OT.seniorAmt:0;refreshDiscTiles();});
document.getElementById('disc-pwd').addEventListener('click',()=>{OT.discType=OT.discType==='pwd'?null:'pwd';OT.discAmt=OT.discType?OT.pwdAmt:0;refreshDiscTiles();});
document.getElementById('btn-add-discount').addEventListener('click',()=>{document.getElementById('ot-custom-disc-input').hidden=false;});
document.getElementById('btn-save-custom-disc').addEventListener('click',()=>{
  const label=document.getElementById('custom-disc-label').value.trim()||'Discount';
  const amount=parseFloat(document.getElementById('custom-disc-amount').value)||0;
  if(amount<=0){showToast('Enter a valid amount.','error');return;}
  OT.customs.push({label,amount});
  document.getElementById('ot-custom-disc-input').hidden=true;
  refreshDiscTiles(); showToast(`"${label}" discount added.`,'success');
});
document.getElementById('btn-cancel-custom-disc').addEventListener('click',()=>document.getElementById('ot-custom-disc-input').hidden=true);
document.querySelectorAll('.ot-type-btn').forEach(b=>b.addEventListener('click',()=>{OT.type=b.dataset.type;OT.convFee=OT.type==='online'?1:0;refreshTypeBtns();}));

document.getElementById('btn-start-order').addEventListener('click',()=>{
  if(!OT.type){showToast('Please select an order type first.','error');return;}
  const labels={dine_in:'Dine-In',takeout:'Takeout',online:'Online Order'};
  S.orderMeta={orderCodeAlpha:OT.codeAlpha,orderCodeNum:OT.codeNum,orderQueue:OT.queue,cashier:S.user.name,cashierId:S.user.account_id,orderType:OT.type,discountType:OT.discType,discountAmount:OT.discAmt,customDiscounts:[...OT.customs],totalDiscount:OT.totalDisc(),convFee:OT.convFee};
  S.discount=OT.totalDisc();
  document.getElementById('order-meta-label').textContent=`${labels[OT.type]} · #${OT.codeAlpha}`;
  document.getElementById('order-setup').style.display='none';
  document.getElementById('order-grid-view').hidden=false;
  document.getElementById('order-panel').hidden=false;
  S.products=DB.get('products'); S.addons=DB.get('addons');
  renderProductGrid();
});

// ═══════════════════════════════════════════════════
//  PRODUCT GRID
// ═══════════════════════════════════════════════════
function getPremadeFreshnessLabel(p){
  if((p.storage_type||'fresh')==='safe') return {cls:'pm-order-badge-stored',text:'📦 Stored'};
  const h=(Date.now()-new Date(p.created_at||Date.now()).getTime())/36e5;
  if(h<24) return {cls:'pm-order-badge-fresh',text:'🌿 Fresh'};
  const days=Math.floor(h/24);
  if(days===1) return {cls:'pm-order-badge-dayold',text:'🟡 Day Old'};
  return {cls:'pm-order-badge-old',text:`🔴 ${days} Days Old`};
}
function getPremadeRemainingQty(p){
  const alreadyOrdered=S.orderItems.filter(i=>i.product_id===p.id).length;
  return Math.max(0,(p.batch_qty||0)-alreadyOrdered);
}
function renderProductGrid(cat=S.activeCat,search=''){
  const grid=document.getElementById('product-grid'); grid.innerHTML='';
  const filtered=S.products.filter(p=>catMatch(p,cat)&&(!search||p.name.toLowerCase().includes(search.toLowerCase())));
  if(!filtered.length){grid.innerHTML='<p class="empty-state">No products found.</p>';return;}
  filtered.forEach(p=>{
    const isPremade=(p.category||'').toLowerCase().includes('pre made');
    const card=document.createElement('button'); card.className='product-card';
    if(isPremade){
      const f=getPremadeFreshnessLabel(p);
      const remaining=getPremadeRemainingQty(p);
      const limitReached=remaining<=0;
      if(limitReached) card.classList.add('product-card-limit');
      card.disabled=limitReached;
      card.innerHTML=`
        <span class="pm-order-freshness-badge ${f.cls}">${f.text}</span>
        <span class="product-emoji">${p.emoji||'🥤'}</span>
        <span class="product-name">${p.name}</span>
        <span class="product-price">${peso(p.base_price)}</span>
        <span class="pm-order-stock-row">
          ${limitReached
            ? `<span class="pm-order-limit-label">⛔ Limit Reached</span>`
            : `<span class="pm-order-stock-count">${remaining} left</span>`}
        </span>`;
    } else {
      card.innerHTML=`<span class="product-emoji">${p.emoji||'☕'}</span><span class="product-name">${p.name}</span><span class="product-price">${peso(p.base_price)}</span>`;
    }
    card.addEventListener('click',()=>{ if(!card.disabled) openVariantPicker(p); });
    grid.appendChild(card);
  });
}
document.getElementById('order-cat-tabs').addEventListener('click',e=>{
  const t=e.target.closest('.cat-tab'); if(!t) return;
  document.querySelectorAll('#order-cat-tabs .cat-tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
  S.activeCat=t.dataset.cat; renderProductGrid(S.activeCat,document.getElementById('product-search').value.trim());
});
document.getElementById('product-search').addEventListener('input',e=>renderProductGrid(S.activeCat,e.target.value.trim()));

// ═══════════════════════════════════════════════════
//  VARIANT PICKER
// ═══════════════════════════════════════════════════
let _pp=null, _pq=1;
function openVariantPicker(p){
  _pp=p; _pq=1;
  document.getElementById('picker-emoji').textContent=p.emoji||'☕';
  document.getElementById('picker-product-name').textContent=p.name;
  document.getElementById('picker-base-price').textContent=peso(p.base_price);
  document.getElementById('qty-display').value='1';
  // Temperature
  const ts=document.getElementById('picker-temp-section'), to=document.getElementById('picker-temp-options');
  if(p.has_temperature){
    const temps=p.serving_var==='HOT'?['HOT']:p.serving_var==='ICED'?['ICED']:['HOT','ICED'];
    to.innerHTML=temps.map(t=>`<label class="picker-chip"><input type="radio" name="temp" value="${t}"/><span>${t==='HOT'?'🔥 Hot':'🧊 Iced'}</span></label>`).join('');
    if(temps.length===1) to.querySelector('input').checked=true;
    ts.hidden=false;
  }else{ts.hidden=true;}
  // Size
  const ss=document.getElementById('picker-size-section'), so=document.getElementById('picker-size-options');
  if(p.has_size&&p.sizes_enabled?.length){
    so.innerHTML=p.sizes_enabled.map((s,i)=>{const add=i===0?0:(s==='MEDIUM'?p.medium_add:p.large_add)||0;return`<label class="picker-chip"><input type="radio" name="psize" value="${s}" data-add="${add}"/><span>${s}${add>0?' +₱'+add:''}</span></label>`}).join('');
    if(p.sizes_enabled.length===1) so.querySelector('input').checked=true;
    ss.hidden=false;
  }else{ss.hidden=true;}
  // Addons
  const as=document.getElementById('picker-addon-section'), ao=document.getElementById('picker-addon-options');
  if(p.has_addon&&S.addons.length){
    ao.innerHTML=S.addons.map(a=>`<label class="picker-chip"><input type="checkbox" name="addon" value="${a.id}" data-name="${a.name}" data-price="${a.price}"/><span>${a.emoji||'⭐'} ${a.name} +${peso(a.price)}</span></label>`).join('');
    document.getElementById('addon-toggle').checked=true;
    ao.style.maxHeight=''; ao.style.opacity=''; ao.style.pointerEvents='';
    as.hidden=false;
  }else{as.hidden=true;}
  updatePickerTotal(); openModal('modal-variant-picker');
}
function getPickerPrice(){
  if(!_pp) return 0;
  const sizeEl=document.querySelector('input[name="psize"]:checked');
  const sizeAdd=sizeEl?parseFloat(sizeEl.dataset.add)||0:0;
  const addonToggle=document.getElementById('addon-toggle');
  const addonAdd=(addonToggle&&addonToggle.checked)?[...document.querySelectorAll('input[name="addon"]:checked')].reduce((s,el)=>s+(parseFloat(el.dataset.price)||0),0):0;
  return (_pp.base_price||0)+sizeAdd+addonAdd;
}
function updatePickerTotal(){ document.getElementById('picker-total').textContent=peso(getPickerPrice()*_pq); }
document.getElementById('qty-minus').addEventListener('click',()=>{if(_pq>1){_pq--;document.getElementById('qty-display').value=_pq;updatePickerTotal();}});
document.getElementById('qty-plus').addEventListener('click',()=>{
  const isPremade=_pp&&(_pp.category||'').toLowerCase().includes('pre made');
  if(isPremade){
    const remaining=getPremadeRemainingQty(_pp);
    if(_pq>=remaining){showToast(`Only ${remaining} left in stock.`,'error');return;}
  }
  _pq++;document.getElementById('qty-display').value=_pq;updatePickerTotal();
});
// Direct qty input
document.getElementById('qty-display').addEventListener('input',e=>{
  const isPremade=_pp&&(_pp.category||'').toLowerCase().includes('pre made');
  let val=parseInt(e.target.value)||1;
  if(val<1) val=1;
  if(isPremade){ const remaining=getPremadeRemainingQty(_pp); if(val>remaining){ val=remaining; showToast(`Only ${remaining} left in stock.`,'error'); } }
  _pq=val; e.target.value=val; updatePickerTotal();
});
document.getElementById('qty-display').addEventListener('focus',e=>e.target.select());
document.getElementById('qty-display').addEventListener('blur',e=>{ if(!e.target.value||parseInt(e.target.value)<1){ _pq=1; e.target.value=1; updatePickerTotal(); } });
document.addEventListener('change',e=>{
  if(['temp','psize','addon'].includes(e.target.name)) updatePickerTotal();
  if(e.target.id==='addon-toggle'){
    const ao=document.getElementById('picker-addon-options');
    const on=e.target.checked;
    ao.style.maxHeight=on?'':0; ao.style.opacity=on?'':0; ao.style.pointerEvents=on?'':'none';
    if(!on) document.querySelectorAll('input[name="addon"]').forEach(cb=>cb.checked=false);
    updatePickerTotal();
  }
});
document.getElementById('btn-add-to-order').addEventListener('click',()=>{
  if(!_pp) return;
  const tempEl=document.querySelector('input[name="temp"]:checked');
  const sizeEl=document.querySelector('input[name="psize"]:checked');
  const addonToggle=document.getElementById('addon-toggle');
  const addonEls=(addonToggle&&addonToggle.checked)?[...document.querySelectorAll('input[name="addon"]:checked')]:[];
  const addons=addonEls.map(el=>({name:el.dataset.name,price:parseFloat(el.dataset.price)||0}));
  if(_pp.has_temperature&&!tempEl){showToast('Please select a temperature.','error');return;}
  if(_pp.has_size&&_pp.sizes_enabled?.length>1&&!sizeEl){showToast('Please select a size.','error');return;}
  for(let i=0;i<_pq;i++) S.orderItems.push({product:_pp,name:_pp.name,temperature:tempEl?.value??null,size:sizeEl?.value??null,addons,price:getPickerPrice(),product_id:_pp.id});
  closeModal('modal-variant-picker');
  renderOrderPanel();
  renderProductGrid(S.activeCat,document.getElementById('product-search').value.trim());
  showToast(`${_pp.name} added.`,'success');
});

// ═══════════════════════════════════════════════════
//  ORDER PANEL
// ═══════════════════════════════════════════════════
function renderOrderPanel(){
  const list=document.getElementById('order-items-list');
  const empty=document.getElementById('order-empty-state');
  list.querySelectorAll('.order-item-row').forEach(r=>r.remove());
  if(!S.orderItems.length){empty.hidden=false;}
  else{
    empty.hidden=true;
    S.orderItems.forEach((item,idx)=>{
      const row=document.createElement('div'); row.className='order-item-row';
      const meta=[item.temperature,item.size,...(item.addons||[]).map(a=>a.name),(item.addon?.name)].filter(Boolean).join(' · ');
      row.innerHTML=`<div class="order-item-info"><span class="order-item-name">${item.name}</span>${meta?`<span class="order-item-meta">${meta}</span>`:''}</div><span class="order-item-price">${peso(item.price)}</span><button class="btn-icon" data-idx="${idx}" style="color:var(--text-muted)" title="Remove">✕</button>`;
      list.appendChild(row);
    });
  }
  const meta=S.orderMeta||{};
  const sub=S.orderItems.reduce((s,i)=>s+i.price,0);
  const td=meta.totalDiscount||0;
  const cf=meta.convFee||0;
  const total=Math.max(0,sub-td)+cf;
  document.getElementById('order-subtotal').textContent=peso(sub);
  document.getElementById('order-total').textContent=peso(total);
  document.getElementById('charge-total').textContent=peso(total);
  const dr=document.getElementById('discount-row');
  if(td>0){dr.hidden=false;document.getElementById('order-discount').textContent=`— ${peso(td)}`;}
  else dr.hidden=true;
  updateChange();
}
document.getElementById('order-items-list').addEventListener('click',e=>{
  const btn=e.target.closest('[data-idx]'); if(!btn) return;
  S.orderItems.splice(parseInt(btn.dataset.idx),1);
  renderOrderPanel();
  renderProductGrid(S.activeCat,document.getElementById('product-search').value.trim());
});
document.getElementById('cash-tendered').addEventListener('input',updateChange);
function updateChange(){
  const meta=S.orderMeta||{};
  const sub=S.orderItems.reduce((s,i)=>s+i.price,0);
  const total=Math.max(0,sub-(meta.totalDiscount||0))+(meta.convFee||0);
  const cash=parseFloat(document.getElementById('cash-tendered').value)||0;
  document.getElementById('order-change').textContent=peso(Math.max(0,cash-total));
}
document.querySelectorAll('.quick-cash').forEach(btn=>btn.addEventListener('click',()=>{
  const meta=S.orderMeta||{};
  const sub=S.orderItems.reduce((s,i)=>s+i.price,0);
  const total=Math.max(0,sub-(meta.totalDiscount||0))+(meta.convFee||0);
  const inp=document.getElementById('cash-tendered');
  inp.value=btn.dataset.amount==='exact'?total.toFixed(2):btn.dataset.amount;
  updateChange();
}));
document.getElementById('btn-void-order').addEventListener('click',async()=>{
  if(!S.orderItems.length){renderOrderSetup();return;}
  if(await confirm('Void Order','Are you sure you want to void this order?')) renderOrderSetup();
});
document.getElementById('btn-charge').addEventListener('click',async()=>{
  if(!S.orderItems.length){showToast('No items in order.','error');return;}
  const meta=S.orderMeta||{};
  const sub=S.orderItems.reduce((s,i)=>s+i.price,0);
  const td=meta.totalDiscount||0; const cf=meta.convFee||0;
  const total=Math.max(0,sub-td)+cf;
  const cash=parseFloat(document.getElementById('cash-tendered').value)||0;
  if(cash<total){showToast('Cash tendered is less than total.','error');return;}
  const sale={id:DB.uid(),order_id:meta.orderCodeAlpha||'',order_queue:meta.orderQueue||'',total,cash_tendered:cash,cashier_id:meta.cashierId,cashier_name:meta.cashier,order_type:meta.orderType,discount_type:meta.discountType,discount_amount:td,custom_discounts:meta.customDiscounts||[],conv_fee:cf,items:S.orderItems.map(i=>({name:i.name,temperature:i.temperature||null,size:i.size||null,addons:(i.addons&&i.addons.length?i.addons.map(a=>a.name):[]).concat(i.addon?.name?[i.addon.name]:[]),price:i.price,product_id:i.product_id})),created_at:new Date().toISOString()};
  DB.push('orders',sale);
  // ── Inventory deduction ──────────────────────────────
  S.orderItems.forEach(item=>{
    const prods=DB.get('products');
    const product=prods.find(p=>p.id===item.product_id);
    if(!product) return;
    if((product.category||'').toLowerCase().includes('pre made')){
      // Deduct 1 unit from this specific premade batch
      const pidx=prods.findIndex(p=>p.id===item.product_id);
      if(pidx!==-1){
        prods[pidx].batch_qty=Math.max(0,(prods[pidx].batch_qty||0)-1);
        if(prods[pidx].batch_qty<=0) prods.splice(pidx,1);
        DB.set('products',prods);
        S.products=prods;
      }
    } else {
      // Deduct recipe ingredients from inventory (1 portion per item)
      deductRecipeFromInventory(product.recipe||[],1);
    }
  });
  // ─────────────────────────────────────────────────────
  renderReceipt(sale,sub,td,cf,cash-total);
  openModal('modal-receipt');
});
function renderReceipt(sale,sub,td,cf,change){
  const meta=S.orderMeta||{};
  const now=new Date();
  const mm=String(now.getMonth()+1).padStart(2,'0');
  const dd=String(now.getDate()).padStart(2,'0');
  const yyyy=now.getFullYear();
  const hh=String(now.getHours()).padStart(2,'0');
  const min=String(now.getMinutes()).padStart(2,'0');
  const dateStr=`${mm}/${dd}/${yyyy}`;
  const timeStr=`${hh}:${min}`;
  const queueCode=meta.orderQueue||'——';
  const queueNum=String(queueCode)||'——';
  const rawId=String(sale.order_id||'').replace(/\D/g,'');
  const siNum='SI#'+rawId.padStart(8,'0');
  const orderTypeKey=meta.orderType||'dine_in';
  const orderTypeLabel={dine_in:'DINE IN',takeout:'TAKE OUT',online:'ONLINE ORDER'}[orderTypeKey]||'DINE IN';
  // Items — group identical items, show combined qty and total price
  const groupedItems=(()=>{
    const map=new Map();
    (sale.items||[]).forEach(i=>{
      const key=`${i.name}|${i.temperature||''}|${i.size||''}|${(i.addons||[]).join(',')}`;
      if(map.has(key)){const e=map.get(key);e.qty++;e.totalPrice+=Number(i.price);}
      else map.set(key,{...i,qty:1,totalPrice:Number(i.price)});
    });
    return [...map.values()];
  })();
  const items=groupedItems.map(i=>{
    const d=[i.temperature,i.size,...(i.addons||[])].filter(Boolean);
    let html=`<div class="rcp-item-row"><span class="rcp-item-qty">${i.qty}</span><span class="rcp-item-name">${i.name.toUpperCase()}</span><span class="rcp-item-price">${i.totalPrice.toFixed(2)}</span></div>`;
    d.forEach(a=>{html+=`<div class="rcp-addon-row"><span class="rcp-addon-indent"> </span><span class="rcp-addon-name">${a.toUpperCase()}</span><span></span></div>`;});
    return html;
  }).join('');
  const totalItems=sale.items.length;
  // Discount / fee breakdown rows
  let productSale=0,discountAmt=0,convFee=cf||0;
  if(meta.discountType&&meta.discountAmount>0) discountAmt=meta.discountAmount;
  (meta.customDiscounts||[]).forEach(d=>{discountAmt+=d.amount;});
  productSale=discountAmt>0?discountAmt:0;
  const issuedDate=`${mm}/${dd}/${yyyy}`;
  document.getElementById('receipt-body').innerHTML=`
<div class="rcp-wrap">
  <!-- LOGO / BRAND HEADER -->
  <div class="rcp-header">
    <div class="rcp-steam">
      <svg width="64" height="22" viewBox="0 0 64 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 18 Q16 10 18 18 Q20 10 22 18" stroke="#4a6228" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M29 18 Q31 10 33 18 Q35 10 37 18" stroke="#4a6228" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M44 18 Q46 10 48 18 Q50 10 52 18" stroke="#4a6228" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="rcp-cup">
      <svg width="72" height="52" viewBox="0 0 72 52" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 8 Q8 44 18 48 Q27 52 36 52 Q45 52 54 48 Q64 44 66 8 Z" fill="#4a6228"/>
        <path d="M66 16 Q78 18 76 28 Q74 36 66 34" stroke="#4a6228" stroke-width="3.5" fill="none" stroke-linecap="round"/>
        <rect x="10" y="50" width="52" height="5" rx="2.5" fill="#4a6228"/>
      </svg>
    </div>
    <div class="rcp-brand-name"><em>26th</em><span>2</span></div>
    <div class="rcp-est-line">—EST— <strong>cafe</strong> —2025—</div>
    <p class="rcp-tagline">Your handpicked happiness for coffee, matcha and more</p>
    <div class="rcp-divider-dash"></div>
    <p class="rcp-address">Graceland 1 Subdivision,<br>Buaya, Lapu-Lapu City, Cebu</p>
    <p class="rcp-address">Order-No: ${sale.order_id||'000000'}</p>
    <p class="rcp-queue-code">${queueCode}</p>
    <p class="rcp-invoice-title">SALES INVOICE</p>
    <p class="rcp-cashier">Cashier: ${meta.cashier||'—'}</p>
    <div class="rcp-divider-dash"></div>
    <div class="rcp-meta-bar">
      <span>${dateStr}</span><span>${timeStr}</span><span>${queueNum}</span><span class="rcp-si">${siNum}</span>
    </div>
    <div class="rcp-divider-dash"></div>
    <div class="rcp-type-bar">
      <span class="rcp-type-dashes">——————————</span>
      <span class="rcp-type-label">${orderTypeLabel}</span>
      <span class="rcp-type-dashes">——————————</span>
    </div>
  </div>
  <!-- ITEMS -->
  <div class="rcp-items">${items}</div>
  <div class="rcp-divider-dash" style="margin:6px 0"></div>
  <!-- SUBTOTAL ROW -->
  <div class="rcp-summary-top">
    <span><strong>${totalItems}</strong> Item(s)</span><span>Subtotal &nbsp;<strong>${Number(sub).toFixed(2)}</strong></span>
  </div>
  <!-- BREAKDOWN -->
  <div class="rcp-breakdown">
    <div class="rcp-br-row"><span>Product Sale</span><span>${Number(productSale).toFixed(2)}</span></div>
    <div class="rcp-br-row"><span>Discount</span><span>${Number(discountAmt).toFixed(2)}</span></div>
    <div class="rcp-br-row"><span>Convenience Fee</span><span>${Number(convFee).toFixed(2)}</span></div>
  </div>
  <div class="rcp-due-row"><span>TOTAL DUE</span><span class="rcp-due-amt">${Number(sale.total).toFixed(2)}</span></div>
  <div class="rcp-br-row" style="margin-top:4px"><span>Cash</span><span>${Number(sale.cash_tendered).toFixed(2)}</span></div>
  <div class="rcp-br-row rcp-change-row"><span>Change</span><span class="rcp-change-amt">${Number(change).toFixed(2)}</span></div>
  <!-- FOOTER -->
  <div class="rcp-divider-dash" style="margin:10px 0 6px"></div>
  <p class="rcp-issued">Receipt Issued: ${issuedDate}</p>
</div>`;
}
document.getElementById('btn-new-order').addEventListener('click',()=>{closeModal('modal-receipt');renderOrderSetup();});
function resetOrder(){S.orderItems=[];S.discount=0;document.getElementById('cash-tendered').value='';renderOrderPanel();}

// ═══════════════════════════════════════════════════
//  INVENTORY
// ═══════════════════════════════════════════════════
function loadInventory(){
  // ── Auto-move expired items to waste ──
  (function autoExpireToWaste(){
    const inv = DB.get('inventory');
    const today = new Date(); today.setHours(0,0,0,0);
    const expired = inv.filter(s => {
      if(!s.expiry_date) return false;
      const exp = new Date(s.expiry_date); exp.setHours(0,0,0,0);
      return exp < today;
    });
    if(!expired.length) return;
    expired.forEach(s => {
      DB.push('waste', {
        id: DB.uid(),
        stock_id: s.id,
        stock_name: s.name,
        qty: s.current_qty,
        unit: s.unit,
        reason: 'EXPIRED',
        logged_at: new Date().toISOString()
      });
    });
    const expiredIds = new Set(expired.map(s => s.id));
    DB.set('inventory', inv.filter(s => !expiredIds.has(s.id)));
    const names = [...new Set(expired.map(s => s.name))].join(', ');
    showToast(`⚠️ Expired & moved to Waste: ${names}`, 'error', 6000);
  })();

  const stocks=mergeStocks(DB.get('inventory'));
  const grid=document.getElementById('inventory-grid');
  if(!stocks.length){grid.innerHTML='<p class="empty-state">No stock items found.</p>';return;}
  grid.innerHTML=stocks.map(s=>{
    const pct=s.max_qty>0?Math.round((s.current_qty/s.max_qty)*100):0;
    const lvl=stockLevel(s.current_qty,s.max_qty);
    const ids=(s._ids||[s.id]).join(',');
    const actions=isAdmin()?`<div class="inv-card-actions"><button class="inv-card-btn-reduce" data-action="reduce" data-id="${s._ids[0]}" data-ids="${ids}" data-name="${s.name}" data-unit="${s.unit}">Reduce</button><button class="inv-card-btn-restock" data-action="restock" data-id="${s._ids[0]}" data-ids="${ids}" data-name="${s.name}">Restock</button></div><button class="inv-card-btn-remove" data-action="del" data-ids="${ids}" data-name="${s.name}">🗑 Remove Item</button>`:'';
    return`<div class="inv-card ${lvl.cls}"><div class="inv-card-toprow"><span class="inv-card-label">Inventory</span><span class="inv-card-pct">${pct}%</span></div><p class="inv-card-name">${s.name}</p><p class="inv-card-qty">${s.current_qty} ${s.unit} / ${s.max_qty} ${s.unit}</p><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>${s.expiry_date?`<p class="inv-card-expiry">Exp: ${s.expiry_date}</p>`:''}${actions}</div>`;
  }).join('');
}
document.getElementById('inventory-grid').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]'); if(!btn) return;
  const {action,id,ids,name,unit}=btn.dataset;
  const allIds=(ids||id).split(',');
  if(action==='restock'){
    if(!await confirm('Restock',`Top up "${name}" to max?`)) return;
    const inv=DB.get('inventory');
    inv.forEach(s=>{if(allIds.includes(s.id))s.current_qty=s.max_qty;});
    DB.set('inventory',inv); showToast('Restocked.','success'); loadInventory();
  } else if(action==='reduce'){
    const a=parseFloat(prompt(`Reduce "${name}" (${unit}) by how much?`));
    if(isNaN(a)||a<=0) return;
    const inv=DB.get('inventory');
    allIds.forEach(sid=>{const s=inv.find(x=>x.id===sid);if(s)s.current_qty=Math.max(0,(parseFloat(s.current_qty)||0)-a);});
    DB.set('inventory',inv); showToast('Reduced.','success'); loadInventory();
  } else if(action==='del'){
    if(!await confirm('Remove Item',`Remove "${name}"?`)) return;
    DB.set('inventory',DB.get('inventory').filter(s=>!allIds.includes(s.id)));
    showToast('Deleted.','success'); loadInventory();
  }
});
document.getElementById('inv-search').addEventListener('input',e=>{
  const q=e.target.value.toLowerCase();
  document.querySelectorAll('#inventory-grid .inv-card').forEach(c=>c.style.display=(c.querySelector('.inv-card-name')?.textContent||'').toLowerCase().includes(q)?'':'none');
});
document.getElementById('btn-add-stock').addEventListener('click',()=>{
  document.getElementById('stock-name').value=''; document.getElementById('stock-qty').value='';
  document.getElementById('stock-max').value=''; document.getElementById('stock-exp-month').value='';
  document.getElementById('stock-exp-day').value=''; document.getElementById('stock-exp-year').value='';
  document.getElementById('stock-unit').value='kg'; syncUnitLabels();
  openModal('modal-add-stock');
});
function syncUnitLabels(){ const u=document.getElementById('stock-unit').value; document.getElementById('as-unit-lbl-cur').textContent=u; document.getElementById('as-unit-lbl-max').textContent=u; }
document.getElementById('stock-unit').addEventListener('change',syncUnitLabels);
document.getElementById('btn-save-stock').addEventListener('click',()=>{
  const name=document.getElementById('stock-name').value.trim();
  const qty=parseFloat(document.getElementById('stock-qty').value)||0;
  const max=parseFloat(document.getElementById('stock-max').value)||0;
  const unit=document.getElementById('stock-unit').value;
  const mm=document.getElementById('stock-exp-month').value.trim().padStart(2,'0');
  const dd=document.getElementById('stock-exp-day').value.trim().padStart(2,'0');
  const yy=document.getElementById('stock-exp-year').value.trim();
  const expiry=(mm&&dd&&yy.length===4)?`${yy}-${mm}-${dd}`:'';
  if(!name){showToast('Item name required.','error');return;}
  DB.push('inventory',{id:DB.uid(),name,current_qty:qty,max_qty:max,unit,expiry_date:expiry,created_at:new Date().toISOString()});
  showToast('Stock item added.','success'); closeModal('modal-add-stock'); loadInventory();
});

// ═══════════════════════════════════════════════════
//  STOCKS PAGE
// ═══════════════════════════════════════════════════
function loadStocksPage(){
  const stocks=mergeStocks(DB.get('inventory'));
  const today=new Date(); today.setHours(0,0,0,0);
  // Anything expiring within 5 days (or already expired) goes ONLY to the bottom table
  const activeStocks=stocks.filter(s=>{
    if(!s.expiry_date) return true;
    const exp=new Date(s.expiry_date); exp.setHours(0,0,0,0);
    return Math.round((exp-today)/864e5)>5; // more than 5 days away = stays in main table
  });
  document.getElementById('stocks-tbody').innerHTML=activeStocks.map(s=>{
    const pct=s.max_qty>0?Math.round((s.current_qty/s.max_qty)*100):0;
    const lvl=stockLevel(s.current_qty,s.max_qty);
    let expTag='';
    if(s.expiry_date){const exp=new Date(s.expiry_date);exp.setHours(0,0,0,0);const d=Math.round((exp-today)/864e5);if(d===0)expTag=`<span class="stocks-exp-tag stocks-exp-today">Today</span>`;else if(d<=7)expTag=`<span class="stocks-exp-tag stocks-exp-soon">${d}d</span>`;}
    return`<tr><td class="stocks-name-cell">${s.name}</td><td>${s.current_qty}</td><td>${s.max_qty}</td><td><span class="stocks-unit-tag">${s.unit}</span></td><td class="stocks-expiry-cell">${s.expiry_date||'—'} ${expTag}</td><td><span class="stocks-status-badge stocks-status-${lvl.cls}">${lvl.label} <span class="stocks-status-pct">${pct}%</span></span></td></tr>`;
  }).join('')||'<tr><td colspan="6" class="empty-state">No stocks found.</td></tr>';
  // ── Expired + Expiring Soon (expired items always included, plus ≤5 days) ──
  const expiring=stocks.filter(s=>{if(!s.expiry_date)return false;const exp=new Date(s.expiry_date);exp.setHours(0,0,0,0);return Math.round((exp-today)/864e5)<=5;});
  const section=document.getElementById('expiring-soon-section');
  const sectionTitle=document.getElementById('expiring-soon-title');
  const tbody=document.getElementById('expiring-soon-tbody');
  if(expiring.length){
    section.hidden=false;
    // Update section title based on whether any are already expired
    const hasExpired=expiring.some(s=>{const exp=new Date(s.expiry_date);exp.setHours(0,0,0,0);return Math.round((exp-today)/864e5)<0;});
    if(sectionTitle){
      if(hasExpired && expiring.some(s=>{const exp=new Date(s.expiry_date);exp.setHours(0,0,0,0);return Math.round((exp-today)/864e5)>=0;}))
        sectionTitle.innerHTML='⚠️ <span>Expired &amp; Expiring Soon</span>';
      else if(hasExpired)
        sectionTitle.innerHTML='🚨 <span>Expired Items</span>';
      else
        sectionTitle.innerHTML='⚠️ <span>Expiring Soon</span>';
    }
    tbody.innerHTML=expiring.map(s=>{
      const exp=new Date(s.expiry_date);exp.setHours(0,0,0,0);const d=Math.round((exp-today)/864e5);
      let dLabel,rowStyle='';
      if(d<0){dLabel=`<span style="color:#c0392b;font-weight:700">${Math.abs(d)}d ago — Expired</span>`;rowStyle=' style="background:rgba(192,57,43,0.07)"';}
      else if(d===0){dLabel=`<span style="color:#c0392b;font-weight:700">Expires Today</span>`;}
      else{dLabel=`<span style="color:#e67e22;font-weight:700">${d} day${d!==1?'s':''}</span>`;}
      return`<tr${rowStyle}><td class="stocks-name-cell">${s.name}</td><td>${s.current_qty}</td><td>${s.unit}</td><td>${s.expiry_date}</td><td>${dLabel}</td><td><button class="btn btn-sm exp-resolve-btn" style="background:#c0392b;color:#fff;border:none;border-radius:6px;padding:4px 12px;cursor:pointer" data-id="${s.id}" data-name="${s.name}" data-qty="${s.current_qty}" data-unit="${s.unit}" data-exp="${s.expiry_date}">Resolve</button></td></tr>`;
    }).join('');
    tbody.querySelectorAll('.exp-resolve-btn').forEach(btn=>btn.addEventListener('click',()=>{
      ExpResolve.id=btn.dataset.id; ExpResolve.name=btn.dataset.name; ExpResolve.qty=parseFloat(btn.dataset.qty); ExpResolve.unit=btn.dataset.unit;
      document.getElementById('resolve-item-name').textContent=btn.dataset.name;
      document.getElementById('resolve-item-meta').textContent=`Qty: ${btn.dataset.qty} ${btn.dataset.unit}  ·  Exp: ${btn.dataset.exp}`;
      openModal('modal-resolve-expired');
    }));
  } else {
    section.hidden=true;
  }
}
document.getElementById('btn-add-stock-2').addEventListener('click',()=>document.getElementById('btn-add-stock').click());

// ═══════════════════════════════════════════════════
//  EXPIRATION TRACKER
// ═══════════════════════════════════════════════════
const ExpResolve={id:null,name:'',qty:0,unit:''};
function loadExpTracker(){
  const days=parseInt(document.getElementById('exp-days-input').value)||50;
  const stocks=DB.get('inventory');
  const today=new Date(); today.setHours(0,0,0,0);
  const relevant=stocks.filter(s=>{if(!s.expiry_date)return false;const exp=new Date(s.expiry_date);exp.setHours(0,0,0,0);return Math.round((exp-today)/864e5)<=days;});
  const grid=document.getElementById('expiration-grid');
  if(!relevant.length){grid.innerHTML=`<p class="empty-state">No items expiring within ${days} days.</p>`;return;}
  grid.innerHTML=relevant.map(s=>{
    const exp=new Date(s.expiry_date);exp.setHours(0,0,0,0);const d=Math.round((exp-today)/864e5);
    const pct=s.max_qty>0?Math.round((s.current_qty/s.max_qty)*100):0;
    let dLabel,cls;
    if(d<0){dLabel=`${Math.abs(d)} Days Expired`;cls='exp-card-expired';}
    else if(d===0){dLabel='Expires Today';cls='exp-card-expired';}
    else{dLabel=`${d} Days`;cls=d<=7?'exp-card-soon':'exp-card-ok';}
    return`<div class="exp-card ${cls}"><div class="exp-card-toprow"><span class="exp-card-type">Inventory</span><span class="exp-card-pct">${pct}%</span></div><p class="exp-card-name">${s.name}</p><p class="exp-card-days">${dLabel}</p><button class="exp-resolve-btn" data-id="${s.id}" data-name="${s.name}" data-qty="${s.current_qty}" data-unit="${s.unit}" data-exp="${s.expiry_date}">Resolve</button></div>`;
  }).join('');
  grid.querySelectorAll('.exp-resolve-btn').forEach(btn=>btn.addEventListener('click',()=>{
    ExpResolve.id=btn.dataset.id; ExpResolve.name=btn.dataset.name; ExpResolve.qty=parseFloat(btn.dataset.qty); ExpResolve.unit=btn.dataset.unit;
    document.getElementById('resolve-item-name').textContent=btn.dataset.name;
    document.getElementById('resolve-item-meta').textContent=`Qty: ${btn.dataset.qty} ${btn.dataset.unit}  ·  Exp: ${btn.dataset.exp}`;
    openModal('modal-resolve-expired');
  }));
}
// expiration tracker removed — expiring soon shown inline on stocks page
document.getElementById('btn-resolve-waste').addEventListener('click',()=>{
  if(!ExpResolve.id) return;
  DB.push('waste',{id:DB.uid(),stock_id:ExpResolve.id,stock_name:ExpResolve.name,qty:ExpResolve.qty,unit:ExpResolve.unit,reason:'EXPIRED',logged_at:new Date().toISOString()});
  DB.set('inventory',DB.get('inventory').filter(s=>s.id!==ExpResolve.id));
  closeModal('modal-resolve-expired'); showToast(`"${ExpResolve.name}" logged as expired waste.`,'success'); loadStocksPage();
});

// ═══════════════════════════════════════════════════
//  WASTE LOG
// ═══════════════════════════════════════════════════
function loadWaste(){
  const logs=DB.get('waste');
  document.getElementById('waste-tbody').innerHTML=logs.slice().reverse().map(l=>`<tr><td>${l.stock_name}</td><td>${l.qty}</td><td>${l.unit}</td><td><span class="reason-tag ${l.reason}">${l.reason}</span></td><td style="font-size:.78rem;color:var(--text-muted)">${new Date(l.logged_at).toLocaleString()}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">No waste entries.</td></tr>';
}
document.getElementById('btn-log-waste').addEventListener('click',()=>{
  const stocks=DB.get('inventory');
  const sel=document.getElementById('waste-item-select');
  sel.innerHTML=stocks.length?stocks.map(s=>`<option value="${s.id}" data-unit="${s.unit}" data-name="${s.name}">${s.name} (${s.unit})</option>`).join(''):'<option value="">No stock items</option>';
  document.getElementById('waste-amount').value='';
  openModal('modal-log-waste');
});
document.getElementById('btn-submit-waste').addEventListener('click',()=>{
  const sel=document.getElementById('waste-item-select');
  const opt=sel.selectedOptions[0];
  const qty=parseFloat(document.getElementById('waste-amount').value);
  const reason=document.getElementById('waste-reason').value;
  if(!opt||!opt.value){showToast('Select a stock item.','error');return;}
  if(isNaN(qty)||qty<=0){showToast('Enter a valid amount.','error');return;}
  DB.push('waste',{id:DB.uid(),stock_id:opt.value,stock_name:opt.dataset.name,qty,unit:opt.dataset.unit,reason,logged_at:new Date().toISOString()});
  // Reduce inventory
  const inv=DB.get('inventory');
  const s=inv.find(x=>x.id===opt.value);
  if(s) s.current_qty=Math.max(0,(parseFloat(s.current_qty)||0)-qty);
  DB.set('inventory',inv);
  showToast('Waste logged.','success'); closeModal('modal-log-waste'); loadWaste();
});

// ═══════════════════════════════════════════════════
//  SALES
// ═══════════════════════════════════════════════════
function loadSales(){
  const orders=DB.get('orders').slice().reverse();
  const today=new Date().toLocaleDateString();
  let todayRev=0,todayCnt=0;
  orders.forEach(o=>{if(new Date(o.created_at).toLocaleDateString()===today){todayRev+=o.total;todayCnt++;}});
  document.getElementById('sales-today').textContent=peso(todayRev);
  document.getElementById('sales-count').textContent=todayCnt;
  document.getElementById('sales-avg').textContent=todayCnt?peso(todayRev/todayCnt):peso(0);
  document.getElementById('sales-tbody').innerHTML=orders.map(o=>`<tr><td><code>${o.order_id||'—'}</code></td><td>${peso(o.total)}</td><td>${peso(o.cash_tendered)}</td><td>${peso(Math.max(0,o.cash_tendered-o.total))}</td><td>${o.cashier_name||'—'}</td><td style="font-size:.78rem;color:var(--text-muted)">${new Date(o.created_at).toLocaleString()}</td></tr>`).join('')||'<tr><td colspan="6" class="empty-state">No sales yet.</td></tr>';
}

// ═══════════════════════════════════════════════════
//  EXPENSES
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
//  FINANCIAL & EXPENSES RECORD
// ═══════════════════════════════════════════════════
let _ferView = 'overview';

function renderExpenses(){
  setupFerDropdown();
  switchFerView(_ferView);
}

function setupFerDropdown(){
  const btn  = document.getElementById('fer-view-btn');
  const menu = document.getElementById('fer-view-menu');
  // Remove old listener to avoid duplicates
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', e=>{ e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', ()=>{ menu.hidden=true; }, {capture:false});
  menu.querySelectorAll('.fer-view-item').forEach(item=>{
    item.addEventListener('click', ()=>{
      _ferView = item.dataset.view;
      document.getElementById('fer-view-label').textContent = item.textContent.trim();
      menu.querySelectorAll('.fer-view-item').forEach(x=>x.classList.remove('active'));
      item.classList.add('active');
      menu.hidden = true;
      switchFerView(_ferView);
    });
  });
}

function switchFerView(view){
  ['overview','procurement','operational'].forEach(v=>{
    document.getElementById('fer-view-'+v).hidden = (v!==view);
  });
  if(view==='overview')      renderFerOverview();
  else if(view==='procurement') renderFerProcurement();
  else if(view==='operational') renderFerOperational();
}

function ferMtdRange(){
  const now=new Date(); return {m:now.getMonth(), y:now.getFullYear()};
}

function renderFerOverview(){
  const procs   = DB.get('procurements',[]);
  const customs  = DB.get('custom_expenses',[]);
  const wastes   = DB.get('waste_log',[]);
  const {m,y}   = ferMtdRange();

  // MTD totals
  const inMtd = e => { const d=new Date(e.date||e.created_at||0); return d.getFullYear()===y && d.getMonth()===m; };
  const procMtd   = procs.filter(inMtd).reduce((s,e)=>s+(e.total||0),0);
  const customMtd = customs.filter(inMtd).reduce((s,e)=>s+e.amount,0);
  const wasteMtd  = wastes.filter(inMtd).reduce((s,w)=>s+(w.est_loss||0),0);
  const grandMtd  = procMtd + customMtd + wasteMtd;

  document.getElementById('fer-mtd-total').textContent  = peso(grandMtd);
  document.getElementById('fer-inv-total').textContent  = peso(procMtd);
  document.getElementById('fer-inv-sub').textContent    = `${procs.filter(inMtd).length} Active POs`;
  document.getElementById('fer-op-total').textContent   = peso(customMtd);
  document.getElementById('fer-waste-total').textContent= peso(wasteMtd);
  const wCnt = wastes.filter(inMtd).length;
  document.getElementById('fer-waste-sub').textContent  = wCnt ? `${wCnt} waste entr${wCnt===1?'y':'ies'}` : 'No waste logged';

  // Ingredient price comparison table
  // Group procurements by item name, show previous vs latest price
  const itemMap = {};
  procs.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(p=>{
    const key = (p.item||'').toLowerCase();
    if(!itemMap[key]) itemMap[key]={name:p.item,supplier:p.supplier||'—',entries:[]};
    itemMap[key].entries.push(p);
  });
  const priceRows = Object.values(itemMap).map(g=>{
    const entries = g.entries;
    const latest  = entries[entries.length-1];
    const prev    = entries.length>1 ? entries[entries.length-2] : null;
    const latestPpu = latest.unit_price||0;
    const prevPpu   = prev ? (prev.unit_price||0) : null;
    let changeHtml = '<span style="color:var(--text-muted)">—</span>';
    if(prevPpu!==null){
      const diff = latestPpu - prevPpu;
      const pct  = prevPpu>0 ? ((diff/prevPpu)*100).toFixed(1) : '—';
      if(diff>0)      changeHtml=`<span style="color:#c0392b">▲ ${peso(diff)} (+${pct}%)</span>`;
      else if(diff<0) changeHtml=`<span style="color:#27ae60">▼ ${peso(Math.abs(diff))} (${pct}%)</span>`;
      else            changeHtml=`<span style="color:var(--text-muted)">No change</span>`;
    }
    return `<tr>
      <td>${g.name}</td>
      <td>${g.supplier}</td>
      <td>${prevPpu!==null?peso(prevPpu):'—'}</td>
      <td>${peso(latestPpu)} / ${latest.unit||'unit'} &nbsp;<span style="font-size:.75rem;color:var(--text-muted)">${latest.date||''}</span></td>
      <td>${changeHtml}</td>
    </tr>`;
  }).join('');
  document.getElementById('fer-price-tbody').innerHTML =
    priceRows || '<tr><td colspan="5" class="fer-empty">No ingredient price data yet.</td></tr>';

  // Recent restocks (last 10)
  const recent = procs.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,10);
  document.getElementById('fer-restocks-tbody').innerHTML = recent.map(p=>`
    <tr>
      <td>${p.item||'—'}</td>
      <td><span class="fer-po-badge">${p.po||'—'}</span></td>
      <td>${p.date||'—'}</td>
      <td>${peso(p.unit_price)} × ${p.qty} ${p.unit||''} = <strong>${peso(p.total)}</strong></td>
    </tr>`).join('') || '<tr><td colspan="4" class="fer-empty">No restocks logged yet.</td></tr>';
}

function renderFerProcurement(){
  const procs = DB.get('procurements',[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('fer-proc-tbody').innerHTML = procs.map(p=>`
    <tr>
      <td>${p.item||'—'}</td>
      <td><span class="fer-po-badge">${p.po||'—'}</span></td>
      <td>${p.date||'—'}</td>
      <td>${peso(p.unit_price)} × ${p.qty} ${p.unit||''} = <strong>${peso(p.total)}</strong></td>
      <td>${isAdmin()?`<button class="btn-danger-small" data-del-proc="${p.id}">Delete</button>`:''}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="fer-empty">No restocks logged yet.</td></tr>';

  document.getElementById('fer-proc-tbody').querySelectorAll('[data-del-proc]').forEach(btn=>{
    btn.addEventListener('click', async()=>{
      if(!await confirm('Delete Entry','Remove this procurement entry?')) return;
      DB.set('procurements', DB.get('procurements',[]).filter(x=>x.id!==btn.dataset.delProc));
      showToast('Entry removed.','success'); renderFerProcurement();
    });
  });

  // Show/hide view-only notice
  const procNotice = document.getElementById('fer-proc-viewonly-notice');
  if(procNotice) procNotice.hidden = isAdmin();
}

function renderFerOperational(){
  const customs = DB.get('custom_expenses',[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const total   = customs.reduce((s,e)=>s+e.amount,0);
  document.getElementById('fer-op-cost-display').textContent = peso(total);
  document.getElementById('fer-op-entries').innerHTML = customs.map(e=>`
    <div class="fer-op-entry">
      <div class="fer-op-entry-left">
        <div class="fer-op-entry-name">${e.name}</div>
        <div class="fer-op-entry-meta">${e.date||''}${e.notes?' · '+e.notes:''}</div>
      </div>
      <div class="fer-op-entry-right">
        <span class="fer-op-entry-amt">${peso(e.amount)}</span>
        ${isAdmin()?`<button class="btn-danger-small" data-del-cexp="${e.id}">Delete</button>`:''}
      </div>
    </div>`).join('') || '<p class="fer-empty" style="padding:16px 0">No custom expenses yet.</p>';

  document.getElementById('fer-op-entries').querySelectorAll('[data-del-cexp]').forEach(btn=>{
    btn.addEventListener('click', async()=>{
      if(!await confirm('Delete Expense','Remove this expense?')) return;
      DB.set('custom_expenses', DB.get('custom_expenses',[]).filter(x=>x.id!==btn.dataset.delCexp));
      showToast('Expense removed.','success'); renderFerOperational();
    });
  });

  // Show/hide view-only notice
  const opNotice = document.getElementById('fer-op-viewonly-notice');
  if(opNotice) opNotice.hidden = isAdmin();
}

// ── Procurement modal ──────────────────────────────
document.getElementById('btn-add-procurement').addEventListener('click',()=>{
  document.getElementById('proc-po').value='';
  document.getElementById('proc-item').value='';
  document.getElementById('proc-supplier').value='';
  document.getElementById('proc-qty').value='';
  document.getElementById('proc-unit').value='';
  document.getElementById('proc-price').value='';
  document.getElementById('proc-date').value=new Date().toISOString().slice(0,10);
  openModal('modal-add-procurement');
});
document.getElementById('btn-save-procurement').addEventListener('click',()=>{
  const po    = document.getElementById('proc-po').value.trim();
  const item  = document.getElementById('proc-item').value.trim();
  const supp  = document.getElementById('proc-supplier').value.trim();
  const qty   = parseFloat(document.getElementById('proc-qty').value)||0;
  const unit  = document.getElementById('proc-unit').value.trim();
  const price = parseFloat(document.getElementById('proc-price').value)||0;
  const date  = document.getElementById('proc-date').value;
  if(!item){showToast('Ingredient/Item name required.','error');return;}
  if(qty<=0){showToast('Quantity must be > 0.','error');return;}
  if(price<=0){showToast('Unit price must be > 0.','error');return;}
  const total = qty * price;
  DB.push('procurements',{id:DB.uid(),po,item,supplier:supp,qty,unit,unit_price:price,total,date,created_at:new Date().toISOString()});
  showToast('Procurement entry added.','success');
  closeModal('modal-add-procurement');
  renderFerProcurement();
});

// ── Custom expense modal ───────────────────────────
document.getElementById('btn-add-custom-expense').addEventListener('click',()=>{
  document.getElementById('cexp-name').value='';
  document.getElementById('cexp-amount').value='';
  document.getElementById('cexp-notes').value='';
  document.getElementById('cexp-date').value=new Date().toISOString().slice(0,10);
  openModal('modal-add-custom-expense');
});
document.getElementById('btn-save-custom-expense').addEventListener('click',()=>{
  const name   = document.getElementById('cexp-name').value.trim();
  const amount = parseFloat(document.getElementById('cexp-amount').value)||0;
  const notes  = document.getElementById('cexp-notes').value.trim();
  const date   = document.getElementById('cexp-date').value;
  if(!name){showToast('Expense name required.','error');return;}
  if(amount<=0){showToast('Amount must be > 0.','error');return;}
  DB.push('custom_expenses',{id:DB.uid(),name,amount,notes,date,created_at:new Date().toISOString()});
  showToast('Expense added.','success');
  closeModal('modal-add-custom-expense');
  renderFerOperational();
});

// ═══════════════════════════════════════════════════
//  ATTENDANCE
// ═══════════════════════════════════════════════════
function renderAttendance(){
  const records=DB.get('attendance',[]);
  document.getElementById('attendance-tbody').innerHTML=records.slice().reverse().map(a=>`<tr><td>${a.name}</td><td>${a.date}</td><td>${a.clock_in||'—'}</td><td>${a.clock_out||'—'}</td><td>${a.clock_in&&a.clock_out?calcHours(a.clock_in,a.clock_out):'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">No records.</td></tr>';
}
function renderSystemLog(){
  const logs=DB.get('system_log',[]);
  document.getElementById('syslog-tbody').innerHTML=logs.slice().reverse().map(l=>`<tr><td>${l.name}</td><td>${l.date}</td><td>${l.sign_in||'—'}</td><td>${l.sign_out||'—'}</td><td>${l.sign_in&&l.sign_out?calcHours(l.sign_in,l.sign_out):'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">No records.</td></tr>';
}

// Attendance view dropdown toggle
(function(){
  const btn=document.getElementById('att-view-btn');
  const menu=document.getElementById('att-view-menu');
  const label=document.getElementById('att-view-label');
  let currentView='attendance';
  btn.addEventListener('click',e=>{e.stopPropagation();menu.hidden=!menu.hidden;});
  document.addEventListener('click',()=>{if(menu)menu.hidden=true;});
  menu.addEventListener('click',e=>{
    const item=e.target.closest('.att-view-item');
    if(!item)return;
    const view=item.dataset.attview;
    currentView=view;
    menu.querySelectorAll('.att-view-item').forEach(i=>i.classList.toggle('active',i===item));
    label.textContent=item.textContent.trim();
    menu.hidden=true;
    document.getElementById('att-panel-attendance').hidden=(view!=='attendance');
    document.getElementById('att-panel-syslog').hidden=(view!=='syslog');
    if(view==='syslog') renderSystemLog();
    else renderAttendance();
  });
})();
function calcHours(i,o){const[ih,im]=i.split(':').map(Number);const[oh,om]=o.split(':').map(Number);const d=(oh*60+om)-(ih*60+im);return d>0?`${Math.floor(d/60)}h ${d%60}m`:'—';}
function nowTime(){ const n=new Date();let h=n.getHours(),m=n.getMinutes();return`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
function todayStr(){ return new Date().toLocaleDateString(); }
document.getElementById('btn-clock-out').addEventListener('click',async()=>{
  const records=DB.get('attendance',[]);
  const rec=records.slice().reverse().find(a=>a.account_id===S.user.account_id&&a.date===todayStr()&&!a.clock_out);
  if(!rec){showToast('No open clock-in record for today.','error');return;}
  if(!await confirm('Clock Out','Record clock-out for now?')) return;
  rec.clock_out=nowTime(); DB.set('attendance',records);
  showToast(`Clocked out at ${rec.clock_out}`,'success');
  if(document.querySelector('.page[data-page="attendance"].active')) renderAttendance();
});
// Clock-in via sidebar icon replaced with auto-clock-in on POS init
function clockInUser(){
  const today=todayStr();
  DB.push('attendance',{id:DB.uid(),account_id:S.user.account_id,name:S.user.name,date:today,clock_in:nowTime(),clock_out:null});
  showToast(`Clocked in at ${nowTime()}`,'success');
  // Always record a new system log entry on every sign-in
  DB.push('system_log',{id:DB.uid(),account_id:S.user.account_id,name:S.user.name,date:today,sign_in:nowTime(),sign_out:null});
}
// Auto clock-in on login
const _origInitPOS=initPOS;

// ═══════════════════════════════════════════════════
//  REGISTER STAFF  (v2 — role-aware)
// ═══════════════════════════════════════════════════
(function(){
  let _selectedRole = '';   // 'barista' | 'manager' | 'employee'

  function rolePrefix(r){ return r==='manager'?'MGR': r==='barista'?'BAR':'EMP'; }
  function genId(r){ return `${rolePrefix(r)}-${String(Math.floor(Math.random()*900000)+100000)}`; }

  function applyRole(role){
    _selectedRole = role;
    document.getElementById('reg-role-display').value = role.charAt(0).toUpperCase()+role.slice(1)==='Employee'?'Other':role.charAt(0).toUpperCase()+role.slice(1);
    if(role==='employee') document.getElementById('reg-role-display').value='Other';
    document.getElementById('reg-system-id').value = genId(role);

    // Show/hide conditional fields
    document.getElementById('reg-email-group').hidden   = false;
    document.getElementById('reg-emptype-group').hidden = (role!=='employee');
    document.getElementById('reg-pin-group').style.display = '';

    // Close dropdown
    document.getElementById('reg-role-options').classList.remove('open');
  }

  // Dropdown toggle
  document.getElementById('reg-role-display').addEventListener('click',()=>{
    document.getElementById('reg-role-options').classList.toggle('open');
  });
  document.getElementById('reg-role-options').addEventListener('click',e=>{
    const li=e.target.closest('li[data-role]'); if(!li) return;
    applyRole(li.dataset.role);
  });
  // Close on outside click
  document.addEventListener('click',e=>{
    if(!document.getElementById('reg-role-dropdown-wrap').contains(e.target)){
      document.getElementById('reg-role-options').classList.remove('open');
    }
  });

  // Regen ID button
  document.getElementById('btn-regen-id').addEventListener('click',()=>{
    if(!_selectedRole) return;
    document.getElementById('reg-system-id').value = genId(_selectedRole);
  });

  // Create Account
  document.getElementById('btn-register-staff').addEventListener('click',()=>{
    const name = document.getElementById('reg-name').value.trim();
    const pin  = document.getElementById('reg-pin').value.trim();
    const res  = document.getElementById('reg-result');

    if(!_selectedRole){ showToast('Please select a role type.','error'); return; }
    if(!name)          { showToast('Full name is required.','error'); return; }
    if(!pin)           { showToast('Access PIN is required.','error'); return; }
    if(!/^\d{4,6}$/.test(pin)){ showToast('PIN must be 4–6 digits.','error'); return; }

    const acct = document.getElementById('reg-system-id').value;

    // Role-specific validation
    let email='', empType='';
    email = document.getElementById('reg-email').value.trim();
    if(_selectedRole==='manager'){
      if(!email){ showToast('Email is required for Manager accounts.','error'); return; }
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showToast('Please enter a valid email address.','error'); return; }
    } else if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      showToast('Please enter a valid email address.','error'); return;
    }
    if(_selectedRole==='employee'){
      empType = document.getElementById('reg-emp-type').value.trim();
    }

    // Persist
    const roleForDB = _selectedRole==='manager'?'admin':_selectedRole;
    DB.push('users',{
      id: acct,
      account_id: acct,
      name,
      role: roleForDB,
      role_type: _selectedRole,
      pin,
      email: email||null,
      employee_type: empType||null,
      admin_access: false,
      created_at: new Date().toISOString()
    });

    showToast(`Account created! ID: ${acct}`,'success',7000);
    res.textContent=`✅ Account created! ID: ${acct} — Share this with the staff member.`;

    // Reset form
    document.getElementById('reg-name').value='';
    document.getElementById('reg-pin').value='';
    document.getElementById('reg-email').value='';
    document.getElementById('reg-emp-type').value='';
    document.getElementById('reg-role-display').value='';
    document.getElementById('reg-system-id').value='';
    document.getElementById('reg-email-group').hidden=true;
    document.getElementById('reg-emptype-group').hidden=true;
    document.getElementById('reg-pin-group').style.display='none';
    _selectedRole='';
  });
})();

// ═══════════════════════════════════════════════════
//  MANAGE STAFF
// ═══════════════════════════════════════════════════
let _msCurrentId = null;

function loadStaff(){
  // Show grid, hide detail
  document.getElementById('ms-grid-view').hidden = false;
  document.getElementById('ms-detail-view').hidden = true;
  _msCurrentId = null;

  const users = DB.get('users');
  const grid = document.getElementById('staff-list');
  if(!users.length){ grid.innerHTML='<p class="empty-state">No staff found.</p>'; return; }

  grid.innerHTML = users.map(u => {
    const initial = (u.name||'?')[0].toUpperCase();
    const displayRole = u.role_type || u.role || 'staff';
    const nameParts = (u.name||'').trim().toUpperCase().split(/\s+/);
    const lastName = nameParts[nameParts.length - 1];
    const firstNames = nameParts.slice(0, -1).join(' ');
    return `<div class="ms-card">
      <div class="ms-card-avatar">${initial}</div>
      <div class="ms-card-name">${lastName}</div>
      ${firstNames ? `<div class="ms-card-sub">${firstNames}</div>` : ''}
      <button class="ms-card-view-btn" data-view-staff="${u.account_id}">VIEW</button>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-view-staff]').forEach(btn => {
    btn.addEventListener('click', () => openStaffDetail(btn.dataset.viewStaff));
  });
}

function openStaffDetail(accountId){
  const users = DB.get('users');
  const u = users.find(x => x.account_id === accountId);
  if(!u) return;
  _msCurrentId = accountId;

  document.getElementById('ms-grid-view').hidden = true;
  document.getElementById('ms-detail-view').hidden = false;

  // Populate profile card
  const _nameParts = (u.name||'').trim().toUpperCase().split(/\s+/);
  const _lastName = _nameParts[_nameParts.length - 1];
  const _firstNames = _nameParts.slice(0, -1).join(' ');
  document.getElementById('ms-detail-avatar').textContent = (u.name||'?')[0].toUpperCase();
  document.getElementById('ms-detail-name').textContent = _lastName;
  document.getElementById('ms-detail-subname').textContent = _firstNames;
  document.getElementById('ms-detail-role').textContent = (u.role_type || u.role || 'staff').toUpperCase();
  document.getElementById('ms-detail-id').textContent = u.account_id;

  // Update admin button text
  const adminBtn = document.getElementById('ms-btn-admin');
  adminBtn.textContent = u.admin_access ? 'REVOKE ADMIN ACCESS' : 'ALLOW ADMIN ACCESS';
  adminBtn.classList.toggle('ms-btn-admin-revoke', !!u.admin_access);

  // Promotion chain: employee -> barista -> manager; hide button if already manager/admin
  const _rt = (u.role_type || u.role || 'employee').toLowerCase();
  const _promoteBtn = document.getElementById('ms-btn-promote');
  if(_rt === 'manager' || u.role === 'admin'){
    _promoteBtn.style.display = 'none';
  } else {
    _promoteBtn.style.display = '';
    _promoteBtn.textContent = _rt === 'barista' ? 'PROMOTE TO MANAGER' : 'PROMOTE TO BARISTA';
  }
  // Hide terminate if self
  document.getElementById('ms-btn-terminate').style.display = u.account_id === S.user.account_id ? 'none' : '';

  // Render weekly performance chart
  window._msCurrentUser = u;
  const periodSel = document.getElementById('ms-perf-period');
  if(periodSel) periodSel.value = 'weekly';
  renderStaffPerfChart(u, 'weekly');
}

function renderStaffPerfChart(u, period){
  period = period || 'weekly';
  const canvas = document.getElementById('ms-perf-chart');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');

  const orders = DB.get('orders',[]);
  const wastes = DB.get('waste_log',[]);
  const now = Date.now();

  let segments, salesData, wasteData;

  if(period === 'weekly'){
    document.getElementById('ms-chart-title').textContent = 'WEEKLY PERFORMANCE';
    const weekMs = 7*24*60*60*1000;
    segments = [0,1,2,3].map(i => ({
      start: now - (i+1)*weekMs,
      end: now - i*weekMs,
      label: `WEEK ${4-i}`
    })).reverse();
  } else {
    document.getElementById('ms-chart-title').textContent = 'MONTHLY PERFORMANCE';
    const monthLabels = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const yr = new Date().getFullYear();
    segments = monthLabels.map((label, m) => {
      const start = new Date(yr, m, 1).getTime();
      const end   = new Date(yr, m+1, 1).getTime();
      return { start, end, label };
    });
  }

  salesData = segments.map(s =>
    orders.filter(o => o.cashier_id === u.account_id &&
      new Date(o.created_at).getTime() >= s.start &&
      new Date(o.created_at).getTime() < s.end)
      .reduce((acc,o) => acc + (o.total||0), 0)
  );
  wasteData = segments.map(s =>
    wastes.filter(o => {
      const t = new Date(o.created_at||o.logged_at||0).getTime();
      return t >= s.start && t < s.end;
    }).reduce((acc,o) => acc + (parseFloat(o.qty)||0), 0)
  );

  // --- Horizontal bar chart ---
  const n = segments.length;
  const rowH = period === 'weekly' ? 48 : 22;
  const padL = 64, padR = 24, padT = 20, padB = 36;
  const H = padT + n * rowH + padB;
  const W = canvas.parentElement.clientWidth - 48 || 600;
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = '100%';
  canvas.style.height = H + 'px';

  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const niceMax = 15000;
  const xTicks = 15;
  const barH = Math.max(8, rowH * 0.32);
  const barGap = Math.max(4, rowH * 0.12);

  // Store hit regions for tooltip
  const hitRegions = [];

  function drawChart(highlightRow){
    ctx.clearRect(0, 0, W, H);

    // Vertical grid lines + X labels
    ctx.font = '10px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    for(let t = 0; t <= xTicks; t++){
      const val = t * 1000;
      const x = padL + (val / niceMax) * chartW;
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + chartH); ctx.stroke();
      ctx.fillStyle = '#999';
      ctx.fillText(String(t), x, H - 8);
    }

    // Y axis line
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + chartH); ctx.stroke();

    // Bars
    hitRegions.length = 0;
    segments.forEach((seg, i) => {
      const y = padT + i * rowH;
      const isHover = highlightRow === i;

      // Row hover highlight
      if(isHover){
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        ctx.fillRect(0, y, W, rowH);
      }

      // Y label
      ctx.fillStyle = isHover ? '#222' : '#555';
      ctx.font = `${period==='weekly'?'bold 12px':'10px'} DM Sans, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(seg.label, padL - 8, y + rowH/2 + 4);

      // Sales bar
      const salesW = (salesData[i] / niceMax) * chartW;
      const salesY = y + rowH/2 - barH - barGap/2;
      ctx.fillStyle = isHover ? '#5a7a30' : '#4a6228';
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(padL, salesY, Math.max(salesW, 2), barH, 3)
        : (() => { ctx.rect(padL, salesY, Math.max(salesW, 2), barH); })();
      ctx.fill();

      // Waste bar
      const wasteW = (wasteData[i] / niceMax) * chartW;
      const wasteY = y + rowH/2 + barGap/2;
      ctx.fillStyle = isHover ? '#e05040' : '#c0392b';
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(padL, wasteY, Math.max(wasteW, 2), barH, 3)
        : (() => { ctx.rect(padL, wasteY, Math.max(wasteW, 2), barH); })();
      ctx.fill();

      // Store hit region (full row)
      hitRegions.push({ rowIndex: i, x: padL, y, w: chartW, h: rowH,
        label: seg.label, sales: salesData[i], waste: wasteData[i] });
    });


  }

  drawChart(-1);

  // --- Tooltip setup ---
  // Reuse or create tooltip element
  let tip = document.getElementById('ms-chart-tooltip');
  if(!tip){
    tip = document.createElement('div');
    tip.id = 'ms-chart-tooltip';
    tip.style.cssText = `
      position:fixed;pointer-events:none;display:none;z-index:9999;
      background:rgba(30,30,30,0.92);color:#fff;border-radius:8px;
      padding:8px 13px;font:13px DM Sans,sans-serif;line-height:1.6;
      box-shadow:0 4px 16px rgba(0,0,0,0.22);white-space:nowrap;
    `;
    document.body.appendChild(tip);
  }

  // Remove old listener by cloning the canvas
  const newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, newCanvas); // no-op placeholder
  // Use named handler stored on canvas so we can remove on re-render
  if(canvas._chartMouseMove) canvas.removeEventListener('mousemove', canvas._chartMouseMove);
  if(canvas._chartMouseLeave) canvas.removeEventListener('mouseleave', canvas._chartMouseLeave);

  canvas._chartMouseMove = function(e){
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let found = null;
    for(const r of hitRegions){
      if(mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h){
        found = r; break;
      }
    }

    if(found){
      canvas.style.cursor = 'crosshair';
      drawChart(found.rowIndex);
      const total = found.sales + found.waste;
      tip.innerHTML =
        `<div style="font-weight:700;margin-bottom:4px;font-size:13px">${found.label}</div>` +
        `<div><span style="color:#7ebd45">&#9646;</span> Sales &nbsp;<strong>&#8369; ${found.sales.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>` +
        `<div><span style="color:#e05040">&#9646;</span> Waste &nbsp;<strong>${found.waste.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})} units</strong></div>` +
        `<div style="border-top:1px solid rgba(255,255,255,0.2);margin-top:5px;padding-top:4px">Total &nbsp;<strong>&#8369; ${total.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>`;
      tip.style.display = 'block';
      const tx = e.clientX + 14;
      const ty = e.clientY - 10;
      // Keep tip within viewport
      const tw = tip.offsetWidth || 180;
      tip.style.left = (tx + tw > window.innerWidth ? e.clientX - tw - 14 : tx) + 'px';
      tip.style.top  = ty + 'px';
    } else {
      canvas.style.cursor = '';
      drawChart(-1);
      tip.style.display = 'none';
    }
  };

  canvas._chartMouseLeave = function(){
    canvas.style.cursor = '';
    drawChart(-1);
    tip.style.display = 'none';
  };

  canvas.addEventListener('mousemove', canvas._chartMouseMove);
  canvas.addEventListener('mouseleave', canvas._chartMouseLeave);
}

// Wire up period dropdown
(function(){
  const sel = document.getElementById('ms-perf-period');
  if(sel){
    sel.addEventListener('change', function(){
      if(window._msCurrentUser) renderStaffPerfChart(window._msCurrentUser, this.value);
    });
  }
})();

document.getElementById('btn-ms-back').addEventListener('click', () => {
  document.getElementById('ms-grid-view').hidden = false;
  document.getElementById('ms-detail-view').hidden = true;
  _msCurrentId = null;
});

document.getElementById('ms-btn-promote').addEventListener('click', async () => {
  if(!_msCurrentId) return;
  const users = DB.get('users');
  const u = users.find(x => x.account_id === _msCurrentId);
  if(!u) return;
  const currentRole = (u.role_type || u.role || 'employee').toLowerCase();
  if(currentRole === 'manager' || u.role === 'admin'){
    showToast('This staff member cannot be promoted further.','info'); return;
  }
  const nextRole = currentRole === 'barista' ? 'manager' : 'barista';
  const nextLabel = nextRole.charAt(0).toUpperCase() + nextRole.slice(1);
  if(!await confirm('Promote', `Promote this staff member to ${nextLabel}?`)) return;
  u.role_type = nextRole;
  u.role = nextRole === 'manager' ? 'admin' : 'staff';
  DB.set('users', users);
  showToast(`Promoted to ${nextLabel}.`, 'success');
  openStaffDetail(_msCurrentId);
});

document.getElementById('ms-btn-admin').addEventListener('click', async () => {
  if(!_msCurrentId) return;
  const users = DB.get('users');
  const u = users.find(x => x.account_id === _msCurrentId);
  if(!u) return;
  const granting = !u.admin_access;
  if(!await confirm(granting ? 'Allow Admin Access' : 'Revoke Admin Access', granting ? 'Grant admin access to this user?' : 'Revoke admin access from this user?')) return;
  u.admin_access = granting;
  DB.set('users', users);
  showToast(granting ? 'Admin access granted.' : 'Admin access revoked.', 'success');
  openStaffDetail(_msCurrentId);
});

document.getElementById('ms-btn-terminate').addEventListener('click', async () => {
  if(!_msCurrentId) return;
  if(!await confirm('Terminate Staff','Remove this staff member from the system?')) return;
  DB.set('users', DB.get('users').filter(x => x.account_id !== _msCurrentId));
  showToast('Staff removed.','success');
  loadStaff();
});

document.getElementById('ms-btn-clockout').addEventListener('click', async () => {
  if(!_msCurrentId) return;
  if(!await confirm('Clock Out','Force clock-out this staff member?')) return;
  const records = DB.get('attendance',[]);
  const today = todayStr();
  const rec = records.find(r => r.account_id === _msCurrentId && r.date === today && !r.clock_out);
  if(rec){ rec.clock_out = nowTime(); DB.set('attendance', records); showToast('Clocked out.','success'); }
  else showToast('No open clock-in found for today.','info');
});

// ═══════════════════════════════════════════════════
//  EDIT ITEMS — list view with Edit / Recipe / Delete
// ═══════════════════════════════════════════════════
let _editCat='all', _editSearch='';
function loadEditItems(cat){
  _editCat=cat||_editCat;
  S.products=DB.get('products');
  const grid=document.getElementById('edit-items-grid');
  const q=(_editSearch||'').toLowerCase();
  const filtered=S.products.filter(p=>catMatch(p,_editCat)&&(!q||p.name.toLowerCase().includes(q)));
  if(!filtered.length){grid.innerHTML='<p class="empty-state">No products found.</p>';return;}
  grid.innerHTML=filtered.map(p=>`
    <div class="edit-item-row" data-id="${p.id}">
      <span class="edit-item-emoji">${p.emoji||'☕'}</span>
      <div class="edit-item-info">
        <span class="edit-item-name">${p.name}</span>
        <span class="edit-item-meta">${p.category} · ₱${Number(p.base_price||0).toFixed(2)}</span>
      </div>
      <div class="edit-item-actions">
        <button class="btn btn-primary btn-sm ei-edit" data-id="${p.id}">✏️ Edit</button>
        <button class="btn btn-outline btn-sm ei-recipe" data-id="${p.id}">📋 Recipe</button>
        <button class="btn-danger-small ei-del" data-id="${p.id}" data-name="${p.name}">Delete</button>
      </div>
    </div>`).join('')
    +'<p class="edit-item-hint">Double-click or right-click a row to edit</p>';

  // Button listeners
  grid.querySelectorAll('.ei-edit').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openEditProduct(b.dataset.id);}));
  grid.querySelectorAll('.ei-recipe').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openRecipeEditor(b.dataset.id);}));
  grid.querySelectorAll('.ei-del').forEach(b=>b.addEventListener('click',async e=>{
    e.stopPropagation();
    if(!await confirm('Delete Product',`Delete "${b.dataset.name}"?`)) return;
    DB.set('products',DB.get('products').filter(p=>p.id!==b.dataset.id));
    showToast('Product deleted.','success'); loadEditItems();
  }));
  // Double-click / right-click on row = Edit
  grid.querySelectorAll('.edit-item-row').forEach(row=>{
    row.addEventListener('dblclick',()=>openEditProduct(row.dataset.id));
    row.addEventListener('contextmenu',e=>{e.preventDefault();openEditProduct(row.dataset.id);});
  });
}
document.getElementById('edit-cat-tabs').addEventListener('click',e=>{
  const t=e.target.closest('.cat-tab'); if(!t) return;
  document.querySelectorAll('#edit-cat-tabs .cat-tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
  loadEditItems(t.dataset.cat);
});
document.getElementById('edit-search').addEventListener('input',e=>{_editSearch=e.target.value;loadEditItems();});
// (old grid delegation removed — handlers are now set inside loadEditItems)
// Add Product
document.getElementById('btn-add-product').addEventListener('click',()=>{ npmReset(); npmPopulateIngredients(); openModal('modal-add-product'); });
const NPM={cat:'Coffee & Espresso',sv:'BOTH',addons:['Pearl','Jelly','Espresso Shot'],recipe:[]};
function npmReset(){
  NPM.cat='Coffee & Espresso'; NPM.sv='BOTH'; NPM.addons=['Pearl','Jelly','Espresso Shot']; NPM.recipe=[];
  document.getElementById('prod-name').value=''; document.getElementById('prod-cat').value='Coffee & Espresso';
  document.getElementById('prod-price').value='0'; document.getElementById('prod-desc').value='';
  document.getElementById('prod-has-temp').checked=true;
  document.getElementById('prod-has-addon').checked=true;
  document.getElementById('size-small').checked=true; document.getElementById('size-medium').checked=true; document.getElementById('size-large').checked=true;
  document.getElementById('size-medium-price').value='0'; document.getElementById('size-large-price').value='0';
  npmRenderAddons(); npmRenderRecipe(); renderNpmCatTiles(); updateNpmSvBtns(); updateNpmVariationSection();
}
document.getElementById('npm-cat-tiles').addEventListener('click',e=>{
  const t=e.target.closest('.npm-cat-tile[data-cat]'); if(!t||t.classList.contains('npm-cat-tile-add')) return;
  NPM.cat=t.dataset.cat; document.getElementById('prod-cat').value=NPM.cat; updateNpmCatTiles();
});
function renderNpmCatTiles(){
  const cats=DB.get('categories',[]);
  const container=document.getElementById('npm-cat-tiles');
  container.innerHTML=cats.map(c=>`<button type="button" class="npm-cat-tile${NPM.cat===c.key?' active':''}" data-cat="${c.key}" data-cat-id="${c.id}"><span class="npm-tile-icon">${c.emoji}</span><span class="npm-tile-name">${c.name}</span></button>`).join('')
    +`<button type="button" class="npm-cat-tile npm-cat-tile-add" id="npm-btn-add-cat">＋ New</button>`;
  document.getElementById('npm-btn-add-cat').onclick=()=>openAddCategoryDialog('npm');
  container.querySelectorAll('.npm-cat-tile[data-cat]').forEach(tile=>{
    tile.addEventListener('contextmenu',e=>{e.preventDefault();openEditCategoryPopover(tile.dataset.catId,e,'npm');});
    let pressTimer;
    tile.addEventListener('pointerdown',()=>{pressTimer=setTimeout(()=>openEditCategoryPopover(tile.dataset.catId,{clientX:tile.getBoundingClientRect().left,clientY:tile.getBoundingClientRect().bottom},'npm'),600);});
    tile.addEventListener('pointerup',()=>clearTimeout(pressTimer));
    tile.addEventListener('pointerleave',()=>clearTimeout(pressTimer));
  });
}
function updateNpmCatTiles(){ document.querySelectorAll('#npm-cat-tiles .npm-cat-tile[data-cat]').forEach(t=>t.classList.toggle('active',t.dataset.cat===NPM.cat)); }
document.getElementById('npm-serving-btns').addEventListener('click',e=>{
  const b=e.target.closest('.npm-sv-btn'); if(!b) return; NPM.sv=b.dataset.sv; updateNpmSvBtns();
});
function updateNpmSvBtns(){ document.querySelectorAll('.npm-sv-btn').forEach(b=>b.classList.toggle('active',b.dataset.sv===NPM.sv)); }

// Show/hide the entire variation section (temp HOT/ICED + cup size + add-ons)
function updateNpmVariationSection(){
  const on = document.getElementById('prod-has-temp').checked;
  document.getElementById('npm-variation-section').style.display = on ? '' : 'none';
  // Also sync serving-btns visibility inside
  document.getElementById('npm-serving-btns').style.display = on ? '' : 'none';
}
// Show/hide the add-ons chip list only
function updateNpmAddonSection(){
  const on = document.getElementById('prod-has-addon').checked;
  document.getElementById('npm-addons-row').style.display = on ? '' : 'none';
}
document.getElementById('prod-has-temp').addEventListener('change', updateNpmVariationSection);
document.getElementById('prod-has-addon').addEventListener('change', updateNpmAddonSection);

function npmRenderAddons(){
  const row=document.getElementById('npm-addons-row');
  row.innerHTML=NPM.addons.map(a=>`<span class="npm-addon-chip">${a}</span>`).join('')+
    `<button type="button" class="npm-btn-new-addon" id="npm-btn-new-addon">+ NEW</button><button type="button" class="npm-btn-rm-addon" id="npm-btn-rm-addon">- REMOVE</button>`;
  document.getElementById('npm-btn-new-addon').onclick=()=>{ const n=prompt('Add-on name:'); if(n?.trim()){NPM.addons.push(n.trim());npmRenderAddons();} };
  document.getElementById('npm-btn-rm-addon').onclick=()=>{ if(NPM.addons.length){NPM.addons.pop();npmRenderAddons();} };
}
// ── Unit sub-options map ──────────────────────────────────────────────────────
// Format: { mainUnit: [ [value, label], ... ] }
// The main unit itself always appears first (as the "whole" option).
const UNIT_OPTIONS = {
  'L':    [['L','L'],['ml','ml']],
  'ml':   [['ml','ml'],['L','L']],
  'Cup':  [['Cup','Cup'],['tbsp','tbsp'],['tsp','tsp']],
  'kg':   [['kg','kg'],['g','g'],['mg','mg']],
  'g':    [['g','g'],['mg','mg'],['kg','kg']],
  'scoop':[['scoop','scoop']],
  'pcs':  [['pcs','pcs']],
  'pack': [['pack','pack']],
};
function getUnitOptions(baseUnit){
  const opts = UNIT_OPTIONS[baseUnit] || [[baseUnit, baseUnit]];
  return opts.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
}
function syncUnitSelect(selectId, unitSelectId){
  const sel = document.getElementById(selectId);
  const unitSel = document.getElementById(unitSelectId);
  const opt = sel.selectedOptions[0];
  const base = opt ? (opt.dataset.unit || 'kg') : 'kg';
  unitSel.innerHTML = getUnitOptions(base);
}
// ─────────────────────────────────────────────────────────────────────────────

async function npmPopulateIngredients(){
  const stocks=DB.get('inventory');
  document.getElementById('npm-ing-select').innerHTML='<option value="">-- Select Ingredient --</option>'+stocks.map(s=>`<option value="${s.id}" data-unit="${s.unit}" data-name="${s.name}">${s.name} (${s.unit})</option>`).join('');
  // Reset unit dropdown to default
  document.getElementById('npm-ing-unit').innerHTML = getUnitOptions('kg');
  // Update unit options whenever ingredient changes
  document.getElementById('npm-ing-select').onchange = () => syncUnitSelect('npm-ing-select','npm-ing-unit');
}
document.getElementById('npm-btn-add-ing').addEventListener('click',()=>{
  const sel=document.getElementById('npm-ing-select'); const opt=sel.selectedOptions[0];
  if(!opt||!opt.value){showToast('Select an ingredient.','error');return;}
  const qty=parseFloat(document.getElementById('npm-ing-qty').value)||1;
  const unit=document.getElementById('npm-ing-unit').value;
  NPM.recipe.push({id:opt.value,name:opt.dataset.name,qty,unit}); npmRenderRecipe();
});
function npmRenderRecipe(){
  const rows=document.getElementById('npm-recipe-rows');
  rows.innerHTML=NPM.recipe.map((r,i)=>`<div class="npm-recipe-row"><span>${r.name}</span><span>${r.qty} ${r.unit} <button class="npm-rm" data-i="${i}">✕</button></span></div>`).join('');
  rows.querySelectorAll('.npm-rm').forEach(b=>b.addEventListener('click',()=>{NPM.recipe.splice(+b.dataset.i,1);npmRenderRecipe();}));
}
document.getElementById('btn-save-product').addEventListener('click',()=>{
  const name=document.getElementById('prod-name').value.trim();
  const price=parseFloat(document.getElementById('prod-price').value)||0;
  if(!name||price<=0){showToast('Name and price required.','error');return;}
  const icons={'Coffee & Espresso':'☕','Specialty Matcha':'🍵','Milktea':'🧋','Food':'🥐','Pre Made':'🥤'};
  const sizes=[];
  if(document.getElementById('size-small').checked) sizes.push('SMALL');
  if(document.getElementById('size-medium').checked) sizes.push('MEDIUM');
  if(document.getElementById('size-large').checked) sizes.push('LARGE');
  const hasTemp=document.getElementById('prod-has-temp').checked;
  const hasAddon=document.getElementById('prod-has-addon').checked;
  DB.push('products',{id:DB.uid(),name,emoji:icons[NPM.cat]||'☕',category:NPM.cat,base_price:price,description:document.getElementById('prod-desc').value.trim(),has_temperature:hasTemp?1:0,has_size:hasTemp&&sizes.length>0?1:0,has_addon:hasTemp&&hasAddon&&NPM.addons.length>0?1:0,serving_var:hasTemp?NPM.sv:'NONE',sizes_enabled:hasTemp?sizes:[],medium_add:parseFloat(document.getElementById('size-medium-price').value)||0,large_add:parseFloat(document.getElementById('size-large-price').value)||0,hot_add:0,iced_add:0,recipe:[...NPM.recipe],storage_type:'fresh',created_at:new Date().toISOString()});
  showToast('Product added.','success'); closeModal('modal-add-product');
  S.products=DB.get('products'); loadEditItems();
});

// ═══════════════════════════════════════════════════
//  EDIT PRODUCT MODAL
// ═══════════════════════════════════════════════════
const PROD_EMOJIS=['☕','🍵','🧋','🥐','🥤','🍛','🍰','🧁','🍩','🥗','🥪','🍜','🍣','🍦','🎂','🥞','🍺','🧃','🫖','🍷','🍫','🍬','🌮','🍔','🌯','🥙','🍕','🧆','🥧','🍮','🫙','🧇'];
let _epId=null, _epEmoji='☕', _epSv='BOTH';

function openEditProduct(productId){
  const p=DB.get('products').find(x=>x.id===productId); if(!p) return;
  _epId=productId; _epEmoji=p.emoji||'☕'; _epSv=p.serving_var||'BOTH';

  // Emoji
  document.getElementById('edit-emoji-display').textContent=_epEmoji;
  renderEditEmojiPicker();
  document.getElementById('edit-emoji-picker').hidden=true;

  // Basic fields
  document.getElementById('edit-prod-name').value=p.name||'';
  document.getElementById('edit-prod-price').value=p.base_price||0;

  // Category dropdown
  const catSel=document.getElementById('edit-prod-cat');
  const cats=DB.get('categories',[]);
  catSel.innerHTML=cats.map(c=>`<option value="${c.key}"${c.key===p.category?' selected':''}>${c.name}</option>`).join('');

  // Serving variation
  document.getElementById('edit-has-temp').checked=!!p.has_temperature;
  updateEpVariationSection();
  document.querySelectorAll('#edit-sv-btns .npm-sv-btn').forEach(b=>b.classList.toggle('active',b.dataset.sv===_epSv));
  updateEpSurchargeRow();

  // Surcharges
  document.getElementById('edit-hot-surcharge').value=p.hot_add||0;
  document.getElementById('edit-iced-surcharge').value=p.iced_add||0;

  // Sizes
  const sizes=p.sizes_enabled||[];
  document.getElementById('edit-size-small').checked=sizes.includes('SMALL')||!sizes.length;
  document.getElementById('edit-size-medium').checked=sizes.includes('MEDIUM');
  document.getElementById('edit-size-large').checked=sizes.includes('LARGE');
  document.getElementById('edit-size-medium-price').value=p.medium_add||0;
  document.getElementById('edit-size-large-price').value=p.large_add||0;

  // Add-ons
  document.getElementById('edit-has-addon').checked=!!p.has_addon;
  renderEpAddons();

  openModal('modal-edit-product');
}

function renderEditEmojiPicker(){
  const picker=document.getElementById('edit-emoji-picker');
  picker.innerHTML=PROD_EMOJIS.map(e=>`<button type="button" class="cat-emoji-btn${e===_epEmoji?' selected':''}" data-emoji="${e}">${e}</button>`).join('');
  picker.querySelectorAll('.cat-emoji-btn').forEach(b=>{
    b.onclick=()=>{
      _epEmoji=b.dataset.emoji;
      document.getElementById('edit-emoji-display').textContent=_epEmoji;
      picker.querySelectorAll('.cat-emoji-btn').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      picker.hidden=true;
    };
  });
}
document.getElementById('edit-emoji-btn').addEventListener('click',()=>{
  const p=document.getElementById('edit-emoji-picker'); p.hidden=!p.hidden;
});

function updateEpVariationSection(){
  const on=document.getElementById('edit-has-temp').checked;
  document.getElementById('edit-variation-section').style.display=on?'':'none';
}
function updateEpSurchargeRow(){
  document.getElementById('edit-hot-col').style.display=(_epSv==='HOT'||_epSv==='BOTH')?'':'none';
  document.getElementById('edit-iced-col').style.display=(_epSv==='ICED'||_epSv==='BOTH')?'':'none';
}
function renderEpAddons(){
  const row=document.getElementById('edit-addons-row');
  const on=document.getElementById('edit-has-addon').checked;
  row.style.display=on?'':'none'; if(!on) return;
  const addons=DB.get('addons');
  row.innerHTML=addons.map(a=>`<span class="npm-addon-chip">${a.name}</span>`).join('')
    +`<button type="button" class="npm-btn-new-addon" id="ep-btn-new-addon">+ NEW</button>`
    +`<button type="button" class="npm-btn-rm-addon" id="ep-btn-rm-addon">- REMOVE</button>`;
  document.getElementById('ep-btn-new-addon').onclick=()=>{
    const n=prompt('Add-on name:'); if(n?.trim()){ DB.push('addons',{id:DB.uid(),name:n.trim(),emoji:'⭐',price:0}); renderEpAddons(); }
  };
  document.getElementById('ep-btn-rm-addon').onclick=()=>{
    const a=DB.get('addons'); if(a.length){a.pop();DB.set('addons',a);renderEpAddons();}
  };
}
document.getElementById('edit-has-temp').addEventListener('change',updateEpVariationSection);
document.getElementById('edit-has-addon').addEventListener('change',renderEpAddons);
document.getElementById('edit-sv-btns').addEventListener('click',e=>{
  const b=e.target.closest('.npm-sv-btn'); if(!b) return;
  _epSv=b.dataset.sv;
  document.querySelectorAll('#edit-sv-btns .npm-sv-btn').forEach(x=>x.classList.toggle('active',x.dataset.sv===_epSv));
  updateEpSurchargeRow();
});
document.getElementById('btn-update-product').addEventListener('click',()=>{
  const name=document.getElementById('edit-prod-name').value.trim();
  const price=parseFloat(document.getElementById('edit-prod-price').value)||0;
  if(!name||price<=0){showToast('Name and price required.','error');return;}
  const hasTemp=document.getElementById('edit-has-temp').checked;
  const hasAddon=document.getElementById('edit-has-addon').checked;
  const cat=document.getElementById('edit-prod-cat').value;
  const sizes=[];
  if(document.getElementById('edit-size-small').checked) sizes.push('SMALL');
  if(document.getElementById('edit-size-medium').checked) sizes.push('MEDIUM');
  if(document.getElementById('edit-size-large').checked) sizes.push('LARGE');
  const products=DB.get('products');
  const idx=products.findIndex(p=>p.id===_epId); if(idx===-1) return;
  // Infer emoji from category if not changed manually
  const catIcons={'Coffee & Espresso':'☕','Specialty Matcha':'🍵','Milktea':'🧋','Food':'🥐','Pre Made':'🥤'};
  const emoji=_epEmoji!==catIcons[products[idx].category]?_epEmoji:(catIcons[cat]||_epEmoji);
  products[idx]={...products[idx],name,emoji,category:cat,base_price:price,
    has_temperature:hasTemp?1:0,has_size:hasTemp&&sizes.length>0?1:0,
    has_addon:hasTemp&&hasAddon&&DB.get('addons').length>0?1:0,
    serving_var:hasTemp?_epSv:'NONE',sizes_enabled:hasTemp?sizes:[],
    medium_add:parseFloat(document.getElementById('edit-size-medium-price').value)||0,
    large_add:parseFloat(document.getElementById('edit-size-large-price').value)||0,
    hot_add:parseFloat(document.getElementById('edit-hot-surcharge').value)||0,
    iced_add:parseFloat(document.getElementById('edit-iced-surcharge').value)||0,
  };
  DB.set('products',products); S.products=products;
  showToast('Product updated.','success'); closeModal('modal-edit-product'); loadEditItems();
});

// ═══════════════════════════════════════════════════
//  RECIPE EDITOR MODAL
// ═══════════════════════════════════════════════════
let _recipeProductId=null, _recipeItems=[];

function openRecipeEditor(productId){
  const p=DB.get('products').find(x=>x.id===productId); if(!p) return;
  _recipeProductId=productId;
  _recipeItems=(p.recipe||[]).map(r=>({...r}));
  document.getElementById('recipe-modal-title').textContent=`Recipe — ${p.name}`;
  document.getElementById('recipe-prod-emoji').textContent=p.emoji||'☕';
  document.getElementById('recipe-prod-name-lbl').textContent=p.name;
  renderRecipeRows();
  openModal('modal-recipe');
}

function renderRecipeRows(){
  const container=document.getElementById('recipe-rows');
  const stocks=DB.get('inventory');
  if(!_recipeItems.length){container.innerHTML='<p style="font-size:.8rem;color:var(--text-muted);padding:8px 2px">No ingredients yet. Click "+ Add Ingredient" below.</p>';return;}
  container.innerHTML=_recipeItems.map((item,i)=>{
    const stockOpts=stocks.map(s=>`<option value="${s.id}"${s.id===item.stockId?' selected':''}>${s.name} (${s.unit})</option>`).join('');
    const baseUnit=stocks.find(s=>s.id===item.stockId)?.unit||item.unit||'kg';
    const unitOpts=getUnitOptions(baseUnit);
    return `<div class="recipe-ing-row" data-i="${i}">
      <select class="rcp-item" data-i="${i}"><option value="">-- Select --</option>${stockOpts}</select>
      <input class="rcp-qty" type="number" value="${item.qty||1}" min="0.01" step="0.01" data-i="${i}"/>
      <select class="rcp-unit recipe-ing-unit" data-i="${i}">${unitOpts}</select>
      <button class="recipe-rm-btn" data-i="${i}">✕</button>
    </div>`;
  }).join('');

  // Wire events
  container.querySelectorAll('.rcp-item').forEach(sel=>{
    sel.addEventListener('change',()=>{
      const i=+sel.dataset.i; const opt=sel.selectedOptions[0];
      if(opt?.value){
        const stk=stocks.find(s=>s.id===opt.value);
        _recipeItems[i].stockId=opt.value; _recipeItems[i].name=stk?.name||''; _recipeItems[i].unit=stk?.unit||'kg';
        // refresh unit dropdown
        const unitSel=container.querySelector(`.rcp-unit[data-i="${i}"]`);
        if(unitSel){ unitSel.innerHTML=getUnitOptions(stk?.unit||'kg'); unitSel.value=_recipeItems[i].unit; }
      }
    });
    // Force current selection to reflect stored value
    if(item){ /* handled via HTML selected attr */ }
  });
  // Fix unit selection after render
  container.querySelectorAll('.rcp-unit').forEach(sel=>{
    const i=+sel.dataset.i; if(_recipeItems[i]) sel.value=_recipeItems[i].unit||'kg';
    sel.addEventListener('change',()=>{ _recipeItems[+sel.dataset.i].unit=sel.value; });
  });
  container.querySelectorAll('.rcp-qty').forEach(inp=>{
    inp.addEventListener('input',()=>{ _recipeItems[+inp.dataset.i].qty=parseFloat(inp.value)||1; });
  });
  container.querySelectorAll('.recipe-rm-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{ _recipeItems.splice(+btn.dataset.i,1); renderRecipeRows(); });
  });
}

document.getElementById('btn-recipe-add-ing').addEventListener('click',()=>{
  _recipeItems.push({stockId:'',name:'',qty:1,unit:'kg'}); renderRecipeRows();
});
document.getElementById('btn-save-recipe').addEventListener('click',()=>{
  if(_recipeItems.some(r=>!r.stockId)){showToast('Select an ingredient for every row.','error');return;}
  const products=DB.get('products'); const idx=products.findIndex(p=>p.id===_recipeProductId);
  if(idx===-1) return;
  products[idx].recipe=_recipeItems.map(r=>({stockId:r.stockId,name:r.name,qty:r.qty,unit:r.unit}));
  DB.set('products',products); S.products=products;
  showToast('Recipe saved.','success'); closeModal('modal-recipe');
});

// ═══════════════════════════════════════════════════
//  PREMADE STOCK
// ═══════════════════════════════════════════════════
function loadPremade(){
  const items=DB.get('products').filter(p=>(p.category||'').toLowerCase().includes('pre made'));
  const fresh=items.filter(p=>(p.storage_type||'fresh')==='fresh');
  const safe=items.filter(p=>p.storage_type==='safe');
  const today=new Date(); today.setHours(0,0,0,0);
  function groupByDate(list){
    const m={}; list.forEach(p=>{const d=new Date(p.created_at||Date.now());const l=d.toDateString()===today.toDateString()?'Today':d.toDateString()===new Date(today.getTime()-864e5).toDateString()?'Yesterday':d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});if(!m[l])m[l]=[];m[l].push(p);});return m;
  }
  function freshnessLabel(p){const h=(Date.now()-new Date(p.created_at||Date.now()).getTime())/36e5;if(h<24)return{cls:'pm-badge-fresh',text:'🌿 Fresh'};if(h<48)return{cls:'pm-badge-ok',text:'🟡 Day Old'};return{cls:'pm-badge-old',text:'🔴 Old'};}
  function row(p,i){const f=freshnessLabel(p);const dt=new Date(p.created_at||Date.now());const dtStr=dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});const delBtn=isAdmin()?`<button class="pm-row-delete" data-del="${p.id}" title="Delete">🗑</button>`:'';return`<div class="pm-stock-row"><div class="pm-row-left"><span class="pm-cat-badge">${p.category}</span><span class="pm-batch-label">Batch #${String(i+1).padStart(3,'0')}</span><span class="pm-fresh-badge ${f.cls}">${f.text}</span><div class="pm-row-info"><span class="pm-row-name">${p.name}</span><span class="pm-row-date">${dtStr}</span></div></div><div class="pm-row-right"><div class="pm-row-qty-block"><span class="pm-qty-numbers">${p.batch_qty||0}</span><span class="pm-qty-label">items made</span><span class="pm-price-label">₱ ${Number(p.base_price||0).toFixed(2)} / pc</span></div>${delBtn}</div></div>`;}
  const fg=groupByDate(fresh);
  let html=`<div class="pm-section"><div class="pm-section-header"><span class="pm-section-icon">🌿</span><span class="pm-section-title">Fresh</span></div>`;
  const fk=Object.keys(fg);
  if(!fk.length) html+='<p class="pm-empty-state">No fresh items.</p>';
  else fk.forEach(dl=>{html+=`<div class="pm-date-group-label">${dl}</div><div class="pm-rows-wrap">${fg[dl].map((p,i)=>row(p,i)).join('')}</div>`;});
  html+=`</div><div class="pm-section" style="margin-top:0"><div class="pm-section-header"><span class="pm-section-icon">🧡</span><span class="pm-section-title">Safe to Stock</span></div>`;
  if(!safe.length) html+='<p class="pm-empty-state">No safe-to-stock items.</p>';
  else html+=`<div class="pm-rows-wrap">${safe.map((p,i)=>row(p,i)).join('')}</div>`;
  html+=`</div>`;
  document.getElementById('premade-grid').innerHTML=html;
  document.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click',async e=>{
    e.stopPropagation();
    if(!await confirm('Delete','Remove this premade stock?')) return;
    DB.set('products',DB.get('products').filter(p=>p.id!==btn.dataset.del));
    showToast('Removed.','success'); loadPremade();
  }));
}
document.getElementById('btn-add-premade').addEventListener('click',()=>{ pmReset(); pmPopulateIngredients(); openModal('modal-add-premade'); });
const PM={cat:'Coffee & Espresso',storage:'fresh',recipe:[]};
function pmReset(){
  PM.cat='Coffee & Espresso'; PM.storage='fresh'; PM.recipe=[];
  document.getElementById('pm-item-name').value=''; document.getElementById('pm-price').value='0'; document.getElementById('pm-qty').value='1';
  renderPmCatTiles(); updatePmStorage(); pmRenderRecipe();
}
document.getElementById('pm-cat-tiles').addEventListener('click',e=>{
  const t=e.target.closest('.npm-cat-tile[data-cat]'); if(!t||t.classList.contains('npm-cat-tile-add')) return;
  PM.cat=t.dataset.cat; updatePmCatTiles();
});
function renderPmCatTiles(){
  const cats=DB.get('categories',[]);
  const container=document.getElementById('pm-cat-tiles');
  container.innerHTML=cats.map(c=>`<button type="button" class="npm-cat-tile${PM.cat===c.key?' active':''}" data-cat="${c.key}" data-cat-id="${c.id}"><span class="npm-tile-icon">${c.emoji}</span><span class="npm-tile-name">${c.name}</span></button>`).join('')
    +`<button type="button" class="npm-cat-tile npm-cat-tile-add" id="pm-btn-add-cat">＋ New</button>`;
  document.getElementById('pm-btn-add-cat').onclick=()=>openAddCategoryDialog('pm');
  container.querySelectorAll('.npm-cat-tile[data-cat]').forEach(tile=>{
    tile.addEventListener('contextmenu',e=>{e.preventDefault();openEditCategoryPopover(tile.dataset.catId,e,'pm');});
    let pressTimer;
    tile.addEventListener('pointerdown',()=>{pressTimer=setTimeout(()=>openEditCategoryPopover(tile.dataset.catId,{clientX:tile.getBoundingClientRect().left,clientY:tile.getBoundingClientRect().bottom},'pm'),600);});
    tile.addEventListener('pointerup',()=>clearTimeout(pressTimer));
    tile.addEventListener('pointerleave',()=>clearTimeout(pressTimer));
  });
}
function updatePmCatTiles(){ document.querySelectorAll('#pm-cat-tiles .npm-cat-tile[data-cat]').forEach(t=>t.classList.toggle('active',t.dataset.cat===PM.cat)); }
document.getElementById('pm-storage-btns').addEventListener('click',e=>{const b=e.target.closest('.pm-storage-btn');if(!b)return;PM.storage=b.dataset.storage;updatePmStorage();});
function updatePmStorage(){ document.querySelectorAll('.pm-storage-btn').forEach(b=>b.classList.toggle('active',b.dataset.storage===PM.storage)); }
async function pmPopulateIngredients(){
  const stocks=DB.get('inventory');
  document.getElementById('pm-ing-select').innerHTML='<option value="">-- Select Ingredient --</option>'+stocks.map(s=>`<option value="${s.id}" data-unit="${s.unit}" data-name="${s.name}">${s.name} (${s.unit})</option>`).join('');
  // Reset unit dropdown and wire change listener
  document.getElementById('pm-ing-unit').innerHTML = getUnitOptions('kg');
  document.getElementById('pm-ing-select').onchange = () => syncUnitSelect('pm-ing-select','pm-ing-unit');
}
document.getElementById('pm-btn-add-ing').addEventListener('click',()=>{
  const sel=document.getElementById('pm-ing-select'); const opt=sel.selectedOptions[0];
  if(!opt||!opt.value){showToast('Select an ingredient.','error');return;}
  const qty=parseFloat(document.getElementById('pm-ing-qty').value)||1;
  const unit=document.getElementById('pm-ing-unit').value;
  PM.recipe.push({id:opt.value,name:opt.dataset.name,qty,unit}); pmRenderRecipe();
});
function pmRenderRecipe(){
  const rows=document.getElementById('pm-recipe-rows');
  rows.innerHTML=PM.recipe.map((r,i)=>`<div class="npm-recipe-row"><span>${r.name}</span><span>${r.qty} ${r.unit} <button class="npm-rm" data-i="${i}">✕</button></span></div>`).join('');
  rows.querySelectorAll('.npm-rm').forEach(b=>b.addEventListener('click',()=>{PM.recipe.splice(+b.dataset.i,1);pmRenderRecipe();}));
}
document.getElementById('pm-btn-finalize').addEventListener('click',()=>{
  const name=document.getElementById('pm-item-name').value.trim();
  const price=parseFloat(document.getElementById('pm-price').value)||0;
  const qty=parseInt(document.getElementById('pm-qty').value)||1;
  if(!name){showToast('Item name required.','error');return;}
  if(price<=0){showToast('Price must be > 0.','error');return;}
  const icons={'Coffee & Espresso':'☕','Food':'🍛','Milktea':'🧋','Pastry':'🥐'};
  DB.push('products',{id:DB.uid(),name,emoji:icons[PM.cat]||'🥤',category:'Pre Made',base_price:price,has_temperature:0,has_size:0,has_addon:0,serving_var:'NONE',sizes_enabled:[],storage_type:PM.storage,batch_qty:qty,recipe:[...PM.recipe],created_at:new Date().toISOString()});
  // Deduct ingredients used to make this batch
  deductRecipeFromInventory(PM.recipe,qty);
  showToast('Premade product added.','success'); closeModal('modal-add-premade'); loadPremade();
});

// ═══════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
//  PROFILE — Save Display Name
// ═══════════════════════════════════════════════════
document.getElementById('btn-save-display-name').addEventListener('click', () => {
  const newName = document.getElementById('profile-display-name').value.trim();
  if(!newName){ showToast('Name cannot be empty.', 'error'); return; }
  const users = DB.get('users');
  const u = users.find(x => x.account_id === S.user.account_id);
  if(!u){ showToast('User not found.', 'error'); return; }
  u.name = newName;
  DB.set('users', users);
  S.user.name = newName;
  // Refresh sidebar & profile header
  document.getElementById('staff-name').textContent = newName;
  document.getElementById('profile-name-text').textContent = newName;
  showToast('Name updated successfully.', 'success');
});

// ═══════════════════════════════════════════════════
//  PROFILE — Change PIN
// ═══════════════════════════════════════════════════
document.getElementById('btn-change-pin').addEventListener('click',()=>{
  const cur=document.getElementById('current-pin').value.trim();
  const nw=document.getElementById('new-pin').value.trim();
  if(!cur||!nw){showToast('Fill in both PIN fields.','error');return;}
  if(!/^\d{4,6}$/.test(nw)){showToast('New PIN must be 4–6 digits.','error');return;}
  const users=DB.get('users'); const u=users.find(x=>x.account_id===S.user.account_id);
  if(!u||u.pin!==cur){showToast('Current PIN is incorrect.','error');return;}
  u.pin=nw; DB.set('users',users); S.user.pin=nw;
  showToast('PIN updated successfully.','success');
  document.getElementById('current-pin').value=''; document.getElementById('new-pin').value='';
});

// ═══════════════════════════════════════════════════
//  SIGN OUT
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
//  SIGN IN (sidebar button → records attendance clock-in)
// ═══════════════════════════════════════════════════
document.getElementById('btn-sign-in').addEventListener('click',async()=>{
  const today=todayStr();
  if(!await confirm('Clock In','Record clock-in for now?')) return;
  DB.push('attendance',{id:DB.uid(),account_id:S.user.account_id,name:S.user.name,date:today,clock_in:nowTime(),clock_out:null});
  DB.push('system_log',{id:DB.uid(),account_id:S.user.account_id,name:S.user.name,date:today,sign_in:nowTime(),sign_out:null});
  showToast(`Clocked in at ${nowTime()}`,'success');
  if(document.querySelector('.page[data-page="attendance"].active')) renderAttendance();
});

// ═══════════════════════════════════════════════════
//  SIGN OUT (profile page button)
// ═══════════════════════════════════════════════════
document.getElementById('btn-sign-out').addEventListener('click',async()=>{
  if(!await confirm('Sign Out','Are you sure you want to sign out?')) return;
  // Record sign-out in system log
  const logs=DB.get('system_log',[]);
  const openEntry=logs.slice().reverse().find(l=>l.account_id===S.user.account_id&&!l.sign_out);
  if(openEntry){ openEntry.sign_out=nowTime(); DB.set('system_log',logs); }
  S.user=null; S.orderItems=[]; S.products=[];
  localStorage.removeItem('syncpos_session');
  document.getElementById('account-id').value=''; document.getElementById('pin').value='';
  document.getElementById('login-error').hidden=true;
  closeCatPopover(); document.querySelectorAll('dialog[open]').forEach(d=>closeModal(d.id)); showScreen('screen-login');
});

// ═══════════════════════════════════════════════════
//  MODAL HELPERS
// ═══════════════════════════════════════════════════
document.querySelectorAll('.modal-close,[data-close]').forEach(btn=>{
  btn.addEventListener('click',()=>{ const t=btn.dataset.close||btn.closest('dialog')?.id; if(t) closeModal(t); });
});
document.querySelectorAll('dialog').forEach(d=>{
  d.addEventListener('cancel',e=>{e.preventDefault();closeModal(d.id);});
  d.addEventListener('click',e=>e.stopPropagation());
});
document.getElementById('modal-backdrop').addEventListener('click',()=>{
  document.querySelectorAll('dialog[open]').forEach(d=>closeModal(d.id));
});

// ═══════════════════════════════════════════════════
//  AUTO CLOCK-IN AFTER LOGIN
// ═══════════════════════════════════════════════════
const _realInitPOS=initPOS;
// Clock-in is now triggered manually via the "Sign In" button in the sidebar.

// ═══════════════════════════════════════════════════
//  CATEGORY EDITOR
// ═══════════════════════════════════════════════════
const CAT_EMOJIS = ['☕','🍵','🧋','🥐','🥤','🍛','🍰','🧁','🍩','🥗','🥪','🍜','🍣','🍦','🎂','🥞','🍺','🧃','🥤','🫖','🍷','🫗','🍫','🍬','🥜','🌮','🍔','🌯','🥙','🍕'];

let _catEditorState = {id:null, context:null};

function openAddCategoryDialog(context){
  _catEditorState = {id:null, context};
  document.getElementById('cat-edit-name').value='';
  document.getElementById('cat-edit-emoji-custom').value='';
  renderCatEmojiGrid('☕');
  showCatPopover(null, context);
}

function openEditCategoryPopover(catId, anchorEvt, context){
  const cats = DB.get('categories',[]);
  const cat = cats.find(c=>c.id===catId); if(!cat) return;
  _catEditorState = {id:catId, context};
  document.getElementById('cat-edit-name').value = cat.name;
  document.getElementById('cat-edit-emoji-custom').value = '';
  renderCatEmojiGrid(cat.emoji);
  showCatPopover(anchorEvt, context);
}

function renderCatEmojiGrid(selected){
  const grid = document.getElementById('cat-emoji-grid');
  grid.innerHTML = CAT_EMOJIS.map(e=>`<button type="button" class="cat-emoji-btn${e===selected?' selected':''}" data-emoji="${e}">${e}</button>`).join('');
  grid.querySelectorAll('.cat-emoji-btn').forEach(b=>{
    b.onclick=()=>{
      grid.querySelectorAll('.cat-emoji-btn').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      document.getElementById('cat-edit-emoji-custom').value='';
    };
  });
}

function getSelectedEmoji(){
  const custom = document.getElementById('cat-edit-emoji-custom').value.trim();
  if(custom) return custom;
  const sel = document.querySelector('#cat-emoji-grid .cat-emoji-btn.selected');
  return sel ? sel.dataset.emoji : '☕';
}

function showCatPopover(anchorEvt, context){
  const pop = document.getElementById('cat-edit-popover');
  const bk  = document.getElementById('cat-popover-backdrop');
  bk.style.display = 'block';
  if(anchorEvt){
    const margin = 8;
    const pw = 260, ph = 320;
    let x = anchorEvt.clientX + margin;
    let y = anchorEvt.clientY + margin;
    if(x + pw > window.innerWidth)  x = window.innerWidth - pw - margin;
    if(y + ph > window.innerHeight) y = window.innerHeight - ph - margin;
    pop.style.left = x + 'px';
    pop.style.top  = y + 'px';
    pop.style.transform = '';
  } else {
    pop.style.left = '50%';
    pop.style.top  = '50%';
    pop.style.transform = 'translate(-50%,-50%)';
  }
  if(!pop.open){ pop.showModal(); }
}

function closeCatPopover(){
  const pop = document.getElementById('cat-edit-popover');
  if(pop.open) pop.close();
  document.getElementById('cat-popover-backdrop').style.display = 'none';
  pop.style.transform = '';
}

function refreshBothCatTiles(){
  renderNpmCatTiles();
  renderPmCatTiles();
}

document.getElementById('cat-popover-save').addEventListener('click',()=>{
  const name = document.getElementById('cat-edit-name').value.trim();
  if(!name){showToast('Category name required.','error');return;}
  const emoji = getSelectedEmoji();
  let cats = DB.get('categories',[]);
  if(_catEditorState.id){
    // Edit existing
    const cat = cats.find(c=>c.id===_catEditorState.id);
    if(cat){ cat.name=name; cat.emoji=emoji; }
  } else {
    // Add new — key = name (used to match products)
    cats.push({id:DB.uid(), name, emoji, key:name});
  }
  DB.set('categories', cats);
  closeCatPopover();
  refreshBothCatTiles();
  showToast(_catEditorState.id ? 'Category updated.' : 'Category added.','success');
});

document.getElementById('cat-popover-del').addEventListener('click',async()=>{
  if(!_catEditorState.id) return;
  if(!await confirm('Delete Category','Delete this category? Products using it will keep their category label.')) return;
  let cats = DB.get('categories',[]);
  cats = cats.filter(c=>c.id!==_catEditorState.id);
  DB.set('categories', cats);
  closeCatPopover();
  refreshBothCatTiles();
  showToast('Category deleted.','success');
});

document.getElementById('cat-popover-cancel').addEventListener('click', closeCatPopover);
document.getElementById('cat-popover-backdrop').addEventListener('click', closeCatPopover);
document.getElementById('cat-edit-popover').addEventListener('click', e => { if(e.target === document.getElementById('cat-edit-popover')) closeCatPopover(); });
document.getElementById('cat-edit-popover').addEventListener('click', function(e){ if(e.target === this) closeCatPopover(); });
// ═══════════════════════════════════════════════════
//  INDIVIDUAL SALES PERFORMANCE
// ═══════════════════════════════════════════════════
let _ispPeriod = 'daily';

function loadSalesPerformance(){
  renderIspList();
  setupIspDropdown();
}

function setupIspDropdown(){
  const btn = document.getElementById('isp-period-btn');
  const dd  = document.getElementById('isp-dropdown');
  btn.onclick = (e)=>{ e.stopPropagation(); dd.hidden = !dd.hidden; };
  document.addEventListener('click', ()=>{ dd.hidden=true; }, {capture:false});
  dd.querySelectorAll('.isp-dd-item').forEach(item=>{
    item.onclick = ()=>{
      _ispPeriod = item.dataset.period;
      document.getElementById('isp-period-label').textContent = item.textContent.trim();
      dd.querySelectorAll('.isp-dd-item').forEach(x=>x.classList.remove('active'));
      item.classList.add('active');
      dd.hidden = true;
      renderIspList();
    };
  });
}

function getIspDateRange(period){
  const now = new Date();
  let start;
  if(period==='daily'){
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if(period==='weekly'){
    const day = now.getDay();
    start = new Date(now); start.setDate(now.getDate()-day); start.setHours(0,0,0,0);
  } else if(period==='monthly'){
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }
  return start;
}

function renderIspList(){
  const orders  = DB.get('orders');
  const users   = DB.get('users');
  const start   = getIspDateRange(_ispPeriod);
  const filtered = orders.filter(o=> new Date(o.created_at) >= start);

  // Aggregate by cashier
  const map = {};
  filtered.forEach(o=>{
    const id = o.cashier_id || o.cashier_name || '—';
    if(!map[id]) map[id] = {cashier_id:id, cashier_name:o.cashier_name||id, total:0, orders:[]};
    map[id].total += o.total;
    map[id].orders.push(o);
  });

  const entries = Object.values(map).sort((a,b)=>b.total-a.total);
  const grandTotal = entries.reduce((s,e)=>s+e.total,0);

  const rankClass = i => i===0?'':i===1?'rank-2':i===2?'rank-3':'rank-n';
  const rankLabel = i => i===0?'1st':i===1?'2nd':i===2?'3rd':`${i+1}th`;

  const container = document.getElementById('isp-employee-list');
  if(!entries.length){
    container.innerHTML='<p class="empty-state" style="padding:40px;text-align:center">No sales found for this period.</p>';
    document.getElementById('isp-grand-total').textContent = peso(0);
    return;
  }

  container.innerHTML = entries.map((e,i)=>{
    const initial = (e.cashier_name||'?').charAt(0).toUpperCase();
    const user = users.find(u=>u.account_id===e.cashier_id);
    const role = user ? user.role : 'staff';
    return `<div class="isp-employee-card" data-cashier-id="${e.cashier_id}">
      <div class="isp-rank-badge ${rankClass(i)}">${rankLabel(i)}</div>
      <div class="isp-avatar">${initial}</div>
      <div class="isp-info">
        <div class="isp-name">${e.cashier_name}</div>
        <div class="isp-meta">${role.charAt(0).toUpperCase()+role.slice(1)} &nbsp; ${e.cashier_id}</div>
      </div>
      <div class="isp-sales-col">
        <div class="isp-sales-amt">${peso(e.total)}</div>
        <div class="isp-orders-cnt">${e.orders.length} ORDER${e.orders.length!==1?'S':''}</div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('isp-grand-total').textContent = peso(grandTotal);

  // Click handlers → open detail
  container.querySelectorAll('.isp-employee-card').forEach(card=>{
    card.addEventListener('click', ()=>{
      const cid = card.dataset.cashierId;
      const entry = entries.find(e=>e.cashier_id===cid);
      if(entry) openSalesDetail(entry);
    });
  });
}

// ── Sales Detail Modal ─────────────────────────────
function openSalesDetail(entry){
  document.getElementById('modal-sd-title').textContent = `Sales Detail — ${entry.cashier_name}`;
  renderSalesDetailBody(entry, '');
  openModal('modal-sales-detail');
}

function renderSalesDetailBody(entry, searchQuery){
  const orders = entry.orders.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const total = entry.total;
  const avgHandover = orders.length ? total/orders.length : 0;
  const voidOrders = 0; // no void tracking yet
  const initial = (entry.cashier_name||'?').charAt(0).toUpperCase();

  // Hourly chart — last 24 hours buckets
  const hourBuckets = Array(24).fill(0);
  orders.forEach(o=>{
    const h = new Date(o.created_at).getHours();
    hourBuckets[h]++;
  });
  const maxBucket = Math.max(...hourBuckets, 1);
  const now = new Date().getHours();
  const chartBars = hourBuckets.map((cnt,h)=>{
    const pct = Math.round((cnt/maxBucket)*100);
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center">
      <div class="sd-chart-bar${h===now?' active':''}" style="height:${Math.max(pct,2)}%"></div>
      ${h%6===0?`<div class="sd-chart-bar-label">${h}h</div>`:'<div style="height:14px"></div>'}
    </div>`;
  }).join('');

  // Transaction table
  const filtered = searchQuery
    ? orders.filter(o=>(o.order_id||'').toLowerCase().includes(searchQuery.toLowerCase()))
    : orders;

  const rows = filtered.map(o=>{
    const dt = new Date(o.created_at);
    const timeStr = dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const dateStr = dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const itemsSummary = (o.items||[]).map(i=>`${i.price&&o.items.length===1?'8x ':'' }${i.name}`).join(', ') || '—';
    // Better items label
    const itemsLabel = (o.items||[]).map(it=>{
      const qty = 1;
      return `${qty}x ${it.name}`;
    }).join(', ');
    return `<tr>
      <td style="font-size:.75rem;color:var(--text-muted);white-space:nowrap">${timeStr}<br>${dateStr}</td>
      <td><span class="sd-order-id-link" data-order-id="${o.id}">#${o.order_id||'—'}</span></td>
      <td style="font-size:.8rem">${itemsLabel}</td>
      <td style="font-weight:700">${peso(o.total)}</td>
      <td style="color:var(--green)">${peso(o.cash_tendered)}</td>
      <td>${peso(Math.max(0,o.cash_tendered-o.total))}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="empty-state">No transactions found.</td></tr>`;

  document.getElementById('modal-sd-body').innerHTML = `
    <!-- Employee header card -->
    <div class="sd-header-card">
      <div class="isp-rank-badge">1st</div>
      <div class="isp-avatar">${initial}</div>
      <div class="isp-info">
        <div class="isp-name">${entry.cashier_name}</div>
        <div class="isp-meta">Admin &nbsp; ${entry.cashier_id}</div>
      </div>
      <div class="isp-sales-col">
        <div class="isp-sales-amt">${peso(total)}</div>
        <div class="isp-orders-cnt">${orders.length} ORDER${orders.length!==1?'S':''}</div>
      </div>
    </div>

    <!-- Session performance -->
    <div class="sd-session-card">
      <div class="sd-session-label">SESSION PERFORMANCE</div>
      <div class="sd-session-total">${peso(total)}</div>
      <div class="sd-session-metas">
        <div class="sd-session-meta-box"><span>AVG HANDOVER</span>${peso(avgHandover)}</div>
        <div class="sd-session-meta-box"><span>VOID ORDERS</span>${voidOrders}</div>
      </div>
    </div>

    <!-- Hourly chart -->
    <div class="sd-chart-card">
      <div class="sd-chart-title">Order Volume Transparency (Hourly)</div>
      <div class="sd-chart-bars" style="height:80px;align-items:flex-end;display:flex;gap:2px">${chartBars}</div>
    </div>

    <!-- Transaction log -->
    <div class="sd-txn-card">
      <div class="sd-txn-header">
        <div>
          <div class="sd-txn-title">🗒️ Detailed Transaction Log</div>
          <div class="sd-txn-sub">FULL VISIBILITY OF EVERY ₱ MOVED</div>
        </div>
        <input class="sd-txn-search" id="sd-search" placeholder="🔍 Search Order ID..." value="${searchQuery}">
      </div>
      <table class="sd-txn-table">
        <thead><tr><th>Timestamp</th><th>Order ID</th><th>Items</th><th>Total</th><th>Cash</th><th>Change</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  // Search handler — re-render filtered
  document.getElementById('sd-search').addEventListener('input', e=>{
    renderSalesDetailBody(entry, e.target.value.trim());
    // preserve scroll
  });

  // Order ID click → receipt preview
  document.querySelectorAll('.sd-order-id-link').forEach(link=>{
    link.addEventListener('click', ()=>{
      const orderId = link.dataset.orderId;
      const order = DB.get('orders').find(o=>o.id===orderId);
      if(order) openInvoicePreview(order);
    });
  });
}

// ── Invoice Preview ────────────────────────────────
function openInvoicePreview(sale){
  const meta = {
    cashier: sale.cashier_name,
    cashierId: sale.cashier_id,
    orderCodeAlpha: sale.order_id,
    orderQueue: sale.order_queue,
    orderType: sale.order_type || 'dine_in',
    totalDiscount: sale.discount_amount||0,
    customDiscounts: sale.custom_discounts||[],
    discountType: sale.discount_type,
    discountAmount: sale.discount_amount||0,
    convFee: sale.conv_fee||0,
  };
  const sub = (sale.items||[]).reduce((s,i)=>s+i.price,0);
  const td = sale.discount_amount||0;
  const cf = sale.conv_fee||0;
  const change = Math.max(0, sale.cash_tendered - sale.total);

  // Build receipt HTML (reusing existing renderReceipt structure)
  const now = new Date(sale.created_at);
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2,'0');
  const min = String(now.getMinutes()).padStart(2,'0');
  const dateStr = `${mm}/${dd}/${yyyy}`;
  const timeStr = `${hh}:${min}`;
  const queueCode = sale.order_queue||'——';
  const rawId = String(sale.order_id||'').replace(/\D/g,'');
  const siNum = 'SI#'+rawId.padStart(8,'0');
  const orderTypeLabel = {dine_in:'DINE IN',takeout:'TAKE OUT',online:'ONLINE ORDER'}[sale.order_type||'dine_in']||'DINE IN';

  const groupedItems=(()=>{
    const map=new Map();
    (sale.items||[]).forEach(i=>{
      const key=`${i.name}|${i.temperature||''}|${i.size||''}|${(i.addons||[]).join(',')}`;
      if(map.has(key)){const e=map.get(key);e.qty++;e.totalPrice+=Number(i.price);}
      else map.set(key,{...i,qty:1,totalPrice:Number(i.price)});
    });
    return [...map.values()];
  })();
  const items = groupedItems.map(i=>{
    const d=[i.temperature,i.size,...(i.addons||[])].filter(Boolean);
    let html=`<div class="rcp-item-row"><span class="rcp-item-qty">${i.qty}</span><span class="rcp-item-name">${i.name.toUpperCase()}</span><span class="rcp-item-price">${i.totalPrice.toFixed(2)}</span></div>`;
    d.forEach(a=>{html+=`<div class="rcp-addon-row"><span class="rcp-addon-indent"> </span><span class="rcp-addon-name">${a.toUpperCase()}</span><span></span></div>`;});
    return html;
  }).join('');

  const totalItems = (sale.items||[]).reduce((s,i)=>s+(i.qty||1),0);

  document.getElementById('invoice-preview-body').innerHTML = `
<div class="rcp-wrap">
  <div class="rcp-header">
    <div class="rcp-steam">
      <svg width="64" height="22" viewBox="0 0 64 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 18 Q16 10 18 18 Q20 10 22 18" stroke="#4a6228" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M29 18 Q31 10 33 18 Q35 10 37 18" stroke="#4a6228" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M44 18 Q46 10 48 18 Q50 10 52 18" stroke="#4a6228" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="rcp-cup">
      <svg width="72" height="52" viewBox="0 0 72 52" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 8 Q8 44 18 48 Q27 52 36 52 Q45 52 54 48 Q64 44 66 8 Z" fill="#4a6228"/>
        <path d="M66 16 Q78 18 76 28 Q74 36 66 34" stroke="#4a6228" stroke-width="3.5" fill="none" stroke-linecap="round"/>
        <rect x="10" y="50" width="52" height="5" rx="2.5" fill="#4a6228"/>
      </svg>
    </div>
    <div class="rcp-brand-name"><em>26th</em><span>2</span></div>
    <div class="rcp-est-line">—EST— <strong>cafe</strong> —2023—</div>
    <p class="rcp-tagline">Your handpicked happiness for coffee, matcha and more</p>
    <div class="rcp-divider-dash"></div>
    <p class="rcp-address">Graceland 1 Subdivision,<br>Buaya, Lapu-Lapu City, Cebu</p>
    <p class="rcp-address">Order-No: ${sale.order_id||'000000'}</p>
    <p class="rcp-queue-code">${queueCode}</p>
    <p class="rcp-invoice-title">SALES INVOICE</p>
    <p class="rcp-cashier">Cashier: ${sale.cashier_name||'—'}</p>
    <div class="rcp-divider-dash"></div>
    <div class="rcp-meta-bar">
      <span>${dateStr}</span><span>${timeStr}</span><span>${String(queueCode)||'——'}</span><span class="rcp-si">${siNum}</span>
    </div>
    <div class="rcp-divider-dash"></div>
    <div class="rcp-type-bar">------------ ${orderTypeLabel} ------------</div>
    <div class="rcp-divider-dash"></div>
  </div>
  <div class="rcp-items">${items}</div>
  <div class="rcp-divider-dash"></div>
  <div class="rcp-summary">
    <div class="rcp-summary-row"><span>${totalItems} Item(s)</span><span>Subtotal &nbsp;${sub.toFixed(2)}</span></div>
    ${td>0?`<div class="rcp-summary-row"><span>Discount</span><span>— ${td.toFixed(2)}</span></div>`:''}
    ${cf>0?`<div class="rcp-summary-row"><span>Conv. Fee</span><span>${cf.toFixed(2)}</span></div>`:''}
    <div class="rcp-total-row"><span>TOTAL DUE</span><span>${sale.total.toFixed(2)}</span></div>
    <div class="rcp-summary-row" style="margin-top:6px"><span>Cash</span><span>${sale.cash_tendered.toFixed(2)}</span></div>
    <div class="rcp-summary-row"><span>Change</span><span>${change.toFixed(2)}</span></div>
  </div>
  <div class="rcp-divider-dash" style="margin:14px 0"></div>
  <p class="rcp-footer">Receipt Issued: ${dateStr}</p>
</div>
<div style="padding:0 0 14px;display:flex;justify-content:center">
  <button class="btn btn-outline" data-close="modal-invoice-preview" style="min-width:160px">✕ CLOSE</button>
</div>`;

  // Wire up close button inside body
  document.querySelector('#invoice-preview-body [data-close]')?.addEventListener('click',()=>closeModal('modal-invoice-preview'));

  openModal('modal-invoice-preview');
}

// ─── DB preload + Session restore ────────────────────────────
(async function initApp() {
  try {
    // Show loading overlay while Firestore data is fetched
    const overlay = document.getElementById('db-loading-overlay');
    if (overlay) overlay.style.display = 'flex';

    await DB.preload();

    // Try to restore session from localStorage token
    let restored = false;
    try {
      const raw = localStorage.getItem("syncpos_session");
      if (raw) {
        const token = JSON.parse(raw);
        const found = DB.get("users").find(
          u => u.account_id === token.account_id && u.pin === token.pin
        );
        if (found) {
          window.S.user = found;
          initPOS();
          showScreen("screen-pos");
          restored = true;
        } else {
          localStorage.removeItem("syncpos_session");
        }
      }
    } catch (err) {
      console.warn("Session restore failed:", err);
      localStorage.removeItem("syncpos_session");
    }

    if (!restored) showScreen("screen-login");
  } catch (err) {
    console.error("DB preload failed:", err);
    showScreen("screen-login");
  } finally {
    const overlay = document.getElementById('db-loading-overlay');
    if (overlay) { overlay.style.display = 'none'; overlay.remove(); }
  }
})();