/* SFF Početna – prijateljski zid i društvene objave na Androidu i Windows-u. */
(() => {
  "use strict";
  const html = (v) => String(v ?? "").replace(/[&<>"']/g,
    (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[ch]);
  const api = async (action, body={}) => {
    const r = await fetch("/api/"+action, {
      method:"POST",headers:{"Content-Type":"application/json"},
      credentials:"same-origin",body:JSON.stringify(body),
    });
    const v = await r.json();
    if (!r.ok) throw Error(v.error || "Nije moguće učitati podatke.");
    return v;
  };
  let root=null, opened=false, account=null, feed=[], author=null, authorInfo=null;
  let composerImage=null, composerPreview=null, loading=false, busy=false;
  let commentOpen=new Set(), sharePost=null, changeTimer=null, lastHash=null;
  const time = (stamp) => new Date(Number(stamp)).toLocaleString("sr-RS", {
    day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"
  });
  const photo = (id, shape="avatar") =>
    "/art/user/"+Number(id)+"/"+shape;
  const initials = (name) => html((name || "S").slice(0,1).toUpperCase());
  const showError = (err) => {
    let el=document.querySelector("#sffWallError");
    if(!el){el=document.createElement("div");el.id="sffWallError";document.body.appendChild(el)}
    el.textContent=String(err?.message||err);
    el.classList.add("visible");
    clearTimeout(showError.timer);
    showError.timer=setTimeout(()=>el.classList.remove("visible"),4400);
  };
  function ensure() {
    if(root)return root;
    root=document.createElement("div");
    root.id="sffWallScreen";
    root.hidden=true;
    document.body.appendChild(root);
    return root;
  }
  function avatar(uid,name){
    return '<span class="sffWallAvatar"><span>'+initials(name)+'</span>'+
      '<img src="'+photo(uid)+'" alt="" loading="lazy" onerror="this.remove()"></span>';
  }
  const previewText=(text)=>html(text).replace(/\n/g,"\n");
  async function identity(){
    if(!account)account=(await api("state"));
    return account;
  }
  function footer(){
    return '<div class="sffWallFooter">SFF · Tvoja zajednica, tvoja priča.</div>';
  }
  function shell(){
    const my=account.me, own=author===my.id;
    const title=author===null?"Početna":own?"Moj zid":"Zid korisnika "+html(authorInfo?.name||"");
    ensure().innerHTML=
      '<header class="sffWallTop"><div class="sffWallBrand">'+
        '<img src="/mark.svg" alt="SFF">'+
        '<div><strong>SFF</strong><small>DRUŠTVENA MREŽA</small></div></div>'+
        '<div class="sffWallTopActions">'+
          '<button type="button" data-wall-feed class="sffWallTopButton">⌂ <span>Početna</span></button>'+
          '<button type="button" data-wall-my class="sffWallTopButton">◉ <span>Moj zid</span></button>'+
          '<button type="button" data-social-center class="sffWallTopButton" title="Obaveštenja">🔔</button>'+
          '<button type="button" data-wall-close class="sffWallClose">✕ <span>Razgovori</span></button>'+
        '</div></header>'+
      '<div class="sffWallLayout"><aside class="sffWallAside">'+
        '<div class="sffWallMe">'+avatar(my.id,my.name)+
          '<div><b>'+html(my.name)+'</b><small>@'+html(my.username)+'</small></div></div>'+
        '<button type="button" data-wall-feed class="'+(author===null?"selected":"")+'">⌂ Početna</button>'+
        '<button type="button" data-wall-my class="'+(own?"selected":"")+'">◉ Moj zid</button>'+
        '<button type="button" data-social-center>🔔 Obaveštenja</button>'+
        '<div class="sffWallRule"><b>Privatnost objava</b>'+
          '<p>Tvoje objave vide samo potvrđeni prijatelji. Oni mogu da ih lajkuju i komentarišu.</p></div>'+
      '</aside>'+
      '<main class="sffWallMain"><div class="sffWallHeading">'+
        (author===null
          ? '<span class="sffWallEyebrow">ŠTA JE NOVO?</span><h1>Početna</h1>'+
            '<p>Objave tebe i tvojih prijatelja.</p>'
          : '<div class="sffWallWallHeader">'+avatar(author,authorInfo?.name)+
            '<div><span class="sffWallEyebrow">LIČNI ZID</span><h1>'+html(title)+'</h1>'+
            '<p>@'+html(authorInfo?.username||my.username)+'</p></div></div>')+
      '</div>'+
      ((author===null||own)
        ? '<form id="sffWallComposer" class="sffWallComposer">'+
          '<div class="sffWallComposeHead">'+avatar(my.id,my.name)+
            '<div><b>'+html(my.name)+'</b><small>Za tvoje prijatelje</small></div></div>'+
          '<textarea name="body" maxlength="2500" rows="3" placeholder="Šta ima novo? Podeli nešto sa prijateljima…"></textarea>'+
          '<div class="sffWallFilePreview" id="sffWallFilePreview"></div>'+
          '<div class="sffWallComposerActions"><label class="sffWallImagePick">📷 Dodaj fotografiju'+
            '<input type="file" id="sffWallImageInput" accept="image/png,image/jpeg" hidden></label>'+
            '<button type="submit" class="sffWallPrimary">Objavi</button></div></form>'
        : '<div class="sffWallPrivacy"><span>🔒</span> Objave ovog prijatelja.</div>')+
      '<div id="sffWallFeed" class="sffWallFeed"><p class="sffWallLoading">Učitavanje objava…</p></div>'+
      '<button type="button" id="sffWallMore" data-wall-more hidden>Učitaj starije objave</button>'+
      footer()+'</main></div>';
  }
  async function load(reset=true){
    if(loading||!opened)return;
    loading=true;
    const previous=feed;
    try{
      const before=reset?undefined:feed.at(-1)?.id;
      const response=await api("wallFeed",{user:author??undefined,before});
      feed=reset?response.posts:[...previous,...response.posts];
      draw();
      const more=document.querySelector("#sffWallMore");
      if(more)more.hidden=response.posts.length<16;
    }catch(err){if(reset){feed=[];draw()}showError(err)}
    finally{loading=false}
  }
  function postCard(p){
    const own=p.uid===account.me.id;
    const liked=Number(p.liked)>0;
    return '<article class="sffWallPost" data-wall-post="'+Number(p.id)+'">'+
      '<header class="sffWallPostHead">'+
        '<button type="button" class="sffWallAuthor" data-wall-user="'+Number(p.uid)+'">'+
          avatar(p.uid,p.name)+'<span><b>'+html(p.name)+'</b><small>@'+
          html(p.username)+' · '+html(time(p.created))+'</small></span></button>'+
        (own?'<button type="button" class="sffWallDelete" data-wall-delete="'+p.id+
          '" title="Obriši svoju objavu">⋯</button>':'')+
      '</header>'+
      (p.body?'<p class="sffWallText">'+previewText(p.body)+'</p>':'')+
      (p.image?'<img src="/wall-media/'+Number(p.id)+'" alt="Fotografija iz objave" class="sffWallPhoto" loading="lazy">':'')+
      '<div class="sffWallCounts"><span>♥ '+Number(p.likes||0)+' sviđanja</span><span>'+
        Number(p.comments||0)+' komentara</span></div>'+
      '<div class="sffWallPostActions">'+
        '<button type="button" data-wall-like="'+p.id+'" class="'+(liked?"liked":"")+'">'+
          (liked?"♥ Sviđa mi se":"♡ Sviđa mi se")+'</button>'+
        '<button type="button" data-wall-comments="'+p.id+'">▤ Komentari</button>'+
        '<button type="button" data-wall-share="'+p.id+'">↗ Pošalji u chat</button>'+
      '</div><section class="sffWallComments" data-wall-comment-section="'+p.id+'" '+
        (commentOpen.has(p.id)?"":"hidden")+'> '+
        '<div class="sffWallCommentsList" data-wall-comment-list="'+p.id+'"></div>'+
        '<form class="sffWallCommentForm" data-wall-comment-form="'+p.id+'">'+
          '<input name="comment" required maxlength="600" placeholder="Napiši komentar…" autocomplete="off">'+
          '<button type="submit">Pošalji</button></form>'+
      '</section></article>';
  }
  function draw(){
    const el=document.querySelector("#sffWallFeed");if(!el)return;
    if(!feed.length){el.innerHTML=
      '<div class="sffWallEmpty"><span>✦</span><h2>Još nema objava</h2>'+
      '<p>Ovde će se pojaviti tvoje objave i objave prijatelja. Napiši prvu objavu ili dodaj prijatelje.</p></div>';
      return;
    }
    el.innerHTML=feed.map(postCard).join("");
    for(const id of commentOpen)loadComments(id).catch(showError);
  }
  async function loadComments(id){
    const section=document.querySelector('[data-wall-comment-list="'+id+'"]');
    if(!section)return;
    section.innerHTML='<p class="sffWallLoading">Učitavanje komentara…</p>';
    const data=await api("wallComments",{id});
    section.innerHTML=data.comments.length?data.comments.reverse().map(c=>
      '<div class="sffWallComment">'+avatar(c.uid,c.name)+
      '<div><b>'+html(c.name)+'</b><small>'+html(time(c.created))+'</small>'+
      '<p>'+previewText(c.body)+'</p></div>'+
      ((c.uid===account.me.id || feed.find(x=>x.id===id)?.uid===account.me.id)
        ? '<button type="button" data-wall-comment-delete="'+c.id+'" title="Obriši komentar">×</button>':'')+
      '</div>').join(""):'<p class="sffWallNoComments">Budi prvi koji će komentarisati.</p>';
  }
  async function open(authorId=null){
    const user=await identity();
    if(!user?.me?.id)return;
    const requested=authorId===null?null:Number(authorId);
    let p=null;
    if(requested!==null){
      p=requested===user.me.id?user.me:await api("userProfile",{id:requested});
    }
    author=requested;authorInfo=p;
    feed=[];commentOpen.clear();composerImage=null;composerPreview=null;
    opened=true;ensure().hidden=false;document.body.classList.add("sffWallOpen");
    shell();await load();
    ensure().scrollTop=0;
  }
  async function openPost(postId){
    await open(null);
    const item=await api("wallOne",{id:Number(postId)});
    author=null;authorInfo=null;
    if(!feed.some(x=>x.id===item.id))feed.unshift(item);
    draw();
    const el=document.querySelector('[data-wall-post="'+Number(postId)+'"]');
    el?.scrollIntoView({block:"center",behavior:"smooth"});
  }
  function close(){
    opened=false;ensure().hidden=true;document.body.classList.remove("sffWallOpen");
    const share=document.querySelector("#sffWallShare");
    if(share?.open)share.close();
    if(location.hash.startsWith("#objava="))
      history.replaceState(null,"",location.pathname+location.search);
  }
  async function share(id){
    sharePost=id;
    const st=await identity(),p=await api("wallOne",{id});
    const choices=st.friends.filter(f=>f.accepted);
    let dlg=document.querySelector("#sffWallShare");
    if(!dlg){dlg=document.createElement("dialog");dlg.id="sffWallShare";document.body.appendChild(dlg)}
    dlg.innerHTML='<h2>Pošalji objavu u razgovor</h2>'+
      '<p>Izaberi prijatelja kome želiš poslati objavu korisnika @'+html(p.username)+'.</p>'+
      (choices.length?'<form data-wall-share-form>'+
        '<label>Prijatelj<select name="target" required>'+
        choices.map(f=>'<option value="'+Number(f.id)+'">'+html(f.name)+' (@'+html(f.username)+')</option>').join("")+
        '</select></label><div class="sffWallShareActions">'+
        '<button type="button" data-wall-share-close>Otkaži</button>'+
        '<button type="submit" class="sffWallPrimary">Pošalji u chat</button></div></form>':
        '<p>Još nemaš potvrđene prijatelje kojima možeš poslati objavu.</p>'+
        '<button type="button" data-wall-share-close>Zatvori</button>');
    if(!dlg.open)dlg.showModal();
  }
  async function upload(file){
    if(!file)return;
    if(!["image/png","image/jpeg"].includes(file.type)||file.size>1024*1024){
      throw Error("Dodaj JPG ili PNG fotografiju do 1 MB.");
    }
    const src=await new Promise((resolve,reject)=>{
      const r=new FileReader();
      r.onload=()=>resolve(String(r.result));
      r.onerror=()=>reject(Error("Fotografija nije mogla da se učita."));
      r.readAsDataURL(file);
    });
    composerImage=src.split(",")[1];composerPreview=src;
    const display=document.querySelector("#sffWallFilePreview");
    if(display)display.innerHTML='<div><img src="'+src+'" alt="Izabrana fotografija">'+
      '<button type="button" data-wall-remove-image>Ukloni sliku ×</button></div>';
  }
  async function refreshFromServer(){
    if(!opened||busy)return;
    clearTimeout(changeTimer);
    changeTimer=setTimeout(()=>load(true),900);
  }
  // The existing application owns websocket auth/reconnect; only observe changes.
  const ExistingWebSocket=window.WebSocket;
  class WallSocket extends ExistingWebSocket {
    constructor(...args){
      super(...args);
      this.addEventListener("message",(event)=>{
        try{if(JSON.parse(event.data).type==="wall_changed")refreshFromServer()}catch{}
      });
    }
  }
  window.WebSocket=WallSocket;

  document.addEventListener("click",async(event)=>{
    const button=event.target.closest(
      "[data-sff-home],[data-wall-feed],[data-wall-my],[data-wall-close],"+
      "[data-wall-user],[data-wall-like],[data-wall-comments],[data-wall-share],"+
      "[data-wall-delete],[data-wall-comment-delete],[data-wall-remove-image],"+
      "[data-wall-more],[data-wall-share-close],[data-wall-profile]");
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    try{
      if(button.hasAttribute("data-wall-close"))return close();
      if(button.hasAttribute("data-wall-feed")||button.hasAttribute("data-sff-home"))return await open(null);
      if(button.hasAttribute("data-wall-my"))return await open((await identity()).me.id);
      if(button.hasAttribute("data-wall-user"))return await open(Number(button.dataset.wallUser));
      if(button.hasAttribute("data-wall-profile")){
        document.querySelector("#dialog")?.close();
        return await open(Number(button.dataset.wallProfile));
      }
      if(button.hasAttribute("data-wall-share-close"))return document.querySelector("#sffWallShare")?.close();
      if(button.hasAttribute("data-wall-more"))return await load(false);
      if(button.hasAttribute("data-wall-remove-image")){
        composerImage=null;composerPreview=null;
        const el=document.querySelector("#sffWallFilePreview");if(el)el.innerHTML="";
        const input=document.querySelector("#sffWallImageInput");if(input)input.value="";
        return;
      }
      if(button.hasAttribute("data-wall-share"))return await share(Number(button.dataset.wallShare));
      if(button.hasAttribute("data-wall-delete")){
        if(confirm("Obrisati ovu objavu i sve njene komentare?")){
          await api("wallDelete",{id:Number(button.dataset.wallDelete)});
          await load(true);
        }return;
      }
      if(button.hasAttribute("data-wall-like")){
        await api("wallLike",{id:Number(button.dataset.wallLike)});
        const el=document.querySelector('[data-wall-post="'+button.dataset.wallLike+'"]');
        const item=await api("wallOne",{id:Number(button.dataset.wallLike)});
        feed=feed.map(p=>p.id===item.id?item:p);
        if(el)el.outerHTML=postCard(item);
        if(commentOpen.has(item.id))await loadComments(item.id);
        return;
      }
      if(button.hasAttribute("data-wall-comments")){
        const id=Number(button.dataset.wallComments);
        const section=document.querySelector('[data-wall-comment-section="'+id+'"]');
        if(commentOpen.has(id)){commentOpen.delete(id);if(section)section.hidden=true;}
        else{commentOpen.add(id);if(section)section.hidden=false;await loadComments(id);}
        return;
      }
      if(button.hasAttribute("data-wall-comment-delete")){
        if(!confirm("Obrisati komentar?"))return;
        await api("wallCommentDelete",{id:Number(button.dataset.wallCommentDelete)});
        await load(true);
      }
    }catch(err){showError(err)}
  },true);

  document.addEventListener("submit",async(event)=>{
    const form=event.target.closest("#sffWallComposer,[data-wall-comment-form],[data-wall-share-form]");
    if(!form)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(busy)return;
    busy=true;
    const send=form.querySelector('button[type="submit"]');
    if(send)send.disabled=true;
    try{
      if(form.id==="sffWallComposer"){
        await api("wallCreate",{body:form.querySelector("[name=body]").value,image:composerImage});
        composerImage=null;composerPreview=null;await load(true);
      } else if(form.hasAttribute("data-wall-comment-form")){
        const id=Number(form.dataset.wallCommentForm);
        await api("wallComment",{id,body:form.querySelector("[name=comment]").value});
        form.reset();
        const p=await api("wallOne",{id});
        feed=feed.map(x=>x.id===id?p:x);
        const count=document.querySelector('[data-wall-post="'+id+'"] .sffWallCounts span:last-child');
        if(count)count.textContent=p.comments+" komentara";
        await loadComments(id);
      } else if(form.hasAttribute("data-wall-share-form")){
        const target=Number(form.querySelector("[name=target]").value);
        await api("wallShare",{id:sharePost,target});
        document.querySelector("#sffWallShare")?.close();
        showError("Objava je poslata u privatni razgovor.");
      }
    }catch(err){showError(err)}
    finally{busy=false;if(send&&send.isConnected)send.disabled=false}
  },true);

  document.addEventListener("change",(event)=>{
    if(event.target.id==="sffWallImageInput")upload(event.target.files?.[0]).catch(showError);
  },true);
  document.addEventListener("click",(event)=>{
    const link=event.target.closest('a[href*="#objava="]');
    if(!link)return;
    try{
      const url=new URL(link.href,location.href);
      if(url.origin!==location.origin)return;
      const id=Number(new URLSearchParams(url.hash.slice(1)).get("objava"));
      if(!Number.isSafeInteger(id)||id<=0)return;
      event.preventDefault();event.stopImmediatePropagation();
      openPost(id).catch(showError);
    }catch{}
  },true);

  let launched=false;
  function deepLink(){
    if(launched||!document.querySelector(".shell"))return;
    const hash=new URLSearchParams(location.hash.replace(/^#/,""));
    const id=Number(hash.get("objava"));
    if(!Number.isSafeInteger(id)||id<=0)return;
    launched=true;openPost(id).catch(showError);
  }
  const observer=new MutationObserver(deepLink);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  deepLink();
  window.SFFWall={openHome:()=>open(null),openUser:open,openPost};
})();