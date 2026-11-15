const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const DBFILE = path.join(DATA, 'db.json');
const readDB = () => {
  try { return JSON.parse(fs.readFileSync(DBFILE, 'utf8')); }
  catch { return { users: [], games: [{id:'welcome', title:'Block Builder', description:'A starter DexBlocks experience. Build and explore the demo world.', category:'Featured', visits:0, owner:'Dexblocks', createdAt:Date.now()}], messages: [] }; }
};
let db = readDB();
if (!Array.isArray(db.users)) db.users = [];
if (!Array.isArray(db.games)) db.games = [];
if (!Array.isArray(db.messages)) db.messages = [];
if (!db.sessions || typeof db.sessions !== 'object') db.sessions = {};
function sessionKey(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}
function sessionUserId(token) {
  return db.sessions[sessionKey(token)] || null;
}
function save() { fs.writeFileSync(DBFILE, JSON.stringify(db, null, 2), { mode: 0o600 }); }
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}
async function setupOwner() {
  let owner = db.users.find(u => u.username.toLowerCase() === 'dexblocks');
  if (!owner) {
    console.log('\nDexBlocks first-run owner setup');
    console.log('Create a password for the DexBlocks owner account. Do not reuse your personal password.');
    let password = '';
    while (password.length < 10) password = await ask('Owner password (10+ characters): ');
    owner = { id: crypto.randomUUID(), username:'Dexblocks', passwordHash: await bcrypt.hash(password, 12), role:'owner', verified:true, createdAt:Date.now() };
    db.users.push(owner); save();
    console.log('Owner account created. Password is stored as a hash.\n');
  }
}
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET','POST'] },
  maxHttpBufferSize: 1e6
});
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/api/health', (_req,res) => res.json({ok:true, app:'DexBlocks', version:'1.0.0'}));

