const express=require('express'),fs=require('fs'),crypto=require('crypto'),QR=require('qrcode');
const KEY=process.env.RAZORPAY_KEY_ID,SEC=process.env.RAZORPAY_KEY_SECRET,PASS=process.env.ADMIN_PASSWORD||'admin123';
const rzp=null; // online gateway not used: payment is cash / UPI on delivery
const STEPS=['Placed','Confirmed','Preparing','Out for delivery','Delivered'];
const DEF=[["Cakes","🎂","Black Forest Cake","Classic cherry & cream, per ½ kg",450],["Cakes","🍰","Butterscotch Cake","Crunchy caramel praline, per ½ kg",480],["Cakes","🍫","Chocolate Truffle Cake","Rich ganache layers, per ½ kg",550],["Cakes","🍍","Pineapple Cake","Fresh fruit & whipped cream, per ½ kg",420],["Cakes","❤️","Red Velvet Cake","Cream cheese frosting, per ½ kg",650],["Puffs","🥚","Egg Puff","Flaky pastry with spiced egg",25],["Puffs","🍗","Chicken Puff","Flaky pastry with chicken masala",35],["Puffs","🧀","Paneer Puff","Flaky pastry with spiced paneer",35],["Burgers & Sandwiches","🍔","Veg Burger","Crispy patty, fresh veggies, sauce",70],["Burgers & Sandwiches","🍔","Chicken Burger","Juicy chicken patty with cheese",110],["Burgers & Sandwiches","🥪","Veg Sandwich","Grilled with veggies & chutney",60],["Burgers & Sandwiches","🥪","Chicken Sandwich","Grilled with chicken & mayo",90]].map((r,i)=>({id:'m'+i,cat:r[0],em:r[1],name:r[2],desc:r[3],price:r[4]}));

