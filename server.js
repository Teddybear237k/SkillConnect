require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const db         = require('./db/database');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'SkillConnect.html'));
});

const JWT_SECRET = process.env.JWT_SECRET || 'skillconnect_jwt_secret_2026_cameroun';

// ─── Token blacklist (logout) ─────────────────────────────────────────────────
const revokedTokens = new Set();

// ─── Middleware JWT ───────────────────────────────────────────────────────────
function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  if (revokedTokens.has(token)) return res.status(401).json({ error: 'Session expirée' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// ─── Validation input ─────────────────────────────────────────────────────────
function validateFields(body, required) {
  for (const f of required) {
    if (!body[f] && body[f] !== 0) return `Champ requis : ${f}`;
  }
  return null;
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 120,
  message: { error: 'Trop de requêtes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

// ─── Socket.io — messagerie temps réel ────────────────────────────────────────
const userSockets = {};

io.on('connection', (socket) => {
  socket.on('auth', (userId) => {
    userSockets[String(userId)] = socket.id;
    socket.userId = String(userId);
  });
  socket.on('disconnect', () => {
    if (socket.userId) delete userSockets[socket.userId];
  });
});

function emitToUser(userId, event, data) {
  const sid = userSockets[String(userId)];
  if (sid) io.to(sid).emit(event, data);
}

// ─── Africa's Talking SMS ─────────────────────────────────────────────────────
let atSMS = null;
try {
  if (process.env.AT_API_KEY && process.env.AT_API_KEY !== 'VOTRE_CLE_ICI') {
    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
    atSMS = at.SMS;
    console.log('✅ Africa\'s Talking SMS activé');
  } else {
    console.log('ℹ️  SMS désactivé (configurez AT_API_KEY dans .env)');
  }
} catch (e) {
  console.log('⚠️  Africa\'s Talking non disponible :', e.message);
}

async function sendSMS(phone, message) {
  if (!atSMS || !phone) return;
  try {
    const number = String(phone).replace(/\s/g, '');
    const formatted = number.startsWith('+') ? number : '+237' + number;
    await atSMS.send({ to: [formatted], message, from: 'SkillConnect' });
    console.log('📱 SMS envoyé à', formatted);
  } catch (e) {
    console.error('SMS erreur :', e.message);
  }
}

// ─── Auth : Inscription ────────────────────────────────────────────────────────
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const err = validateFields(req.body, ['prenom', 'nom', 'skill']);
    if (err) return res.status(400).json({ error: err });

    // Vérifie si l'email est déjà pris
    if (req.body.email) {
      const existing = db.findUserByEmail(req.body.email);
      if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }

    // Hash du mot de passe si fourni
    let password_hash = null;
    if (req.body.password) {
      if (req.body.password.length < 6)
        return res.status(400).json({ error: 'Mot de passe trop court (min 6 caractères).' });
      password_hash = await bcrypt.hash(req.body.password, 10);
    }

    const user = db.createUser({ ...req.body, password_hash });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    if (user.phone) {
      sendSMS(user.phone,
        `Bienvenue sur SkillConnect, ${user.prenom} ! 🎉\nVotre profil "${user.skill}" est en ligne.`
      );
    }

    const { password_hash: _ph, ...safeUser } = user;
    res.json({ success: true, user: safeUser, token });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Auth : Connexion ─────────────────────────────────────────────────────────
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const err = validateFields(req.body, ['email', 'password']);
    if (err) return res.status(400).json({ error: err });

    const user = db.findUserByEmail(req.body.email);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    if (!user.password_hash)
      return res.status(401).json({ error: 'Ce compte n\'a pas de mot de passe défini.' });

    const match = await bcrypt.compare(req.body.password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    const { password_hash: _ph, ...safeUser } = user;
    res.json({ success: true, user: safeUser, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Auth : Déconnexion ────────────────────────────────────────────────────────
app.post('/api/logout', authenticateToken, (req, res) => {
  const token = req.headers['authorization'].slice(7);
  revokedTokens.add(token);
  res.json({ success: true });
});

// ─── Auth : Supprimer compte ───────────────────────────────────────────────────
app.delete('/api/users/:id', authenticateToken, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.user.userId !== targetId)
    return res.status(403).json({ error: 'Accès refusé.' });

  const ok = db.deleteUser(targetId);
  if (!ok) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

  const token = req.headers['authorization'].slice(7);
  revokedTokens.add(token);
  res.json({ success: true });
});

// ─── Talents ──────────────────────────────────────────────────────────────────
app.get('/api/talents', (req, res) => {
  try { res.json(db.getTalents(req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/talents/:id', (req, res) => {
  const t = db.getTalentById(parseInt(req.params.id));
  if (!t) return res.status(404).json({ error: 'Talent non trouvé' });
  const { password_hash: _ph, ...safe } = t;
  res.json(safe);
});

// ─── Tableau de bord ──────────────────────────────────────────────────────────
app.get('/api/dashboard/:userId', (req, res) => {
  const data = db.getDashboardData(parseInt(req.params.userId));
  if (!data) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  res.json(data);
});

app.put('/api/profile/:userId', authenticateToken, (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try {
    db.updateUser(parseInt(req.params.userId), req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Messagerie ───────────────────────────────────────────────────────────────
app.get('/api/contacts/:userId', (req, res) => {
  try { res.json(db.getContacts(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:userId/:contactId', (req, res) => {
  try {
    res.json(db.getMessages(parseInt(req.params.userId), parseInt(req.params.contactId)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { senderId, receiverId, text } = req.body;
    const err = validateFields(req.body, ['senderId', 'receiverId', 'text']);
    if (err) return res.status(400).json({ error: err });

    if (req.user.userId !== parseInt(senderId))
      return res.status(403).json({ error: 'Accès refusé.' });

    const msg = db.sendMessage(parseInt(senderId), parseInt(receiverId), text);
    const sender = db.getTalentById(parseInt(senderId));

    if (sender) {
      const notif = db.createNotification({
        userId: parseInt(receiverId),
        type: 'message',
        message: `Nouveau message de ${sender.prenom} ${sender.nom}`,
      });
      emitToUser(receiverId, 'new_notification', notif);
    }

    emitToUser(receiverId, 'new_message', {
      ...msg,
      sender_initials: sender?.initials || '?',
      sender_bg: sender?.bg_color || '#ccc',
      sender_col: sender?.text_color || '#000',
      sender_prenom: sender?.prenom || '',
      sender_photo: sender?.photo || null,
    });

    const isBooking = text.toLowerCase().includes('réserver') || text.toLowerCase().includes('reserver');
    if (isBooking) {
      const receiver = db.getTalentById(parseInt(receiverId));
      if (receiver?.phone) {
        sendSMS(receiver.phone,
          `SkillConnect : ${sender ? sender.prenom + ' ' + sender.nom : 'Un utilisateur'} souhaite réserver une session avec vous !`
        );
      }
    }

    res.json({ success: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/messages/read/:userId/:contactId', authenticateToken, (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try {
    db.markAsRead(parseInt(req.params.userId), parseInt(req.params.contactId));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Paiements ────────────────────────────────────────────────────────────────
app.post('/api/pay', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['senderId', 'receiverId', 'amount', 'description']);
    if (err) return res.status(400).json({ error: err });

    if (req.user.userId !== parseInt(req.body.senderId))
      return res.status(403).json({ error: 'Accès refusé.' });

    const tx = db.createTransaction(req.body);
    const sender   = db.getTalentById(tx.sender_id);
    const receiver = db.getTalentById(tx.receiver_id);
    const net      = tx.amount - tx.commission;

    emitToUser(tx.receiver_id, 'new_notification', {
      type: 'payment',
      message: `Paiement de ${net.toLocaleString('fr-FR')} FCFA reçu pour "${tx.description}"`,
    });

    if (sender?.phone) {
      sendSMS(sender.phone,
        `SkillConnect : Paiement de ${tx.amount.toLocaleString('fr-FR')} FCFA envoyé. Fonds en séquestre.`
      );
    }
    if (receiver?.phone) {
      sendSMS(receiver.phone,
        `SkillConnect : Vous allez recevoir ${net.toLocaleString('fr-FR')} FCFA. Libéré après validation.`
      );
    }

    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Valider une mission (séquestre → complété) ───────────────────────────────
app.put('/api/transactions/:id/validate', authenticateToken, async (req, res) => {
  try {
    const txList = db.getTransactions(req.user.userId);
    const tx = txList.find(t => String(t.id) === String(req.params.id));

    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée.' });
    if (tx.sender_id !== req.user.userId)
      return res.status(403).json({ error: 'Seul l\'envoyeur peut valider la mission.' });
    if (tx.status !== 'escrow')
      return res.status(400).json({ error: 'Cette transaction n\'est pas en séquestre.' });

    const updated = db.updateTransactionStatus(req.params.id, 'completed');

    const receiver = db.getTalentById(tx.receiver_id);
    const net = tx.amount - tx.commission;

    // Notifie le talent que les fonds sont libérés
    const notif = db.createNotification({
      userId: tx.receiver_id,
      type: 'payment',
      message: `Mission validée ! ${net.toLocaleString('fr-FR')} FCFA ont été libérés sur votre compte.`,
    });
    emitToUser(tx.receiver_id, 'new_notification', notif);

    if (receiver?.phone) {
      sendSMS(receiver.phone,
        `SkillConnect : Mission validée ! ${net.toLocaleString('fr-FR')} FCFA crédités sur votre compte.`
      );
    }

    res.json({ success: true, transaction: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wallet/:userId', (req, res) => {
  try { res.json(db.getWallet(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transactions/:userId', (req, res) => {
  try { res.json(db.getTransactions(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/transactions/:id/status', authenticateToken, (req, res) => {
  try {
    const err = validateFields(req.body, ['status']);
    if (err) return res.status(400).json({ error: err });
    const tx = db.updateTransactionStatus(req.params.id, req.body.status);
    if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Retrait ──────────────────────────────────────────────────────────────────
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['userId', 'amount', 'network', 'phone']);
    if (err) return res.status(400).json({ error: err });

    if (req.user.userId !== parseInt(req.body.userId))
      return res.status(403).json({ error: 'Accès refusé.' });

    const amount = parseInt(req.body.amount);
    if (isNaN(amount) || amount < 500)
      return res.status(400).json({ error: 'Montant minimum : 500 FCFA.' });

    const tx = db.createWithdrawal({
      userId: parseInt(req.body.userId),
      amount,
      network: req.body.network,
      phone: req.body.phone,
    });

    sendSMS(req.body.phone,
      `SkillConnect : Retrait de ${amount.toLocaleString('fr-FR')} FCFA via ${req.body.network} initié. Vous recevrez les fonds sous peu.`
    );

    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Dépôt ────────────────────────────────────────────────────────────────────
app.post('/api/deposit', authenticateToken, async (req, res) => {
  try {
    const err = validateFields(req.body, ['userId', 'amount', 'network', 'phone']);
    if (err) return res.status(400).json({ error: err });

    if (req.user.userId !== parseInt(req.body.userId))
      return res.status(403).json({ error: 'Accès refusé.' });

    const amount = parseInt(req.body.amount);
    if (isNaN(amount) || amount < 100)
      return res.status(400).json({ error: 'Montant minimum : 100 FCFA.' });

    const tx = db.createDeposit({
      userId: parseInt(req.body.userId),
      amount,
      network: req.body.network,
      phone: req.body.phone,
    });

    sendSMS(req.body.phone,
      `SkillConnect : Dépôt de ${amount.toLocaleString('fr-FR')} FCFA via ${req.body.network} confirmé !`
    );

    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
app.get('/api/reviews/:talentId', (req, res) => {
  try { res.json(db.getReviews(parseInt(req.params.talentId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reviews', authenticateToken, (req, res) => {
  try {
    const err = validateFields(req.body, ['talentId', 'rating', 'comment']);
    if (err) return res.status(400).json({ error: err });

    if (req.body.rating < 1 || req.body.rating > 5)
      return res.status(400).json({ error: 'La note doit être entre 1 et 5.' });

    const review = db.createReview({ ...req.body, authorId: req.user.userId });

    emitToUser(req.body.talentId, 'new_notification', {
      type: 'review',
      message: `Vous avez reçu un nouvel avis ${req.body.rating} étoile${req.body.rating > 1 ? 's' : ''} ⭐`,
    });

    res.json({ success: true, review });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications/:userId', (req, res) => {
  try { res.json(db.getNotifications(parseInt(req.params.userId))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notifications/:id/read', authenticateToken, (req, res) => {
  try { db.markNotificationRead(parseInt(req.params.id)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notifications/read-all/:userId', authenticateToken, (req, res) => {
  if (req.user.userId !== parseInt(req.params.userId))
    return res.status(403).json({ error: 'Accès refusé.' });
  try { db.markAllNotificationsRead(parseInt(req.params.userId)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 SkillConnect démarré → http://localhost:${PORT}\n`);
});
