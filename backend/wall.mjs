/* SFF Pocetna: friends-only posts, server-side authorization. */
import { retentionCutoff } from "./retention.mjs";
export async function socialWall({db,one,all,run,insert,demand,blocked,limit,push}) {
  await db.exec([
    "CREATE TABLE IF NOT EXISTS wall_posts(id INTEGER PRIMARY KEY,uid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,image_mime TEXT,image_bytes BLOB)",
    "CREATE INDEX IF NOT EXISTS wall_posts_author ON wall_posts(uid,id)",
    "CREATE TABLE IF NOT EXISTS wall_likes(post INTEGER NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,uid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(post,uid))",
    "CREATE TABLE IF NOT EXISTS wall_comments(id INTEGER PRIMARY KEY,post INTEGER NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,uid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS wall_comments_post ON wall_comments(post,id)"
  ].join(";")+";");
  const positive = (v) => {
    const n=Number(v);
    demand(Number.isSafeInteger(n)&&n>0,"Neispravan identifikator.",400);
    return n;
  };
  const text=(v,max)=>{
    demand(typeof v==="string"&&v.length<=max,"Tekst je predugačak.",400);
    return v.trim();
  };
  const friends=(a,b)=>one(
    "select 1 from friends where accepted=1 and ((sender=? and target=?) or (sender=? and target=?))",
    a,b,b,a);
  const canSee=async(v,author)=>Boolean(v===author||(await friends(v,author))&&!(await blocked(v,author)));
  const baseSelect=[
    "select p.id,p.uid,p.body,p.created,case when p.image_mime is null then 0 else 1 end image,u.name,u.username,",
    "(select count(*) from wall_likes l where l.post=p.id) likes,",
    "(select count(*) from wall_comments c where c.post=p.id) comments,",
    "(select count(*) from wall_likes l where l.post=p.id and l.uid=?) liked",
    "from wall_posts p join users u on u.id=p.uid"
  ].join(" ");
  async function item(viewer,id) {
    const p=await one(baseSelect+" where p.id=?",viewer,id);
    demand(p && p.created > retentionCutoff() && await canSee(viewer,p.uid),
      "Objava nije dostupna.",404);
    return p;
  }
  async function feed(viewer,author,before) {
    const args=[viewer];let condition;
    if(author){
      demand(await one("select id from users where id=?",author),"Korisnik ne postoji.",404);
      demand(await canSee(viewer,author),"Zid je dostupan samo prijateljima.",403);
      condition="p.uid=?";args.push(author);
    } else {
      condition=[
        "(p.uid=? or (exists(select 1 from friends f where f.accepted=1",
        "and ((f.sender=? and f.target=p.uid) or (f.target=? and f.sender=p.uid)))",
        "and not exists(select 1 from blocks b where (b.uid=? and b.target=p.uid)",
        "or (b.uid=p.uid and b.target=?))))"
      ].join(" ");
      args.push(viewer,viewer,viewer,viewer,viewer);
    }
    condition+=" and p.created>?";args.push(retentionCutoff());
    if(before){condition+=" and p.id<?";args.push(before);}
    return await all(baseSelect+" where "+condition+" order by p.id desc limit 16",...args);
  }
  async function inform(author) {
    await push({type:"wall_changed",uid:author},async(s)=>s.uid===author||await canSee(s.uid,author));
  }
  async function handle(a,b,u,req){
    if(!a.startsWith("wall"))return;
    demand(u,"Prijavi se da vidiš Početnu.",401);
    if(a==="wallFeed"){
      const before=b.before==null?0:positive(b.before);
      const author=b.user==null?null:positive(b.user);
      return {posts:await feed(u,author,before)};
    }
    if(a==="wallOne")return await item(u,positive(b.id));
    if(a==="wallCreate"){
      limit("wall:create:"+u,10);
      const body=text(b.body||"",2500);
      let img=null,mime=null;
      if(b.image!=null){
        demand(typeof b.image==="string"&&b.image.length<=1400000,"Slika može imati najviše 1 MB.",413);
        img=Buffer.from(b.image,"base64");
        demand(img.length>0&&img.length<=1024*1024,"Slika može imati najviše 1 MB.",413);
        mime=img.subarray(0,8).toString("hex")==="89504e470d0a1a0a"?"image/png":
          img[0]===255&&img[1]===216?"image/jpeg":null;
        demand(mime,"Dozvoljene su samo PNG i JPG slike.",400);
      }
      demand(body||img,"Napiši tekst ili dodaj sliku.",400);
      const id=await insert("insert into wall_posts(uid,body,created,image_mime,image_bytes) values(?,?,?,?,?)",
        u,body,Date.now(),mime,img);
      await inform(u);return {id};
    }
    if(a==="wallDelete"){
      const id=positive(b.id);
      const post=await one("select uid from wall_posts where id=?",id);
      demand(post&&post.uid===u,"Možeš obrisati samo svoju objavu.",403);
      await db.transaction(async(tx)=>{
        await tx.run("delete from wall_comments where post=?",id);
        await tx.run("delete from wall_likes where post=?",id);
        await tx.run("delete from wall_posts where id=? and uid=?",id,u);
      });
      await inform(u);return {};
    }
    if(a==="wallLike"){
      limit("wall:like:"+u,120);
      const id=positive(b.id),p=await item(u,id);
      const liked=await one("select 1 from wall_likes where post=? and uid=?",id,u);
      if(liked)await run("delete from wall_likes where post=? and uid=?",id,u);
      else await run("insert or ignore into wall_likes values(?,?)",id,u);
      await inform(p.uid);return {liked:!liked};
    }
    if(a==="wallComment"){
      limit("wall:comment:"+u,45);
      const id=positive(b.id),p=await item(u,id),body=text(b.body,600);
      demand(body,"Napiši komentar.",400);
      const cid=await insert("insert into wall_comments(post,uid,body,created) values(?,?,?,?)",
        id,u,body,Date.now());
      await inform(p.uid);return {id:cid};
    }
    if(a==="wallComments"){
      const id=positive(b.id);await item(u,id);
      const before=b.before==null?0:positive(b.before);
      return {comments:await all(
        "select c.id,c.uid,c.body,c.created,u.name,u.username from wall_comments c join users u on u.id=c.uid where c.post=? and (?=0 or c.id<?) order by c.id desc limit 40",
        id,before,before)};
    }
    if(a==="wallCommentDelete"){
      const id=positive(b.id),comment=await one("select post,uid from wall_comments where id=?",id);
      demand(comment,"Komentar nije dostupan.",404);
      const p=await item(u,comment.post);
      demand(comment.uid===u||p.uid===u,"Nemaš pravo da obrišeš komentar.",403);
      await run("delete from wall_comments where id=?",id);
      await inform(p.uid);return {};
    }
    if(a==="wallShare"){
      limit("wall:share:"+u,25);
      const p=await item(u,positive(b.id)),to=positive(b.target);
      demand(to!==u&&await friends(u,to)&&!(await blocked(u,to)),
        "Objavu možeš poslati samo potvrđenim prijateljima.",403);
      demand(await canSee(to,p.uid),"Primalac ne može da vidi ovu objavu.",403);
      let room=(await one(
        "select a.room from participants a join participants b on b.room=a.room join rooms r on r.id=a.room where a.uid=? and b.uid=? and r.kind='dm'",u,to))?.room;
      if(!room){
        room=await db.transaction(async(tx)=>{
          const id=await tx.insert("insert into rooms(name,kind) values('','dm')");
          await tx.run("insert into participants values(?,?),(?,?)",id,u,id,to);
          return id;
        });
      }
      const proto=req.headers["x-forwarded-proto"]==="https"?"https":"http";
      const body="📰 Pogledaj objavu korisnika @"+p.username+": "+proto+"://"+req.headers.host+"/#objava="+p.id;
      const id=await insert("insert into messages(room,uid,body,time) values(?,?,?,?)",
        room,u,body,Date.now());
      const sender=await one("select name from users where id=?",u);
      await push({type:"message",id,room,uid:u,name:sender.name,body,notify:true,mentions:[],time:Date.now()},
        (s)=>s.uid===to);
      await push({type:"state"},(s)=>s.uid===to||s.uid===u);
      return {room,id};
    }
    demand(false,"Nepoznata operacija na zidu.",404);
  }
  async function media(u,id,res){
    demand(u,"Prijavi se.",401);
    const p=await item(u,positive(id));
    demand(p.image,"Slika nije pronađena.",404);
    const row=await one("select image_mime,image_bytes from wall_posts where id=?",id);
    demand(row?.image_bytes,"Slika nije pronađena.",404);
    res.setHeader("Content-Type",row.image_mime);
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Content-Length",String(row.image_bytes.length));
    res.end(row.image_bytes);
  }
  return {handle,media};
}