// ---- storage: Postgres (DATABASE_URL) for hosting, or local files for testing ----
let store;
if(process.env.DATABASE_URL){const {Pool}=require('pg'),pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:3,idleTimeoutMillis:10000}),q=(s,a)=>pool.query(s,a).then(r=>r.rows);
store={async init(){await q('create table if not exists settings(k text primary key,v jsonb not null)');await q('create table if not exists orders(id text primary key,created bigint not null,data jsonb not null)');await q('create table if not exists images(name text primary key,mime text not null,data text not null)')},
async settings(){const r=await q("select v from settings where k='shop'");return r[0]?r[0].v:{menu:DEF,fee:30}},
async setSettings(v){await q("insert into settings(k,v) values('shop',$1) on conflict(k) do update set v=excluded.v",[JSON.stringify(v)])},
async addOrder(o){await q('insert into orders(id,created,data) values($1,$2,$3)',[o.id,o.created,JSON.stringify(o)])},
async getOrder(id){const r=await q('select data from orders where id=$1',[id]);return r[0]&&r[0].data},
async saveOrder(o){await q('update orders set data=$2 where id=$1',[o.id,JSON.stringify(o)])},
async orders(){return (await q('select data from orders order by created desc limit 200')).map(x=>x.data)},
async putImage(n,m,b){await q('insert into images(name,mime,data) values($1,$2,$3)',[n,m,b.toString('base64')])},
async image(n){const r=await q('select mime,data from images where name=$1',[n]);return r[0]&&{mime:r[0].mime,data:Buffer.from(r[0].data,'base64')}}}}
else{const F=process.env.DATA_FILE||'data.json',UP=process.env.UPLOAD_DIR||'uploads';fs.mkdirSync(UP,{recursive:true});
const L=()=>fs.existsSync(F)?JSON.parse(fs.readFileSync(F,'utf8')):{shop:{menu:DEF,fee:30},orders:[]},W=d=>fs.writeFileSync(F,JSON.stringify(d,null,1));
store={async init(){},async settings(){return L().shop},async setSettings(v){const d=L();d.shop=v;W(d)},async addOrder(o){const d=L();d.orders.push(o);W(d)},async getOrder(id){return L().orders.find(x=>x.id===id)},
async saveOrder(o){const d=L(),i=d.orders.findIndex(x=>x.id===o.id);d.orders[i]=o;W(d)},async orders(){return L().orders.slice().reverse().slice(0,200)},
async putImage(n,m,b){fs.writeFileSync(UP+'/'+n,b)},async image(n){const f=UP+'/'+n;return fs.existsSync(f)?{mime:{jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[n.split('.').pop()],data:fs.readFileSync(f)}:null}}}
// ---- helpers ----
const app=express();app.use(express.json({limit:'200kb'}));app.use(express.static('public'));
const ready=store.init();ready.catch(e=>console.error('DB init failed:',e.message));
app.use((q,r,n)=>ready.then(()=>n(),()=>r.status(503).json({error:'Database not available. Check DATABASE_URL.'})));
const h=f=>(q,r)=>Promise.resolve(f(q,r)).catch(e=>{console.error(e);r.status(500).json({error:'Server error. Please try again.'})});
const sign=e=>crypto.createHmac('sha256',PASS+'|tb').update(String(e)).digest('hex');
const okTok=t=>{const[e,s]=String(t||'').split('.');if(!e||!s||+e<Date.now())return false;const x=Buffer.from(sign(e)),y=Buffer.from(s);return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const auth=(q,r,n)=>okTok(q.get('x-token'))?n():r.status(401).json({error:'Login required'});
const pub=o=>({id:o.id,status:o.status,paid:o.paid,pay:o.pay,total:o.total,lines:o.lines,history:o.history,steps:STEPS,utr:o.utr});
const upiId=s=>s.upi||process.env.UPI_ID||'';
const mkUpi=async(s,o)=>{const a=upiId(s);if(!a)return null;const link=`upi://pay?pa=${encodeURIComponent(a)}&pn=${encodeURIComponent('Telangana Bakery')}&am=${o.total}&cu=INR&tn=${o.id}`;return{link,id:a,total:o.total,qr:await QR.toDataURL(link,{width:300,margin:1})}};
const ALL=STEPS.concat('Cancelled');
// ---- customer API ----
app.get('/uploads/:n',h(async(q,r)=>{if(!/^[\w.-]+$/.test(q.params.n))return r.sendStatus(404);const i=await store.image(q.params.n);if(!i)return r.sendStatus(404);r.set({'Cache-Control':'public,max-age=604800,immutable','X-Content-Type-Options':'nosniff'}).type(i.mime).send(i.data)}));
app.get('/api/menu',h(async(q,r)=>{const s=await store.settings();r.json({menu:s.menu,fee:s.fee,online:!!rzp,upi:!!upiId(s)})}));
app.post('/api/orders',h(async(q,r)=>{const s=await store.settings(),{name,phone,addr,note,pay,items}=q.body||{};
if(!name||!/^\d{10}$/.test(phone||'')||!addr||!Array.isArray(items))return r.status(400).json({error:'Please enter name, 10-digit phone and address.'});
let sub=0;const lines=[];for(const it of items){const m=s.menu.find(x=>x.id===it.id),n=Math.min(20,parseInt(it.q)||0);if(m&&n>0){lines.push({n:m.name,q:n,p:m.price});sub+=m.price*n}}
if(!lines.length)return r.status(400).json({error:'Your cart is empty.'});
if(pay==='online'&&!rzp)return r.status(400).json({error:'Online payment is not available right now.'});
if(pay==='upi'&&!upiId(s))return r.status(400).json({error:'UPI payment is not available right now.'});
const total=sub+(+s.fee||0),t=Date.now(),o={id:'TB'+t.toString(36).toUpperCase()+crypto.randomBytes(1).toString('hex').toUpperCase(),name:String(name).slice(0,80),phone,addr:String(addr).slice(0,300),note:String(note||'').slice(0,200),lines,total,pay:['online','upi','udel'].includes(pay)?pay:'cod',paid:false,status:'Placed',created:t,history:[{s:'Placed',t}]};
let rz=null;if(o.pay==='online'){rz=await rzp.orders.create({amount:total*100,currency:'INR',receipt:o.id});o.rzp=rz.id}
await store.addOrder(o);r.json({order:pub(o),rz,key:KEY,upi:o.pay==='upi'?await mkUpi(s,o):null})}));
app.post('/api/pay/verify',h(async(q,r)=>{const {id,razorpay_order_id:a,razorpay_payment_id:b,razorpay_signature:g}=q.body||{},o=await store.getOrder(String(id));
if(!o||!SEC||o.rzp!==a)return r.status(400).json({ok:false});const ok=crypto.createHmac('sha256',SEC).update(a+'|'+b).digest('hex')===g;if(ok){o.paid=true;o.payId=b;await store.saveOrder(o)}r.json({ok})}));
app.get('/api/track',h(async(q,r)=>{const o=await store.getOrder(String(q.query.id||'').trim().toUpperCase());
if(!o||o.phone!==String(q.query.phone||'').trim())return r.status(404).json({error:'Order not found. Check the order ID and phone number.'});
r.json({...pub(o),upi:o.pay==='upi'&&!o.paid&&o.status!=='Cancelled'?await mkUpi(await store.settings(),o):null})}));
app.post('/api/orders/:id/utr',h(async(q,r)=>{const b=q.body||{},o=await store.getOrder(q.params.id);if(!o||o.phone!==String(b.phone)||o.pay!=='upi')return r.status(404).json({error:'Order not found'});o.utr=String(b.utr||'').replace(/[^\w-]/g,'').slice(0,30);await store.saveOrder(o);r.json({ok:true})}));
// ---- admin API ----
app.post('/api/admin/login',(q,r)=>{if((q.body||{}).password!==PASS)return r.status(401).json({error:'Wrong password'});const e=Date.now()+12*36e5;r.json({token:e+'.'+sign(e)})});
app.get('/api/admin/orders',auth,h(async(q,r)=>r.json({orders:await store.orders(),steps:ALL})));
app.post('/api/admin/orders/:id',auth,h(async(q,r)=>{const o=await store.getOrder(q.params.id),s=q.body.status;if(!o||!ALL.includes(s))return r.status(400).json({error:'Bad request'});
o.status=s;o.history.push({s,t:Date.now()});if(s==='Delivered'&&['cod','udel'].includes(o.pay))o.paid=true;await store.saveOrder(o);r.json({ok:true})}));
app.post('/api/admin/orders/:id/paid',auth,h(async(q,r)=>{const o=await store.getOrder(q.params.id);if(!o)return r.status(404).json({error:'Not found'});o.paid=true;o.history.push({s:'Payment received',t:Date.now()});if(o.status==='Placed'){o.status='Confirmed';o.history.push({s:'Confirmed',t:Date.now()})}await store.saveOrder(o);r.json({ok:true})}));
app.get('/api/admin/menu',auth,h(async(q,r)=>{const s=await store.settings();r.json({menu:s.menu,fee:s.fee,upi:s.upi||process.env.UPI_ID||''})}));
app.put('/api/admin/menu',auth,h(async(q,r)=>{const menu=(q.body.menu||[]).slice(0,200).map((x,i)=>({id:String(x.id||'m'+Date.now()+i),cat:String(x.cat).slice(0,40),em:String(x.em).slice(0,8),name:String(x.name).slice(0,60),desc:String(x.desc||'').slice(0,120),price:Math.max(0,+x.price||0),img:/^\/uploads\/[\w.-]+$/.test(x.img||'')?x.img:''}));
await store.setSettings({menu,fee:Math.max(0,+q.body.fee||0),upi:String(q.body.upi||'').trim().slice(0,60)});r.json({ok:true})}));
app.post('/api/admin/upload',auth,express.raw({type:'image/*',limit:'4mb'}),h(async(q,r)=>{const m=q.get('content-type'),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[m];if(!ext||!Buffer.isBuffer(q.body)||!q.body.length)return r.status(400).json({error:'Upload a JPG, PNG or WebP image (max 4 MB)'});
const n=crypto.randomBytes(8).toString('hex')+'.'+ext;await store.putImage(n,m,q.body);r.json({url:'/uploads/'+n})}));
module.exports=app;
if(require.main===module){const port=process.env.PORT||3000;ready.then(()=>app.listen(port,()=>console.log('Telangana Bakery running on port '+port+(process.env.DATABASE_URL?' (database)':' (local files)')))).catch(()=>process.exit(1))}