function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const userId = sessionUserId(token);
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({error:'Sign in first.'});
  req.user = user; next();
}
function admin(req,res,next) {
  if (!['owner','admin'].includes(req.user.role)) return res.status(403).json({error:'Admin access required.'});
  next();
}
app.post('/api/register', async (req,res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({error:'Username must be 3–20 letters, numbers, or underscores.'});
  if (password.length < 10 || password.length > 128) return res.status(400).json({error:'Password must be 10–128 characters.'});
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({error:'Username already exists.'});
  const user = { id:crypto.randomUUID(), username, passwordHash:await bcrypt.hash(password,12), role:'user', verified:false, createdAt:Date.now() };
  db.users.push(user); save();
  res.json({ok:true, username:user.username});
});
app.post('/api/login', async (req,res) => {
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password,user.passwordHash))) return res.status(401).json({error:'Invalid username or password.'});
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[sessionKey(token)] = user.id;
  save();
  res.json({token, user:{username:user.username, role:user.role, verified:user.verified}});
});
app.get('/api/me', auth, (req,res) => res.json({username:req.user.username, role:req.user.role, verified:req.user.verified}));
app.get('/api/games', (_req,res) => res.json(db.games.map(({id,title,description,category,visits,owner,createdAt}) => ({id,title,description,category,visits,owner,createdAt}))));
app.post('/api/games/:id/visit', (req,res) => {
  const game = db.games.find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({error:'Game not found.'});
  game.visits = (game.visits || 0) + 1; save(); res.json({visits:game.visits});
});
app.post('/api/games', auth, (req,res) => {
  const title = String(req.body.title || '').trim().slice(0,60);
  const description = String(req.body.description || '').trim().slice(0,500);
  const category = String(req.body.category || 'Community').slice(0,30);
  if (title.length < 2) return res.status(400).json({error:'Title must be at least 2 characters.'});
  const game = {id:crypto.randomUUID(),title,description,category,visits:0,owner:req.user.username,createdAt:Date.now()};
  db.games.unshift(game); save(); res.json(game);
});
app.delete('/api/games/:id', auth, (req,res) => {
  const game = db.games.find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({error:'Game not found.'});
  if (game.owner !== req.user.username && !['owner','admin'].includes(req.user.role)) return res.status(403).json({error:'You can only delete your own games.'});
  db.games = db.games.filter(g => g.id !== game.id); save(); res.json({ok:true});
});
const storage = multer.diskStorage({
  destination: (_req,_file,cb) => cb(null,UPLOADS),
  filename: (_req,file,cb) => cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + path.extname(file.originalname).toLowerCase())
});
const upload = multer({storage, limits:{fileSize:50*1024*1024}, fileFilter:(_req,file,cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, ['.rbxm','.rbxl'].includes(ext));
}});
app.post('/api/studio/upload', auth, upload.single('file'), (req,res) => {
  if (!req.file) return res.status(400).json({error:'Upload an .rbxm or .rbxl file (max 50 MB).'});
  res.json({ok:true, filename:req.file.filename, originalName:req.file.originalname, size:req.file.size, note:'Stored in the host uploads folder. Importing is not the same as running the Roblox game.'});
});
app.get('/api/studio/files', auth, (req,res) => {
  const files = fs.readdirSync(UPLOADS).map(name => {
    const s = fs.statSync(path.join(UPLOADS,name));
    return {name,size:s.size,modified:s.mtimeMs};
  });
  res.json(files);
});
app.get('/api/admin/users', auth, admin, (_req,res) => res.json(db.users.map(u=>({username:u.username,role:u.role,verified:u.verified,createdAt:u.createdAt}))));
app.post('/api/admin/users/:username/verify', auth, admin, (req,res) => {
  const u = db.users.find(x=>x.username.toLowerCase()===String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({error:'User not found.'});
  u.verified = Boolean(req.body.verified); save(); res.json({ok:true,username:u.username,verified:u.verified});
});
app.get('/api/admin/messages', auth, admin, (_req,res) => res.json(db.messages.slice(-100)));

const cooldowns = new Map();
const blockedWords = ['slurplaceholder'];
io.use((socket,next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const userId = sessionUserId(token);
  const user = db.users.find(u => u.id === userId);
  if (!user) return next(new Error('Sign in to use multiplayer chat.'));
  socket.user = user; next();
});
io.on('connection', socket => {
  socket.join('lobby');
  socket.emit('system', {message:'Connected to DexBlocks lobby.'});
  socket.on('joinRoom', async room => {
    const safeRoom = String(room || 'lobby').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,30) || 'lobby';
    for (const r of socket.rooms) {
      if (r !== socket.id) {
        if (r.startsWith('game-')) socket.to(r).emit('playerLeft', {id: socket.user.id});
        socket.leave(r);
      }
    }
    socket.join(safeRoom);
    socket.emit('system',{message:'Joined room: '+safeRoom});

    if (safeRoom.startsWith('game-')) {
      const player = {
        id: socket.user.id,
        username: socket.user.username,
        role: socket.user.role,
        verified: socket.user.verified,
        color: colorsForPlayer(socket.user.id),
        x: 450,
        y: 260
      };
      const members = await io.in(safeRoom).fetchSockets();
      const players = members
        .filter(member => member.user)
        .map(member => {
          const pos = member.data.playerPosition || {x:450,y:260};
          return {
            id: member.user.id,
            username: member.user.username,
            role: member.user.role,
            verified: member.user.verified,
            color: colorsForPlayer(member.user.id),
            x: pos.x,
            y: pos.y
          };
        });
      socket.emit('playerList', players);
      socket.emit('playerSnapshot', players);
      socket.to(safeRoom).emit('playerJoin', player);
      socket.to(safeRoom).emit('playerJoined', player);
    }
  });
  socket.on('chat', raw => {
    const now = Date.now(), last = cooldowns.get(socket.user.id) || 0;
    if (now - last < 1800) return socket.emit('chatError',{message:'Slow down before sending another message.'});
    const message = String(raw || '').replace(/[<>]/g,'').trim().slice(0,180);
    if (!message) return;
    if (blockedWords.some(w => message.toLowerCase().includes(w))) return socket.emit('chatError',{message:'Message blocked by the chat filter.'});
    cooldowns.set(socket.user.id,now);
    const room = [...socket.rooms].find(r=>r!==socket.id) || 'lobby';
    const item = {username:socket.user.username,role:socket.user.role,verified:socket.user.verified,message,at:now,room};
    db.messages.push(item); if (db.messages.length>500) db.messages=db.messages.slice(-500); save();
    io.to(room).emit('chat',item);
  });
  socket.on('playerMove', raw => {
    const room = [...socket.rooms].find(r => r !== socket.id);
    if (!room || !room.startsWith('game-') || !raw) return;
    const x = Number(raw.x), y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    socket.data.playerPosition = {
      x: Math.max(18, Math.min(882, x)),
      y: Math.max(30, Math.min(500, y))
    };
    socket.to(room).emit('playerMove', {
      id: socket.user.id,
      username: socket.user.username,
      role: socket.user.role,
      verified: socket.user.verified,
      color: colorsForPlayer(socket.user.id),
      x: Math.max(18, Math.min(882, x)),
      y: Math.max(30, Math.min(500, y))
    });
  });

  socket.on('disconnecting', () => {
    for (const r of socket.rooms) {
      if (r.startsWith('game-')) {
        socket.to(r).emit('playerLeft', {id: socket.user?.id});
      }
    }
  });
});
function colorsForPlayer(id) {
  const palette = ['#e39a53','#50a7a0','#d46c88','#79a45a','#568fd0','#d5bb54'];
  let n = 0; for (const c of String(id)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return palette[n % palette.length];
}
(async () => {
  await setupOwner();
  const port = Number(process.env.PORT || 3210);
  server.listen(port,'0.0.0.0',()=>console.log(`DexBlocks server listening on port ${port}`));
})();
